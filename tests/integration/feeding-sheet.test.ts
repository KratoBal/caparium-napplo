// 6fe63c9b (Lili's request; Balázs 2026-10-21 10:38 UTC "mehet"): the list's second step, the day's feeds, and
// what the feeding sheet reads (the same items, in base units). Days in November 2026.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { feedingDayView, saveFeedingItem, setDayFeeds, setSelection } from "@/lib/feeding";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const a: Record<string, string> = {};
const unit: Record<string, string> = {};
let massFeeds: { id: string }[] = [];
const at = (d: string, t: string) => new Date(`${d}T${t}:00+01:00`);

beforeAll(async () => {
  f = await fixtures();
  for (const n of await prisma.animalName.findMany()) a[n.name] = n.animalId;
  for (const u of await prisma.unit.findMany()) unit[u.symbol] = u.id;
  massFeeds = await prisma.feed.findMany({ where: { active: true, allowedDimensions: { has: "MASS" }, type: { code: { not: "EGYEB" } } }, orderBy: { sortOrder: "asc" }, take: 2, select: { id: true } });
});

async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e, `expected ${code}`).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
}

describe("the day's feeds (6fe63c9b, step 2)", () => {
  const DAY = "2026-11-10";

  it("saved for the day, audited once, a replay and the same choice change nothing; an unknown feed is refused", async () => {
    expect(massFeeds.length).toBe(2);
    const ids = massFeeds.map((x) => x.id);
    const req = rid();
    await setDayFeeds(f.aq1, { requestId: req, day: DAY, feedIds: ids }, at(DAY, "08:00"));
    expect(await setDayFeeds(f.aq1, { requestId: req, day: DAY, feedIds: ids }, at(DAY, "08:00"))).toEqual({ replayed: true });
    expect(await setDayFeeds(f.aq1, { requestId: rid(), day: DAY, feedIds: [...ids].reverse() }, at(DAY, "08:01"))).toEqual({ changed: false });
    expect([...(await feedingDayView(DAY)).feedIds].sort()).toEqual([...ids].sort());
    const fd = await prisma.feedingDay.findUniqueOrThrow({ where: { businessDay: new Date(`${DAY}T00:00:00Z`) } });
    expect(await prisma.auditEntry.count({ where: { entityType: "FeedingDay", entityId: fd.id } })).toBe(1);
    await expectCode(setDayFeeds(f.aq1, { requestId: rid(), day: DAY, feedIds: ["00000000-0000-0000-0000-00000000dead"] }, at(DAY, "08:02")), "FEED_NOT_FOUND");
    // an empty choice is "not chosen" again
    await setDayFeeds(f.aq1, { requestId: rid(), day: DAY, feedIds: [] }, at(DAY, "08:03"));
    expect((await feedingDayView(DAY)).feedIds).toEqual([]);
  });

  it("the sheet's cells: each item's amounts in the base unit of their dimension (1 kg is 1000 g)", async () => {
    const animal = a["Teszt Egy"];
    await setSelection(f.aq1, { requestId: rid(), day: DAY, animalIds: [animal], selected: true }, at(DAY, "09:00"));
    await saveFeedingItem(f.aq1, { requestId: rid(), day: DAY, feedId: massFeeds[0]!.id, animalId: animal, quantities: [{ value: "0,25", unitId: unit.kg }] }, at(DAY, "09:01"));
    const item = (await feedingDayView(DAY)).items.find((i) => i.animalId === animal && i.feedId === massFeeds[0]!.id);
    expect(item?.baseQuantities).toEqual([{ unit: "g", value: 250 }]);
  });
});
