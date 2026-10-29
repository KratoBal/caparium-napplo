// Lili 2026-10-28 23:51 UTC (msg 1565150977861095475): a list switched off on a recorded day took its entries off, and
// another list went on by mistake. The day goes back to just before the switch, from the audit. WHAT TURNS RED: the
// dry run writes; the run leaves the second list's animals on, or does not bring the first list's selections, items
// and manual eating states back, or the day's feeds; a replay writes twice; a content change since is guessed instead
// of refused; an aquarist runs it; a change is not audited under the run's request. Days in April 2027: no other file
// writes there.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { restoreDay } from "@/lib/day-restore";
import { setEatingStatus } from "@/lib/eating";
import { AppError } from "@/lib/errors";
import { feedingDayView, saveFeedingItem } from "@/lib/feeding";
import { applyFeedingList, createFeedingList } from "@/lib/feeding-lists";
import { dayToDate } from "@/lib/time";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const a: Record<string, string> = {};
const feed: Record<string, string> = {};
const unit: Record<string, string> = {};
const at = (d: string, t: string) => new Date(`${d}T${t}:00+02:00`);

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

const selected = async (day: string) => (await feedingDayView(day)).animals.filter((x) => x.selected).map((x) => x.name).sort();
const dayFeedIds = async (day: string) => (await prisma.feedingDay.findUnique({ where: { businessDay: dayToDate(day) } }))?.feedIds.sort() ?? [];
const valid = async (day: string) => {
  const fd = await prisma.feedingDay.findUniqueOrThrow({ where: { businessDay: dayToDate(day) } });
  return {
    items: await prisma.feedingItem.count({ where: { feedingDayId: fd.id, status: "VALID" } }),
    manual: await prisma.eatingStatus.count({ where: { feedingDayId: fd.id, status: "VALID", source: "MANUAL" } }),
  };
};

describe("a day put back as it stood before a list switch", () => {
  it("the dry run writes nothing; the run brings back the first list's day and takes the second list off, audited", async () => {
    const d = "2027-04-13";
    const listA = ((await createFeedingList(f.admin, { requestId: rid(), name: "Visszaallitas A", animalIds: [a["Teszt Egy"], a["Teszt Kettő"]], feedIds: [feed["Teszt hal"]] })) as { id: string }).id;
    const listB = ((await createFeedingList(f.admin, { requestId: rid(), name: "Visszaallitas B", animalIds: [a["Teszt Három"], a["Teszt Egy"]], feedIds: [feed["Teszt kagyló"]] })) as { id: string }).id;
    await applyFeedingList(f.admin, { requestId: rid(), day: d, listId: listA }, at(d, "08:00"));
    await saveFeedingItem(f.admin, { requestId: rid(), day: d, animalId: a["Teszt Egy"], feedId: feed["Teszt hal"], quantities: [{ value: "10", unitId: unit.g }] } as Parameters<typeof saveFeedingItem>[1], at(d, "09:00"));
    await setEatingStatus(f.admin, { requestId: rid(), day: d, animalId: a["Teszt Kettő"], state: "EATEN" }, at(d, "10:00"));
    const before = { selected: await selected(d), feeds: await dayFeedIds(d), valid: await valid(d) };
    expect(before).toEqual({ selected: ["Teszt Egy", "Teszt Kettő"], feeds: [feed["Teszt hal"]], valid: { items: 1, manual: 1 } });

    // Lili's two clicks: the list off (confirmed), then another list on
    const off = rid();
    await applyFeedingList(f.admin, { requestId: off, day: d, listId: null, confirmCascade: true }, at(d, "11:00"));
    await applyFeedingList(f.admin, { requestId: rid(), day: d, listId: listB }, at(d, "11:01"));
    // Teszt Egy is on both lists: the second put a NEW selection of it on, so its old one can come back only after
    // the new one is off (one valid selection per animal and day)
    expect([await selected(d), await dayFeedIds(d), await valid(d)]).toEqual([["Teszt Egy", "Teszt Három"], [feed["Teszt kagyló"]], { items: 0, manual: 0 }]);

    await expectCode(restoreDay(f.aq1, { requestId: rid(), day: d, mode: "ops" }), "ADMIN_ONLY");
    const ops = (await restoreDay(f.admin, { requestId: rid(), day: d, mode: "ops" })) as { ops: { op: string }[] };
    expect(ops.ops.map((o) => o.op)).toContain(off);

    const auditsBefore = await prisma.auditEntry.count();
    const dry = (await restoreDay(f.admin, { requestId: rid(), day: d, mode: "plan", op: off })) as { plan: { count: Record<string, number>; blocked: unknown[]; feedIds: { before: string[] } | null } };
    expect(dry.plan.blocked).toEqual([]);
    expect(dry.plan.count).toEqual({ "FeedingSelection INVALIDATED": 2, "FeedingSelection VALID": 2, "FeedingItem VALID": 1, "EatingStatus VALID": 1 });
    expect(dry.plan.feedIds?.before).toEqual([feed["Teszt hal"]]);
    expect([await prisma.auditEntry.count(), await selected(d)], "the dry run writes nothing").toEqual([auditsBefore, ["Teszt Egy", "Teszt Három"]]);

    await expectCode(restoreDay(f.admin, { requestId: rid(), day: d, mode: "run", op: off }), "REASON_REQUIRED");
    const run = rid();
    await restoreDay(f.admin, { requestId: run, day: d, mode: "run", op: off, reason: "Lili kérése" }, at(d, "12:00"));
    expect({ selected: await selected(d), feeds: await dayFeedIds(d), valid: await valid(d) }).toEqual(before);
    expect(await prisma.auditEntry.count({ where: { requestId: run } })).toBe(7);
    expect(await restoreDay(f.admin, { requestId: run, day: d, mode: "run", op: off, reason: "Lili kérése" })).toEqual({ replayed: true });
    await expectCode(restoreDay(f.admin, { requestId: rid(), day: d, mode: "run", op: off, reason: "még egyszer" }), "NO_CHANGE");
    // after the restore the item's amount is edited: a later restore to the same point cannot know the amount it had
    // (its first change since is the switch's invalidation, the edit comes after it), so it is named, not guessed
    const fdId = (await prisma.feedingDay.findUniqueOrThrow({ where: { businessDay: dayToDate(d) } })).id;
    const item = await prisma.feedingItem.findFirstOrThrow({ where: { feedingDayId: fdId, status: "VALID" } });
    await saveFeedingItem(f.admin, { requestId: rid(), day: d, itemId: item.id, expectedVersion: item.version, animalId: a["Teszt Egy"], feedId: feed["Teszt hal"], quantities: [{ value: "15", unitId: unit.g }] } as Parameters<typeof saveFeedingItem>[1], at(d, "13:00"));
    const again = (await restoreDay(f.admin, { requestId: rid(), day: d, mode: "plan", op: off })) as { plan: { blocked: { type: string; action: string }[] } };
    expect(again.plan.blocked.map((b) => [b.type, b.action])).toEqual([["FeedingItem", "UPDATE"]]);
  });

  it("a content change since, on a row that stood before, is refused, not guessed", async () => {
    const d = "2027-04-14";
    const listA = ((await createFeedingList(f.admin, { requestId: rid(), name: "Visszaallitas C", animalIds: [a["Teszt Egy"]], feedIds: [feed["Teszt hal"]] })) as { id: string }).id;
    await applyFeedingList(f.admin, { requestId: rid(), day: d, listId: listA }, at(d, "08:00"));
    const item = (await saveFeedingItem(f.admin, { requestId: rid(), day: d, animalId: a["Teszt Egy"], feedId: feed["Teszt hal"], quantities: [{ value: "10", unitId: unit.g }] } as Parameters<typeof saveFeedingItem>[1], at(d, "09:00"))) as { itemId: string };
    // an operation that is later turned back to, then the item's amount edited after it
    const mark = rid();
    await setEatingStatus(f.admin, { requestId: mark, day: d, animalId: a["Teszt Egy"], state: "EATEN" }, at(d, "09:30"));
    const row = await prisma.feedingItem.findUniqueOrThrow({ where: { id: item.itemId } });
    await saveFeedingItem(f.admin, { requestId: rid(), day: d, itemId: item.itemId, expectedVersion: row.version, animalId: a["Teszt Egy"], feedId: feed["Teszt hal"], quantities: [{ value: "12", unitId: unit.g }] } as Parameters<typeof saveFeedingItem>[1], at(d, "10:00"));
    const dry = (await restoreDay(f.admin, { requestId: rid(), day: d, mode: "plan", op: mark })) as { plan: { blocked: { type: string; action: string }[] } };
    expect(dry.plan.blocked.map((b) => [b.type, b.action])).toEqual([["FeedingItem", "UPDATE"]]);
    await expectCode(restoreDay(f.admin, { requestId: rid(), day: d, mode: "run", op: mark, reason: "proba" }, at(d, "11:00")), "RESTORE_BLOCKED");
  });
});
