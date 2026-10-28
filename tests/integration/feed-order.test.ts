// The admin's feed order inside a type (Lili 2026-10-28 13:22 UTC, acrobot 37529: "kategórián belül húzással állítható sorrend,
// ugyanúgy, mint az állatoknál, és mindenhol ez a sorrend érvényes"). A second HAL feed named after "Teszt hal" alphabetically, so
// the saved order is not the name order. November 2027, a day no other spec uses; the HAL positions are put back at the end.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { saveFeedingItem, setSelection } from "@/lib/feeding";
import { feedingLog } from "@/lib/feeding-log";
import { createFeed, listFeeds, setFeedOrder } from "@/lib/feeds";
import { breakdown } from "@/lib/reports";
import { saveWithdrawalItem, takenVersusGiven } from "@/lib/withdrawal";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
let halType = "";
let hal = "";
let green = "";
let kagylo = "";
let before: { id: string; sortOrder: number }[] = [];
const day = "2027-11-08";
const at = (t: string) => new Date(`${day}T${t}:00+01:00`);
const GREEN = "Zöld hal próba";

async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e instanceof AppError ? e.code : e).toBe(code);
}

beforeAll(async () => {
  f = await fixtures();
  const type = await prisma.feedType.findUniqueOrThrow({ where: { code: "HAL" } });
  halType = type.id;
  const g = (await prisma.unit.findFirstOrThrow({ where: { symbol: "g" } })).id;
  hal = (await prisma.feedName.findFirstOrThrow({ where: { name: "Teszt hal" } })).feedId;
  kagylo = (await prisma.feedName.findFirstOrThrow({ where: { name: "Teszt kagyló" } })).feedId;
  const existing = await prisma.feedName.findFirst({ where: { name: GREEN } });
  green = existing ? existing.feedId : ((await createFeed(f.admin, { requestId: rid(), typeId: halType, name: GREEN, dimensions: ["MASS"], defaultUnitId: g })) as { id: string }).id;
  before = await prisma.feed.findMany({ where: { typeId: halType }, select: { id: true, sortOrder: true } });
  // the name order first: Teszt hal before Zöld hal próba
  await prisma.feed.update({ where: { id: hal }, data: { sortOrder: 0 } });
  await prisma.feed.update({ where: { id: green }, data: { sortOrder: 1 } });

  // one item of each feed, and one withdrawal of each, on the day
  const animal = (await prisma.animalName.findFirstOrThrow({ where: { name: "Teszt Egy" } })).animalId;
  await setSelection(f.aq1, { requestId: rid(), day, animalIds: [animal], selected: true }, at("07:50"));
  for (const [i, feedId] of [hal, green].entries()) {
    await saveFeedingItem(f.aq1, { requestId: rid(), day, animalId: animal, feedId, quantities: [{ value: "10", unitId: g }] } as Parameters<typeof saveFeedingItem>[1], at(`0${8 + i}:00`));
    await saveWithdrawalItem(f.aq1, { requestId: rid(), day, useDay: day, feedId, quantities: [{ value: "10", unitId: g }] }, at(`0${8 + i}:30`));
  }
});
afterAll(async () => {
  for (const b of before) await prisma.feed.update({ where: { id: b.id }, data: { sortOrder: b.sortOrder } });
});

const halFeeds = async () => (await listFeeds()).find((t) => t.code === "HAL")!.feeds.map((x) => x.id);
const mine = (ids: string[]) => ids.filter((id) => id === hal || id === green);

describe("the feeds' order inside a type", () => {
  it("only the admin, only the type's own feeds, each once; nothing is stored otherwise", async () => {
    await expectCode(setFeedOrder(f.aq1, { requestId: rid(), typeId: halType, ids: [green, hal] }), "ADMIN_ONLY");
    await expectCode(setFeedOrder(f.admin, { requestId: rid(), typeId: halType, ids: [green, kagylo] }), "FEED_NOT_FOUND");
    await expectCode(setFeedOrder(f.admin, { requestId: rid(), typeId: halType, ids: [green, green] }), "ORDER_DUPLICATE");
    expect(mine(await halFeeds())).toEqual([hal, green]);
  });

  it("saved: the feed list, the report's columns and the taken-versus-given rows follow it, not the name", async () => {
    await setFeedOrder(f.admin, { requestId: rid(), typeId: halType, ids: [green, hal] });
    expect(mine(await halFeeds())).toEqual([green, hal]);
    expect(await prisma.auditEntry.count({ where: { entityType: "FeedOrder", entityId: halType, userId: f.admin.id } })).toBeGreaterThanOrEqual(1);

    const log = await feedingLog({ from: day, to: day, poolId: null, animalId: null });
    const columns = breakdown(log.entries, log.days, log.filtered, log.recipientOrder, log.feedOrder).columns.map((c) => c.feed);
    expect(columns.filter((c) => c === GREEN || c === "Teszt hal")).toEqual([GREEN, "Teszt hal"]);

    const rows = (await takenVersusGiven(day, day)).map((r) => r.feed);
    expect(rows.filter((r) => r === GREEN || r === "Teszt hal")).toEqual([GREEN, "Teszt hal"]);

    // the same order again is no change; a repeated request id is replayed
    await expectCode(setFeedOrder(f.admin, { requestId: rid(), typeId: halType, ids: [green, hal] }), "NO_CHANGE");
    const again = rid();
    await setFeedOrder(f.admin, { requestId: again, typeId: halType, ids: [hal, green] });
    expect(await setFeedOrder(f.admin, { requestId: again, typeId: halType, ids: [hal, green] })).toEqual({ replayed: true });
  });
});
