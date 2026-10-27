// Stage 4 conveniences: the feeding plan (JAV-08), the other feed names (EGY-03), the icons (DAT-03).
// Days in December 2026.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { setEatingStatus } from "@/lib/eating";
import { feedingDayView } from "@/lib/feeding";
import { applyPlan, currentPlans, setFeedingPlan, setFeedingPlans } from "@/lib/feeding-plan";
import { knownOtherNames } from "@/lib/feeds";
import { setIcon } from "@/lib/icons";
import { saveWithdrawalItem } from "@/lib/withdrawal";
import { dayToDate } from "@/lib/time";
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
    await setFeedingPlan(f.admin, { requestId: rid(), animalId: id, weekdays: [1, 3] }, at("2026-12-01", "08:00"));
    await setFeedingPlan(f.admin, { requestId: rid(), animalId: id, weekdays: [3, 1, 1] }, at("2026-12-01", "08:01")); // the same plan: nothing new
    await setFeedingPlan(f.admin, { requestId: rid(), animalId: id, weekdays: [1, 4] }, at("2026-12-01", "08:02"));
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

describe("the feeding plan and a manual fasting day (JAV-08, review of #18)", () => {
  it("the plan leaves out an animal with a manual fasting day, names it, and adds the others", async () => {
    const thursday = "2026-12-17";
    await setFeedingPlan(f.admin, { requestId: rid(), animalId: a["Teszt Három"], weekdays: [4] }, at("2026-12-14", "08:00"));
    await setFeedingPlan(f.admin, { requestId: rid(), animalId: a["Teszt Négy"], weekdays: [4] }, at("2026-12-14", "08:00"));
    await setEatingStatus(f.aq1, { requestId: rid(), day: thursday, animalId: a["Teszt Négy"], state: "FASTING" }, at(thursday, "07:30"));
    expect(await applyPlan(f.aq1, { requestId: rid(), day: thursday }, at(thursday, "08:00"))).toMatchObject({ added: 1, skipped: ["Teszt Négy"] });
    const view = (await feedingDayView(thursday)).animals;
    expect(view.find((x) => x.id === a["Teszt Három"])?.selected).toBe(true);
    expect(view.find((x) => x.id === a["Teszt Négy"])?.selected).toBe(false);
    // the fasting day stays: the plan did not override a person's decision
    const fd = await prisma.feedingDay.findUniqueOrThrow({ where: { businessDay: dayToDate(thursday) } });
    expect(await prisma.eatingStatus.count({ where: { feedingDayId: fd.id, animalId: a["Teszt Négy"], status: "VALID", state: "FASTING" } })).toBe(1);
  });
});

// Lili 2026-10-26 (Caparium channel msg 1564404799359946884): the timetable is the admin's for now. The server refuses everyone else;
// "Lista a terv szerint" only reads the plan and stays open to every aquarist.
describe("the feeding plan is the admin's to change", () => {
  it("an aquarist is refused on both writes (403) and nothing is stored; the aquarist's 'Lista a terv szerint' still works on the admin's plan", async () => {
    const before = await prisma.feedingPlan.count();
    await expectCode(setFeedingPlan(f.aq1, { requestId: rid(), animalId: a["Teszt Egy"], weekdays: [1] }, at("2026-12-28", "08:00")), "ADMIN_ONLY");
    await expectCode(setFeedingPlans(f.aq1, { requestId: rid(), plans: [{ animalId: a["Teszt Egy"], weekdays: [1] }] }, at("2026-12-28", "08:00")), "ADMIN_ONLY");
    expect(await prisma.feedingPlan.count()).toBe(before);
    // the admin sets a plan for a Monday; the aquarist applies it
    const monday = "2026-12-28";
    await setFeedingPlan(f.admin, { requestId: rid(), animalId: a["Teszt Kettő"], weekdays: [1] }, at("2026-12-27", "08:00"));
    expect(await applyPlan(f.aq1, { requestId: rid(), day: monday }, at(monday, "08:00"))).toMatchObject({ added: expect.any(Number) });
    expect((await feedingDayView(monday)).animals.find((x) => x.id === a["Teszt Kettő"])?.selected).toBe(true);
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

/*
  THE FEEDING TIMETABLE (6fe63c9b, item 4): every animal's days saved together. WHAT TURNS RED: an unchanged row
  writes a version; a row with no plan and no day creates an empty plan; a replay or the same save writes again;
  one animal twice is accepted.
*/
describe("the feeding timetable (6fe63c9b, item 4)", () => {
  it("one save, a version per changed animal, nothing for the unchanged or the empty row; replayed by its id", async () => {
    const one = a["Teszt Egy"];
    const two = a["Teszt Kettő"];
    const before = await prisma.feedingPlan.count();
    const open = await currentPlans();
    // an animal that has no plan at all: its empty row must write nothing (the branch must run every time)
    const planless = (await prisma.animal.findMany({ select: { id: true }, orderBy: { id: "asc" } })).find((x) => !open[x.id] && x.id !== one && x.id !== two);
    expect(planless, "an animal without a plan").toBeDefined();
    const req = rid();
    const r = await setFeedingPlans(
      f.admin,
      {
        requestId: req,
        plans: [
          { animalId: one, weekdays: [2, 3, 5, 6, 7] },
          { animalId: two, weekdays: [7, 2, 2] },
          // no plan and no day: nothing to record
          { animalId: planless!.id, weekdays: [] },
        ],
      },
      at("2026-12-20", "08:00"),
    );
    expect(r).toEqual({ replayed: false, changed: 2 });
    expect((await currentPlans())[two]).toEqual([2, 7]);
    expect(await prisma.feedingPlan.count()).toBe(before + 2);
    expect(await setFeedingPlans(f.admin, { requestId: req, plans: [{ animalId: one, weekdays: [1] }] }, at("2026-12-20", "08:01"))).toEqual({ replayed: true, changed: 0 });
    // the same days again: no new version
    expect((await setFeedingPlans(f.admin, { requestId: rid(), plans: [{ animalId: one, weekdays: [7, 6, 5, 3, 2] }] }, at("2026-12-20", "08:02"))).changed).toBe(0);
    await expectCode(
      setFeedingPlans(f.admin, { requestId: rid(), plans: [{ animalId: one, weekdays: [1] }, { animalId: one, weekdays: [2] }] }, at("2026-12-20", "08:03")),
      "DUPLICATE_ANIMAL",
    );
  });
});

