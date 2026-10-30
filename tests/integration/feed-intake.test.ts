// Feed intake and the feed stock (the Takarmányhűtő, Lili 2026-10-29 package item 9). Days in August 2026. The stock is
// global per feed, so every test works on a feed of its own (made here) and reads only its rows.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { feedStock, intakeDayView, invalidateIntakeItem, saveIntakeItem } from "@/lib/feed-intake";
import { createFeed, listFeeds } from "@/lib/feeds";
import { invalidateWithdrawalItem, saveWithdrawalItem } from "@/lib/withdrawal";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const unit: Record<string, string> = {};
const at = (d: string, t: string) => new Date(`${d}T${t}:00+02:00`);

beforeAll(async () => {
  f = await fixtures();
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

async function newFeed(name: string) {
  const type = await prisma.feedType.findUniqueOrThrow({ where: { code: "RAK" } });
  const r = await createFeed(f.admin, { requestId: rid(), typeId: type.id, name, dimensions: ["MASS", "COUNT"], defaultUnitId: unit.g }, new Date("2026-08-01T08:00:00Z"));
  return r.id;
}

const receive = (d: string, feedId: string, body: Record<string, unknown>, actor = f?.aq1, t = "08:00") =>
  saveIntakeItem(actor, { requestId: rid(), day: d, feedId, ...body } as Parameters<typeof saveIntakeItem>[1], at(d, t));
const take = (d: string, feedId: string, body: Record<string, unknown>, actor = f?.aq1, t = "09:00") =>
  saveWithdrawalItem(actor, { requestId: rid(), day: d, feedId, ...body } as Parameters<typeof saveWithdrawalItem>[1], at(d, t));
const rowsOf = async (feedId: string, now: Date) => (await feedStock(now)).filter((r) => r.feedId === feedId);

describe("the stock is the intake that was not sent back, minus the withdrawals", () => {
  it("an intake adds, a withdrawal takes, a returned delivery shows but does not count, an invalid one goes", async () => {
    const feedId = await newFeed("Hűtő-teszt egy");
    const d = "2026-08-17";
    const now = at("2026-08-18", "12:00");
    const first = (await receive(d, feedId, { quantities: [{ value: "5", unitId: unit.kg }, { value: "20", unitId: unit.db }], note: "nyitó készlet" })) as { itemId: string; version: number };
    expect((await rowsOf(feedId, now)).map((r) => [r.unit, r.level, r.tracked])).toEqual([["db", 20, true], ["g", 5000, true]]);

    // sent back: it is on the day's list, it is not in the stock
    await receive(d, feedId, { quantities: [{ value: "2", unitId: unit.kg }], returned: true, note: "nem megfelelő" });
    const day = await intakeDayView(d);
    expect(day.filter((i) => i.feedId === feedId).map((i) => [i.returned, i.note])).toEqual([[false, "nyitó készlet"], [true, "nem megfelelő"]]);
    const g = (await rowsOf(feedId, now)).find((r) => r.unit === "g")!;
    expect([g.received, g.returned, g.level]).toEqual([5000, 2000, 5000]);

    // a withdrawal takes from it, its invalidation gives it back
    const w = (await take("2026-08-18", feedId, { quantities: [{ value: "1,5", unitId: unit.kg }] })) as { itemId: string };
    expect((await rowsOf(feedId, now)).find((r) => r.unit === "g")).toMatchObject({ taken: 1500, level: 3500, week: 1500, month: 1500, negative: false });
    await invalidateWithdrawalItem(f.aq1, w.itemId, { requestId: rid(), expectedVersion: 1, reason: "tévedés" }, at("2026-08-18", "09:30"));
    expect((await rowsOf(feedId, now)).find((r) => r.unit === "g")).toMatchObject({ taken: 0, level: 5000 });

    // the first intake changed to 3 kg, then invalidated: nothing left that counts
    await receive(d, feedId, { itemId: first.itemId, expectedVersion: first.version, quantities: [{ value: "3", unitId: unit.kg }] });
    expect((await rowsOf(feedId, now)).find((r) => r.unit === "g")?.level).toBe(3000);
    expect((await rowsOf(feedId, now)).find((r) => r.unit === "db")).toBeUndefined();
    await invalidateIntakeItem(f.aq1, first.itemId, { requestId: rid(), expectedVersion: 2, reason: "tévedés" }, at(d, "10:00"));
    expect((await rowsOf(feedId, now)).find((r) => r.unit === "g")).toMatchObject({ received: 0, level: 0 });
  });

  it("a withdrawal beyond the stock makes it negative and flagged, not refused; the windows count the withdrawal day", async () => {
    const feedId = await newFeed("Hűtő-teszt kettő");
    await receive("2026-08-03", feedId, { quantities: [{ value: "100", unitId: unit.g }] }, f.admin);
    // a withdrawal 20 days before "now": in the month, not in the week
    await take("2026-08-05", feedId, { quantities: [{ value: "60", unitId: unit.g }] });
    await take("2026-08-24", feedId, { quantities: [{ value: "70", unitId: unit.g }] });
    const r = (await rowsOf(feedId, at("2026-08-25", "12:00")))[0];
    expect(r).toMatchObject({ received: 100, taken: 130, level: -30, negative: true, week: 70, month: 130 });
  });

  it("a feed with withdrawals and no intake is listed as not tracked: it has no starting stock", async () => {
    const feedId = await newFeed("Hűtő-teszt három");
    await take("2026-08-10", feedId, { quantities: [{ value: "40", unitId: unit.g }] });
    const [r] = await rowsOf(feedId, at("2026-08-11", "12:00"));
    expect(r).toMatchObject({ tracked: false, level: -40, negative: true });
  });

  it("an other feed has its own row per name, whatever the case of the name; the name is required", async () => {
    const other = (await prisma.feed.findFirstOrThrow({ where: { type: { code: "EGYEB" } } })).id;
    await expectCode(receive("2026-08-12", other, { quantities: [{ value: "10", unitId: unit.g }] }), "OTHER_NAME");
    await receive("2026-08-12", other, { otherName: "Hűtő-teszt Rák", quantities: [{ value: "10", unitId: unit.g }] });
    await receive("2026-08-12", other, { otherName: "hűtő-teszt rák", quantities: [{ value: "5", unitId: unit.g }] });
    await receive("2026-08-12", other, { otherName: "Hűtő-teszt kagyló", quantities: [{ value: "7", unitId: unit.g }] });
    const rows = (await feedStock(at("2026-08-13", "12:00"))).filter((r) => r.otherName && /^hűtő-teszt/i.test(r.otherName));
    expect(rows.map((r) => [r.otherName?.toLowerCase(), r.level])).toEqual([["hűtő-teszt kagyló", 7], ["hűtő-teszt rák", 15]]);
  });
});

describe("who may record intake, and when", () => {
  it("an aquarist records today and changes only their own; an earlier day is an admin's; the future is nobody's", async () => {
    const feedId = await newFeed("Hűtő-teszt négy");
    const d = "2026-08-19";
    const mine = (await receive(d, feedId, { quantities: [{ value: "10", unitId: unit.g }] })) as { itemId: string };
    // "now" is the day d; the day of the item is another
    const onDay = (day: string, actor = f.aq1, body: Record<string, unknown> = {}) =>
      saveIntakeItem(actor, { requestId: rid(), day, feedId, quantities: [{ value: "10", unitId: unit.g }], ...body } as Parameters<typeof saveIntakeItem>[1], at(d, "08:03"));
    await expectCode(onDay("2026-08-18"), "NOT_TODAY");
    await expectCode(onDay("2026-08-20"), "FUTURE_DAY");
    await expectCode(receive(d, feedId, { itemId: mine.itemId, expectedVersion: 1, quantities: [{ value: "12", unitId: unit.g }] }, f.aq2), "NOT_OWN");
    await expectCode(receive(d, feedId, { itemId: mine.itemId, expectedVersion: 5, quantities: [{ value: "12", unitId: unit.g }] }), "VERSION_CONFLICT");
    // moving it to an earlier day is the admin's too; an admin may record on an earlier day
    await expectCode(onDay("2026-08-18", f.aq1, { itemId: mine.itemId, expectedVersion: 1 }), "NOT_TODAY");
    await onDay("2026-08-18", f.admin, { reason: "késői rögzítés" });
    expect(await prisma.feedIntakeItem.count({ where: { feedId, intakeDay: new Date("2026-08-18") } })).toBe(1);
    await expectCode(invalidateIntakeItem(f.aq2, mine.itemId, { requestId: rid(), expectedVersion: 2, reason: "nem az enyém" }, at(d, "09:00")), "NOT_OWN");
  });

  it("a quantity must be positive and in a unit the feed allows; the same request id is stored once", async () => {
    const feedId = await newFeed("Hűtő-teszt öt");
    const d = "2026-08-19";
    await expectCode(receive(d, feedId, { quantities: [{ value: "0", unitId: unit.g }] }), "INVALID_VALUE");
    await expectCode(receive(d, feedId, { quantities: [{ value: "5", unitId: unit.ml }] }), "UNIT_DIMENSION");
    await expectCode(receive(d, feedId, { quantities: [{ value: "5", unitId: unit.g }, { value: "5", unitId: unit.kg }] }), "ONE_PER_DIMENSION");
    const id = rid();
    const body = { requestId: id, day: d, feedId, quantities: [{ value: "5", unitId: unit.g }] };
    expect(await saveIntakeItem(f.aq1, body, at(d, "08:00"))).toMatchObject({ replayed: false });
    expect(await saveIntakeItem(f.aq1, body, at(d, "08:01"))).toEqual({ replayed: true });
    expect(await prisma.feedIntakeItem.count({ where: { feedId } })).toBe(1);
  });

  it("an intake counts as a use of the feed: its unit stays", async () => {
    const feedId = await newFeed("Hűtő-teszt hat");
    expect((await listFeeds()).flatMap((t) => t.feeds).find((x) => x.id === feedId)?.uses).toBe(0);
    await receive("2026-08-19", feedId, { quantities: [{ value: "5", unitId: unit.g }] });
    expect((await listFeeds()).flatMap((t) => t.feeds).find((x) => x.id === feedId)?.uses).toBe(1);
  });
});
