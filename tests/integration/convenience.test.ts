// Stage 4 conveniences: the feeding plan (JAV-08), the other feed names (EGY-03), the icons (DAT-03).
// Days in December 2026.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { feedingDayView } from "@/lib/feeding";
import { applyPlan, currentPlans, setFeedingPlan } from "@/lib/feeding-plan";
import { knownOtherNames } from "@/lib/feeds";
import { setIcon } from "@/lib/icons";
import { saveWithdrawalItem } from "@/lib/withdrawal";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const a: Record<string, string> = {};
const feed: Record<string, string> = {};
const unit: Record<string, string> = {};
const at = (d: string, t: string) => new Date(`${d}T${t}:00+01:00`);

beforeAll(async () => {
  f = await fixtures();
  for (const n of await prisma.animalName.findMany()) a[n.name] = n.animalId;
  for (const n of await prisma.feedName.findMany()) feed[n.name] = n.feedId;
  for (const u of await prisma.unit.findMany()) unit[u.symbol] = u.id;
});

async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e, `expected ${code}`).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
}

describe("the feeding plan (JAV-08)", () => {
  it("a new version per change, one open; it only adds the planned animals of the weekday to the list", async () => {
    const id = a["Teszt Három"];
    await setFeedingPlan(f.aq1, { requestId: rid(), animalId: id, weekdays: [1, 3] }, at("2026-12-01", "08:00"));
    await setFeedingPlan(f.aq1, { requestId: rid(), animalId: id, weekdays: [3, 1, 1] }, at("2026-12-01", "08:01")); // the same plan: nothing new
    await setFeedingPlan(f.aq1, { requestId: rid(), animalId: id, weekdays: [1, 4] }, at("2026-12-01", "08:02"));
    expect(await prisma.feedingPlan.count({ where: { animalId: id } })).toBe(2);
    expect((await currentPlans())[id]).toEqual([1, 4]);

    const monday = "2026-12-07";
    expect(await applyPlan(f.aq1, { requestId: rid(), day: monday }, at(monday, "08:00"))).toMatchObject({ added: 1 });
    expect((await feedingDayView(monday)).animals.find((x) => x.id === id)?.selected).toBe(true);
    expect(await applyPlan(f.aq1, { requestId: rid(), day: monday }, at(monday, "08:05"))).toMatchObject({ added: 0 });
    const tuesday = "2026-12-08";
    expect(await applyPlan(f.aq1, { requestId: rid(), day: tuesday }, at(tuesday, "08:00"))).toMatchObject({ added: 0 });
    // the day's permissions are the list's: an earlier day is admin work
    await expectCode(applyPlan(f.aq1, { requestId: rid(), day: "2026-12-10" }, at("2026-12-11", "08:00")), "NOT_TODAY");
  });
});

describe("the other feed names (EGY-03)", () => {
  it("newest first, one per name whatever its case", async () => {
    await saveWithdrawalItem(f.aq1, { requestId: rid(), day: "2026-12-14", feedId: feed["Egyéb"], otherName: "Kagylóhéj-próba", quantities: [{ value: "5", unitId: unit.g }] }, at("2026-12-14", "08:00"));
    await saveWithdrawalItem(f.aq1, { requestId: rid(), day: "2026-12-15", feedId: feed["Egyéb"], otherName: "kagylóhéj-próba", quantities: [{ value: "5", unitId: unit.g }] }, at("2026-12-15", "08:00"));
    const names = await knownOtherNames();
    expect(names[0]).toBe("kagylóhéj-próba");
    expect(names.filter((n) => n.toLowerCase() === "kagylóhéj-próba")).toHaveLength(1);
  });
});

describe("icons (DAT-03)", () => {
  it("an admin sets and clears one; an aquarist cannot", async () => {
    const pool = f.pool("INKUBATOR");
    await expectCode(setIcon(f.aq1, { requestId: rid(), target: "pool", id: pool, emoji: "🐠" }), "ADMIN_ONLY");
    await setIcon(f.admin, { requestId: rid(), target: "pool", id: pool, emoji: "🐠" });
    expect((await prisma.pool.findUniqueOrThrow({ where: { id: pool } })).emoji).toBe("🐠");
    await setIcon(f.admin, { requestId: rid(), target: "pool", id: pool, emoji: "" });
    expect((await prisma.pool.findUniqueOrThrow({ where: { id: pool } })).emoji).toBeNull();
  });
});
