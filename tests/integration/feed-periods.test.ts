// Lili 2026-11-01 (point 14): a feed's feeding periods. The hard condition (acrobot, Caparium channel msg 1566458497246437448):
// for TODAY every list shows exactly what it showed before; that is the first describe. Days in 2019, used by no other test.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { feedsOn, setFeedPeriods } from "@/lib/feed-periods";
import { saveIntakeItem } from "@/lib/feed-intake";
import { setDayFeeds } from "@/lib/feeding";
import { listFeeds, updateFeed } from "@/lib/feeds";
import { addDays, businessDayOf, dateToDay } from "@/lib/time";
import { saveWithdrawalItem } from "@/lib/withdrawal";
import { fixtures, ownerPrisma, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const unit: Record<string, string> = {};
const at = (d: string, t: string) => new Date(`${d}T${t}:00+01:00`);

beforeAll(async () => {
  f = await fixtures();
  for (const u of await prisma.unit.findMany()) unit[u.symbol] = u.id;
});

async function code(p: Promise<unknown>): Promise<string> {
  const e = await p.then(() => null, (err: unknown) => err);
  expect(e).toBeInstanceOf(AppError);
  return (e as AppError).code;
}

/** A feed as the old code made it: the flag only, no period (what the migration found). */
async function bareFeed(name: string, active: boolean) {
  const type = await prisma.feedType.findUniqueOrThrow({ where: { code: "RAK" } });
  return prisma.feed.create({
    data: { typeId: type.id, allowedDimensions: ["MASS"], defaultUnitId: unit.g, sortOrder: 900, active, names: { create: { name, validFrom: new Date("2018-01-01T00:00:00Z") } } },
  });
}

/** The migration's own INSERT, read from its file and run as the owner (the statement that gives the existing feeds their period). */
async function runMigrationInsert() {
  const sql = readFileSync(join(process.cwd(), "prisma/migrations/20261101200000_feed_periods/migration.sql"), "utf8");
  const insert = sql.slice(sql.indexOf('INSERT INTO "feed_period"'), sql.indexOf(";", sql.indexOf('INSERT INTO "feed_period"')) + 1);
  expect(insert).toContain("DATE '2018-12-07'");
  await ownerPrisma.$executeRawUnsafe(insert);
}

const offeredToday = async () =>
  new Map((await listFeeds()).flatMap((t) => t.feeds.map((x) => [x.id, x.active] as const)));

describe("today's lists do not change (the hard condition)", () => {
  it("the migration gives the active feeds an open period, the inactive ones one ending yesterday: today the same feeds are offered", async () => {
    const on = await bareFeed("Időszak-próba aktív", true);
    const off = await bareFeed("Időszak-próba inaktív", false);
    await runMigrationInsert();
    const today = businessDayOf(new Date());
    const periods = await prisma.feedPeriod.findMany({ where: { feedId: { in: [on.id, off.id] } } });
    expect(periods.map((p) => [p.feedId === on.id ? "on" : "off", dateToDay(p.firstDay), p.lastDay ? dateToDay(p.lastDay) : null]).sort()).toEqual([
      ["off", "2018-12-07", addDays(today, -1)],
      ["on", "2018-12-07", null],
    ]);
    // every feed of the database no test switched (the seeded ones, the two above): offered today exactly when its old flag
    // was on. A feed another test file switched at a day of its own (helpers.test, at a day in the future) is left out: its flag
    // tells that test's day, not today.
    const touched = new Set((await prisma.auditEntry.findMany({ where: { entityType: "Feed", action: "MASTER_CHANGE" }, select: { entityId: true } })).map((e) => e.entityId));
    const flags = new Map((await prisma.feed.findMany({ select: { id: true, active: true } })).filter((x) => !touched.has(x.id)).map((x) => [x.id, x.active]));
    expect(flags.size).toBeGreaterThan(10);
    expect(flags.get(off.id)).toBe(false);
    const today2 = await offeredToday();
    for (const [id, active] of flags) expect(today2.get(id), id).toBe(active);
    // the control: the inactive feed was offered yesterday (its period ends then), so the check above is not a constant
    expect((await feedsOn(prisma, addDays(today, -1))).has(off.id)).toBe(true);
    expect((await feedsOn(prisma, today)).has(off.id)).toBe(false);
    // and a second run gives no feed a second period
    await runMigrationInsert();
    expect(await prisma.feedPeriod.count({ where: { feedId: { in: [on.id, off.id] } } })).toBe(2);
  });
});

describe("a day's list follows the periods", () => {
  it("a feed of 2019 only is offered on its days and refused on the others, on every list and every save", async () => {
    const x = await bareFeed("Crangon 2019", true);
    await setFeedPeriods(f.admin, x.id, { requestId: rid(), periods: [{ firstDay: "2019-01-01", lastDay: "2019-12-31" }] });
    const shown = async (day: string) => (await listFeeds(new Date(), day)).flatMap((t) => t.feeds).find((y) => y.id === x.id)!.active;
    expect([await shown("2018-12-31"), await shown("2019-01-01"), await shown("2019-12-31"), await shown("2020-01-01")]).toEqual([false, true, true, false]);
    // the flag follows today's state
    expect((await prisma.feed.findUniqueOrThrow({ where: { id: x.id } })).active).toBe(false);
    const take = (d: string) => saveWithdrawalItem(f.admin, { requestId: rid(), day: d, feedId: x.id, quantities: [{ value: "10", unitId: unit.g }], reason: "régi adat" }, at(d, "09:00"));
    await take("2019-06-03");
    expect(await code(take("2020-02-03"))).toBe("FEED_NOT_FOUND");
    const receive = (d: string) => saveIntakeItem(f.admin, { requestId: rid(), day: d, feedId: x.id, quantities: [{ value: "1", unitId: unit.kg }], reason: "régi adat" }, at(d, "08:00"));
    await receive("2019-06-04");
    expect(await code(receive("2020-02-04"))).toBe("FEED_NOT_FOUND");
    const dayFeeds = (d: string) => setDayFeeds(f.admin, { requestId: rid(), day: d, feedIds: [x.id], reason: "régi adat" }, at(d, "09:00"));
    await dayFeeds("2019-06-05");
    expect(await code(dayFeeds("2020-02-05"))).toBe("FEED_NOT_FOUND");
  });
});

describe("the admin's periods", () => {
  it("only an admin; overlapping periods refused with the reason; the old list is in the audit", async () => {
    const x = await bareFeed("Időszak-szerkesztés", true);
    await runMigrationInsert();
    expect(await code(setFeedPeriods(f.aq1, x.id, { requestId: rid(), periods: [] }))).toBe("ADMIN_ONLY");
    expect(await code(setFeedPeriods(f.admin, x.id, { requestId: rid(), periods: [{ firstDay: "2019-01-01", lastDay: null }, { firstDay: "2020-01-01", lastDay: null }] }))).toBe("BAD_PERIODS");
    expect(await code(setFeedPeriods(f.admin, x.id, { requestId: rid(), periods: [{ firstDay: "2019-05-01", lastDay: "2019-04-01" }] }))).toBe("BAD_PERIODS");
    const r = rid();
    await setFeedPeriods(f.admin, x.id, { requestId: r, periods: [{ firstDay: "2021-01-01", lastDay: null }, { firstDay: "2018-12-07", lastDay: "2019-12-31" }] });
    const audit = await prisma.auditEntry.findFirstOrThrow({ where: { requestId: r } });
    expect(audit.changes).toEqual({
      periods: {
        before: [{ firstDay: "2018-12-07", lastDay: null }],
        after: [{ firstDay: "2018-12-07", lastDay: "2019-12-31" }, { firstDay: "2021-01-01", lastDay: null }],
      },
    });
    // the renovation gap (2020) is no day of it
    const on = async (d: string) => (await feedsOn(prisma, d)).has(x.id);
    expect([await on("2019-12-31"), await on("2020-06-01"), await on("2021-01-01")]).toEqual([true, false, true]);
  });

  it("the old switch closes the period at yesterday and opens one from today", async () => {
    const x = await bareFeed("Időszak-kapcsoló", true);
    await runMigrationInsert();
    const now = new Date();
    const today = businessDayOf(now);
    await updateFeed(f.admin, x.id, { requestId: rid(), active: false }, now);
    const on = async (d: string) => (await feedsOn(prisma, d)).has(x.id);
    expect([await on(addDays(today, -1)), await on(today)]).toEqual([true, false]);
    await updateFeed(f.admin, x.id, { requestId: rid(), active: true }, now);
    expect([await on(addDays(today, -1)), await on(today)]).toEqual([true, true]);
    const periods = await prisma.feedPeriod.findMany({ where: { feedId: x.id }, orderBy: { firstDay: "asc" } });
    expect(periods.map((p) => [dateToDay(p.firstDay), p.lastDay ? dateToDay(p.lastDay) : null])).toEqual([
      ["2018-12-07", addDays(today, -1)],
      [today, null],
    ]);
  });
});
