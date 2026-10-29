// The base amount of a ticked feed (Lili 2026-10-29, package item 3): the admin sets it, the feeding sheet's tick (an
// item without a quantity) records it, for the sheet row (a group's row: the group as a whole). WHAT TURNS THIS RED: a
// non-admin setting it; a unit outside the feed's dimensions; a tick saved without the amount; a changed amount
// rewriting an item already saved, or not reaching the next tick; a tick for an earlier day without the first amount;
// an ended amount leaving the ordinary feed tickable. Days in March 2028: no other file writes there.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { feedingDayView, saveFeedingItem, setSelection } from "@/lib/feeding";
import { createFeed, listFeeds, updateFeed } from "@/lib/feeds";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const a: Record<string, string> = {};
const feed: Record<string, string> = {};
const unit: Record<string, string> = {};
const at = (d: string, t: string) => new Date(`${d}T${t}:00+01:00`);
// feeds no other test file uses: an amount is valid from the start of time (FIRST_NAME_FROM), so on a shared
// database a feed another file ticks without a quantity would take it there too
const A = "Homárikra";
const B = "Metapenaeus monoceros";
const TYPED = "Pandalus borealis";

beforeAll(async () => {
  f = await fixtures();
  for (const n of await prisma.animalName.findMany()) a[n.name] = n.animalId;
  for (const n of await prisma.feedName.findMany()) feed[n.name] = n.feedId;
  for (const u of await prisma.unit.findMany()) unit[u.symbol] = u.id;
});

async function code(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(AppError);
  return (e as AppError).code;
}

const doseOf = async (name: string, when: Date) => (await listFeeds(when)).flatMap((t) => t.feeds).find((x) => x.id === feed[name])!.dose;
const itemOf = async (d: string, feedId: string, key: { animalId?: string; groupId?: string }) =>
  (await feedingDayView(d)).items.find((i) => i.feedId === feedId && (key.animalId ? i.animalId === key.animalId : i.groupId === key.groupId));

describe("the ticked feed's base amount (package item 3)", () => {
  it("only the admin sets it, in one of the feed's dimensions; everyone sees it in the list", async () => {
    const now = at("2028-03-01", "08:00");
    expect(await code(updateFeed(f.aq1, feed[A], { requestId: rid(), dose: { value: "20", unitId: unit.g } }, now))).toBe("ADMIN_ONLY");
    expect(await code(updateFeed(f.admin, feed[A], { requestId: rid(), dose: { value: "20", unitId: unit.ml } }, now))).toBe("UNIT_DIMENSION");
    expect(await code(updateFeed(f.admin, feed[A], { requestId: rid(), dose: { value: "0", unitId: unit.g } }, now))).toBe("INVALID_DOSE");
    await updateFeed(f.admin, feed[A], { requestId: rid(), dose: { value: "20", unitId: unit.g } }, now);
    expect(await doseOf(A, now)).toEqual({ value: "20", unitId: unit.g, symbol: "g" });
    // the same amount again is no change
    expect(await code(updateFeed(f.admin, feed[A], { requestId: rid(), dose: { value: "20,0", unitId: unit.g } }, now))).toBe("NO_CHANGE");
  });

  it("the tick records it for the row: an animal's, a group's as a whole; a later change does not rewrite it", async () => {
    const d = "2028-03-02";
    const now = at(d, "09:00");
    await setSelection(f.aq1, { requestId: rid(), day: d, animalIds: [a["Teszt Egy"]], selected: true }, now);
    await saveFeedingItem(f.aq1, { requestId: rid(), day: d, animalId: a["Teszt Egy"], feedId: feed[A], quantities: [] }, now);
    const one = await itemOf(d, feed[A], { animalId: a["Teszt Egy"] });
    expect(one?.quantities.map((q) => `${q.value} ${q.unit}`)).toEqual(["20 g"]);

    // a group's row, on a day of its own (a member fed individually too would be a double feeding): one item for the
    // group with the amount once (Lili: "ne bonyolítsuk")
    const dg = "2028-03-04";
    const nowg = at(dg, "09:00");
    const groupId = (await prisma.animalGroupName.findFirstOrThrow({ where: { name: "Teszt csoport" } })).groupId;
    const members = await prisma.animalGroupMembership.findMany({ where: { groupId, validFrom: { lte: nowg }, OR: [{ validTo: null }, { validTo: { gt: nowg } }] } });
    expect(members.length).toBeGreaterThan(0);
    await setSelection(f.aq1, { requestId: rid(), day: dg, animalIds: members.map((m) => m.animalId), selected: true }, nowg);
    await saveFeedingItem(f.aq1, { requestId: rid(), day: dg, groupId, feedId: feed[A], quantities: [] }, nowg);
    const group = await itemOf(dg, feed[A], { groupId });
    expect(group?.quantities.map((q) => `${q.value} ${q.unit}`)).toEqual(["20 g"]);

    // the admin changes it: the saved items keep 20 g, the next tick takes 25 g
    const later = at(d, "12:00");
    await updateFeed(f.admin, feed[A], { requestId: rid(), dose: { value: "25", unitId: unit.g } }, later);
    const d2 = "2028-03-03";
    await setSelection(f.aq1, { requestId: rid(), day: d2, animalIds: [a["Teszt Egy"]], selected: true }, at(d2, "09:00"));
    await saveFeedingItem(f.aq1, { requestId: rid(), day: d2, animalId: a["Teszt Egy"], feedId: feed[A], quantities: [] }, at(d2, "09:00"));
    expect((await itemOf(d, feed[A], { animalId: a["Teszt Egy"] }))?.quantities.map((q) => q.value)).toEqual(["20"]);
    expect((await itemOf(d2, feed[A], { animalId: a["Teszt Egy"] }))?.quantities.map((q) => q.value)).toEqual(["25"]);
    // a typed quantity still wins over the tick's amount
    // a typed quantity still wins over the tick's amount (on another feed with an amount: the same feed again that day
    // would be a second item, not a correction)
    await updateFeed(f.admin, feed[TYPED], { requestId: rid(), dose: { value: "40", unitId: unit.g } }, at(d2, "09:00"));
    await saveFeedingItem(f.aq1, { requestId: rid(), day: d2, animalId: a["Teszt Egy"], feedId: feed[TYPED], quantities: [{ value: "7", unitId: unit.g }] }, at(d2, "09:10"));
    expect((await itemOf(d2, feed[TYPED], { animalId: a["Teszt Egy"] }))?.quantities.map((q) => q.value)).toEqual(["7"]);
  });

  it("a tick for an earlier day takes the first amount; ended, the ordinary feed needs a quantity again", async () => {
    // Krill's first amount is set now; a tick recorded now for a day before it still takes it (as a name, FIRST_NAME_FROM)
    const now = at("2028-03-10", "08:00");
    await updateFeed(f.admin, feed[B], { requestId: rid(), dose: { value: "500", unitId: unit.g } }, now);
    const early = "2028-03-05";
    await setSelection(f.admin, { requestId: rid(), day: early, animalIds: [a["Teszt Egy"]], selected: true, reason: "teszt: utólagos pipa" }, now);
    await saveFeedingItem(f.admin, { requestId: rid(), day: early, animalId: a["Teszt Egy"], feedId: feed[B], quantities: [], reason: "teszt: utólagos pipa" }, now);
    expect((await itemOf(early, feed[B], { animalId: a["Teszt Egy"] }))?.quantities.map((q) => `${q.value} ${q.unit}`)).toEqual(["500 g"]);

    await updateFeed(f.admin, feed[B], { requestId: rid(), dose: null }, at("2028-03-11", "08:00"));
    expect(await doseOf(B, at("2028-03-11", "09:00"))).toBeNull();
    const d = "2028-03-12";
    await setSelection(f.aq1, { requestId: rid(), day: d, animalIds: [a["Teszt Egy"]], selected: true }, at(d, "09:00"));
    expect(await code(saveFeedingItem(f.aq1, { requestId: rid(), day: d, animalId: a["Teszt Egy"], feedId: feed[B], quantities: [] }, at(d, "09:00")))).toBe("QUANTITY_REQUIRED");
  });

  it("the amount is checked against the dimensions after the change, and a change cannot strand it (barracuda on #113)", async () => {
    const now = at("2028-03-20", "08:00");
    const typeId = (await prisma.feedType.findFirstOrThrow({ where: { code: "APRO" } })).id;
    const { id } = await createFeed(f.admin, { requestId: rid(), typeId, name: "Teszt adag-takarmány", dimensions: ["MASS"], defaultUnitId: unit.g }, now);
    // one PATCH to pieces only, with an amount in grams: checked against [COUNT], refused
    expect(await code(updateFeed(f.admin, id, { requestId: rid(), dimensions: ["COUNT"], defaultUnitId: unit.db, dose: { value: "30", unitId: unit.g } }, now))).toBe("UNIT_DIMENSION");
    await updateFeed(f.admin, id, { requestId: rid(), dose: { value: "30", unitId: unit.g } }, now);
    // a change of dimensions that takes the open amount's away: refused, unless the amount goes in the same step
    expect(await code(updateFeed(f.admin, id, { requestId: rid(), dimensions: ["COUNT"], defaultUnitId: unit.db }, now))).toBe("DOSE_UNIT");
    await updateFeed(f.admin, id, { requestId: rid(), dimensions: ["COUNT"], defaultUnitId: unit.db, dose: { value: "3", unitId: unit.db } }, now);
    const listed = (await listFeeds(now)).flatMap((t) => t.feeds).find((x) => x.id === id)!;
    expect([listed.dimensions, listed.dose?.symbol]).toEqual([["COUNT"], "db"]);
  });

  it("one open amount per feed: the index refuses a second, and two changes at once leave one", async () => {
    const now = at("2028-03-21", "08:00");
    const typeId = (await prisma.feedType.findFirstOrThrow({ where: { code: "APRO" } })).id;
    const { id } = await createFeed(f.admin, { requestId: rid(), typeId, name: "Teszt párhuzamos takarmány", dimensions: ["MASS"], defaultUnitId: unit.g }, now);
    await updateFeed(f.admin, id, { requestId: rid(), dose: { value: "10", unitId: unit.g } }, now);
    // structural: a second open row, whoever writes it, is a unique violation
    await expect(prisma.coralFeedDose.create({ data: { feedId: id, dose: "11", unitId: unit.g, validFrom: now } })).rejects.toThrow();

    // two changes forced to overlap: a blocker holds the OPEN AMOUNT's row. With updateFeed's lock on the feed row the
    // second change waits there and reads the first one's result; without it both read the same open row, both wait
    // to close it, and the second's new open row is the index's unique violation: red (measured)
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const held = new Promise<void>((r) => (locked = r));
    const blocker = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "coral_feed_dose" WHERE "feedId" = ${id}::uuid AND "validTo" IS NULL FOR UPDATE`;
        locked();
        await gate;
      },
      { timeout: 15_000 },
    );
    await held;
    const later = at("2028-03-21", "09:00");
    const both = Promise.allSettled([
      updateFeed(f.admin, id, { requestId: rid(), dose: { value: "20", unitId: unit.g } }, later),
      updateFeed(f.admin, id, { requestId: rid(), dose: { value: "25", unitId: unit.g } }, later),
    ]);
    await new Promise((r) => setTimeout(r, 300));
    release();
    await blocker;
    const results = await both;
    const open = await prisma.coralFeedDose.findMany({ where: { feedId: id, validTo: null } });
    expect([results.map((r) => r.status), open.length]).toEqual([["fulfilled", "fulfilled"], 1]);
  }, 30_000);
});
