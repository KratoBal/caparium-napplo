// Feed intake and the feed stock (the "Takarmányhűtő", Lili 2026-10-29 package item 9; Balázs 2026-10-30 10:17 UTC).
// What arrives in the freezer, a few times a week. The stock of a feed is never stored (R-16, as the chemicals): it is
// the sum of the valid intake that was not sent back, minus the valid withdrawals (withdrawal.ts). A delivery sent
// back stays on the list (it was here) but does not count. No day lock: the permission rules are the withdrawal's,
// an aquarist records and changes today's intake, an earlier day is an admin's with a reason.

import type { Dimension, FeedIntakeItem } from "@prisma/client";
import { z } from "zod";
import { diffFields, writeAudit } from "./audit";
import { feedIsOn, feedsOn } from "./feed-periods";
import { prisma, type Tx } from "./db";
import { canonicalDecimal, compareDecimal, parseDecimalInput } from "./decimal";
import { AppError } from "./errors";
import { getSetting, moduleLevel, pickValid } from "./master";
import { otherKey, otherLabel } from "./other-name";
import type { Actor } from "./measurements";
import { canCreate, canModify, effectiveNow, type Decision, type Level } from "./permissions";
import { RUN_OUT_DAYS } from "./notices";
import { requireReason } from "./reasons";
import { addDays, businessDayOf, dateToDay, dayToDate } from "./time";

const requestId = z.string().min(8).max(100);
const reason = z.string().trim().min(3, "Az indoklás legalább 3 karakter legyen.").max(500);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const exportSafe = (v: string) => !/^[=+\-@\t\r]/.test(v);

export const intakeSchema = z.object({
  requestId,
  clientTimestamp: z.iso.datetime({ offset: true }).optional(),
  day,
  itemId: z.uuid().optional(),
  expectedVersion: z.number().int().min(1).optional(),
  feedId: z.uuid(),
  otherName: z.string().trim().min(1).max(60).refine(exportSafe, "A név nem kezdődhet =, +, -, @ jellel.").optional(),
  quantities: z.array(z.object({ value: z.string().min(1).max(32), unitId: z.uuid() })).min(1).max(3),
  note: z.string().trim().min(1).max(200).refine(exportSafe, "A megjegyzés nem kezdődhet =, +, -, @ jellel.").optional(),
  returned: z.boolean().default(false),
  reason: reason.optional(),
});
export type IntakeInput = z.input<typeof intakeSchema>;
export const intakeInvalidateSchema = z.object({ requestId, expectedVersion: z.number().int().min(1), reason: reason.optional() });

async function enforce(tx: Tx, decision: Decision, why: string | undefined) {
  if (decision.kind === "DENY") throw new AppError(403, decision.code, decision.message);
  await requireReason(tx, decision.reasonRequired, why, "Korábbi nap módosításához indoklás kell.");
}

function snapshot(i: FeedIntakeItem, q: { quantity: string; unitId: string }[]) {
  return { feedId: i.feedId, otherName: i.otherName, note: i.note, returned: i.returned, intakeDay: dateToDay(i.intakeDay), quantities: q, status: i.status };
}

/** Records or changes one intake item. */
export async function saveIntakeItem(actor: Actor, raw: IntakeInput, serverNow = new Date()) {
  const input = intakeSchema.parse(raw);
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  const clientTs = input.clientTimestamp ? new Date(input.clientTimestamp) : null;
  return prisma.$transaction(async (tx) => {
    const level: Level = await moduleLevel(tx, actor.id, actor.role, "WITHDRAWAL");
    const today = businessDayOf(effectiveNow(serverNow, clientTs, 30, 48).now);
    if (input.day > today) throw new AppError(422, "FUTURE_DAY", "A beérkezés napja nem lehet jövőbeli.");
    const prior = input.itemId ? await tx.feedIntakeItem.findUnique({ where: { id: input.itemId }, include: { quantities: true } }) : null;
    if (input.itemId) {
      if (!prior) throw new AppError(404, "NOT_FOUND", "A tétel nem található.");
      if (prior.status !== "VALID") throw new AppError(409, "NOT_EDITABLE", "Ez a tétel már nem érvényes.");
      if (prior.version !== input.expectedVersion) throw new AppError(409, "VERSION_CONFLICT", "A tétel időközben megváltozott.");
      // the day it was on and the day it moves to must both be allowed (R-6)
      await enforce(tx, canModify(level, { day: dateToDay(prior.intakeDay), today, closed: false, isOwn: prior.createdById === actor.id, targetDay: input.day }), input.reason);
    } else {
      await enforce(tx, canCreate(level, { day: input.day, today, closed: false }), input.reason);
    }
    // the feed's row FOR SHARE: a change of its unit (feeds.ts) waits for this save, and this one for it
    await tx.$queryRaw`SELECT "id" FROM "feed" WHERE "id" = ${input.feedId}::uuid FOR SHARE`;
    const feed = await tx.feed.findUnique({ where: { id: input.feedId }, include: { type: true } });
    // point 14: the feed is offered on the day by its period, as the list of that day
    if (!feed || !(await feedIsOn(tx, feed.id, input.day))) throw new AppError(422, "FEED_NOT_FOUND", "A takarmány nem található, vagy ezen a napon nincs etetési időszaka.");
    const isOther = feed.type.code === "EGYEB";
    if (isOther && !input.otherName) throw new AppError(422, "OTHER_NAME", "Az „Egyéb” takarmányhoz a nevét is meg kell adni.");
    const otherName = isOther ? input.otherName! : null;
    const units = await tx.unit.findMany({ where: { id: { in: input.quantities.map((q) => q.unitId) } } });
    const seen = new Set<Dimension>();
    const quantities = input.quantities.map((q) => {
      const u = units.find((x) => x.id === q.unitId);
      if (!u) throw new AppError(422, "UNIT_NOT_FOUND", "Ismeretlen mértékegység.");
      if (!feed.allowedDimensions.includes(u.dimension)) throw new AppError(422, "UNIT_DIMENSION", `Ez a takarmány nem mérhető ebben az egységben (${u.symbol}).`);
      if (seen.has(u.dimension)) throw new AppError(422, "ONE_PER_DIMENSION", "Egy tételben dimenziónként egy mennyiség lehet.");
      seen.add(u.dimension);
      const v = parseDecimalInput(q.value);
      if (v === null || compareDecimal(v, "0") <= 0) throw new AppError(422, "INVALID_VALUE", "A mennyiség pozitív szám legyen.");
      return { quantity: v, unitId: u.id, dimension: u.dimension };
    });
    const data = { intakeDay: dayToDate(input.day), feedId: feed.id, otherName, note: input.note ?? null, returned: input.returned, updatedById: actor.id, updatedAt: serverNow };
    let item: FeedIntakeItem;
    if (prior) {
      const res = await tx.feedIntakeItem.updateMany({ where: { id: prior.id, version: prior.version, status: "VALID" }, data: { ...data, version: { increment: 1 } } });
      if (res.count !== 1) throw new AppError(409, "VERSION_CONFLICT", "A tétel időközben megváltozott.");
      await tx.feedIntakeQuantity.deleteMany({ where: { itemId: prior.id } });
      item = await tx.feedIntakeItem.findUniqueOrThrow({ where: { id: prior.id } });
    } else {
      // createdAt is the save's clock (the database's is the same live): the stock starts at the first RECORDED intake (feedStock)
      item = await tx.feedIntakeItem.create({ data: { ...data, requestId: input.requestId, createdById: actor.id, createdAt: serverNow } });
    }
    await tx.feedIntakeQuantity.createMany({ data: quantities.map((q) => ({ ...q, itemId: item.id })) });
    await writeAudit(tx, {
      userId: actor.id,
      action: prior ? "UPDATE" : "CREATE",
      entityType: "FeedIntakeItem",
      entityId: item.id,
      changes: diffFields(
        prior ? snapshot(prior, prior.quantities.map((q) => ({ quantity: canonicalDecimal(q.quantity), unitId: q.unitId }))) : null,
        snapshot(item, quantities.map((q) => ({ quantity: q.quantity, unitId: q.unitId }))),
      ),
      reason: input.reason ?? null,
      requestId: input.requestId,
      clientTimestamp: clientTs,
    });
    return { replayed: false, itemId: item.id, version: item.version };
  });
}

export async function invalidateIntakeItem(actor: Actor, id: string, raw: z.input<typeof intakeInvalidateSchema>, serverNow = new Date()) {
  const input = intakeInvalidateSchema.parse(raw);
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  return prisma.$transaction(async (tx) => {
    const it = await tx.feedIntakeItem.findUnique({ where: { id } });
    if (!it) throw new AppError(404, "NOT_FOUND", "A tétel nem található.");
    const level: Level = await moduleLevel(tx, actor.id, actor.role, "WITHDRAWAL");
    await enforce(tx, canModify(level, { day: dateToDay(it.intakeDay), today: businessDayOf(serverNow), closed: false, isOwn: it.createdById === actor.id }), input.reason);
    await requireReason(tx, true, input.reason, "Az érvénytelenítéshez indoklás kell.");
    const res = await tx.feedIntakeItem.updateMany({
      where: { id, version: input.expectedVersion, status: "VALID" },
      data: { status: "INVALIDATED", invalidationReason: input.reason, version: { increment: 1 }, updatedById: actor.id, updatedAt: serverNow },
    });
    if (res.count !== 1) throw new AppError(409, "VERSION_CONFLICT", "A tétel időközben megváltozott.");
    await writeAudit(tx, { userId: actor.id, action: "INVALIDATE", entityType: "FeedIntakeItem", entityId: id, changes: { status: { before: "VALID", after: "INVALIDATED" } }, reason: input.reason, requestId: input.requestId });
    return { replayed: false };
  });
}

async function baseUnits() {
  return new Map((await prisma.unit.findMany({ where: { isBase: true } })).map((u) => [u.dimension, u.symbol]));
}

/** The intake of a day, valid items, a returned one included (it shows, it does not count). */
export async function intakeDayView(d: string) {
  const at = dayToDate(d);
  const items = await prisma.feedIntakeItem.findMany({
    where: { status: "VALID", intakeDay: at },
    include: { quantities: { include: { unit: true } }, feed: { include: { names: true, type: true } } },
    orderBy: { createdAt: "asc" },
  });
  const when = new Date(at.getTime());
  return items.map((it) => ({
    id: it.id,
    version: it.version,
    type: it.feed.type.name,
    feedId: it.feedId,
    feed: pickValid(it.feed.names, when)?.name ?? it.feed.names.at(-1)?.name ?? "?",
    otherName: it.otherName,
    note: it.note,
    returned: it.returned,
    quantities: it.quantities.map((q) => ({ value: canonicalDecimal(q.quantity), unit: q.unit.symbol, unitId: q.unitId, dimension: q.unit.dimension })),
    createdById: it.createdById,
  }));
}

export type StockRow = {
  /** feed id, the lower-case other name and the dimension: the same feed under another name is another row */
  key: string;
  feedId: string;
  feed: string;
  /** the other name as a key (otherKey), null for a plain feed */
  otherName: string | null;
  dimension: Dimension;
  /** the base unit of the dimension: every number below is in it */
  unit: string;
  received: number;
  /** sent back: shown, not counted */
  returned: number;
  taken: number;
  level: number;
  negative: boolean;
  /** withdrawn in the last 7 and 30 days */
  week: number;
  month: number;
  /** at least one intake exists: only then is the level a stock and not a count from zero (no starting stock) */
  tracked: boolean;
  /** the feed is in use: an inactive feed (Lili takes it out of the list) stays in the history but raises no alert and is not on the stock card */
  active: boolean;
};

const round = (v: number) => Math.round(v * 10000) / 10000;

const startDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const stockStartSchema = z.object({
  requestId,
  /** the first day the stock counts; empty puts it back to "from each feed's first intake that was not sent back" */
  start: z.union([startDay, z.literal("")]),
});

/** The set start of the stock ("YYYY-MM-DD"), or null when none is set. Read at the real now: an operational setting. */
export async function getStockStart(tx: Tx | typeof prisma = prisma): Promise<string | null> {
  const v = (await getSetting(tx as Tx, "feed_stock_start")).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** An admin sets the stock's first day, or clears it. The intake and the withdrawals before it are archive: nothing is deleted. */
export async function setStockStart(actor: Actor, raw: z.input<typeof stockStartSchema>, serverNow = new Date()) {
  const input = stockStartSchema.parse(raw);
  if ((await moduleLevel(prisma, actor.id, actor.role, "WITHDRAWAL")) !== "ADMIN") {
    throw new AppError(403, "ADMIN_ONLY", "A készlet kezdetét csak adminisztrátor állíthatja.");
  }
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  if (input.start > businessDayOf(serverNow)) throw new AppError(422, "FUTURE_DAY", "A készlet kezdete nem lehet jövőbeli nap.");
  return prisma.$transaction(async (tx) => {
    const before = await getStockStart(tx);
    if ((before ?? "") === input.start) throw new AppError(422, "NO_CHANGE", "Nincs változás.");
    const row = await tx.setting.create({ data: { key: "feed_stock_start", value: input.start, validFrom: serverNow, changedById: actor.id } });
    await writeAudit(tx, {
      userId: actor.id,
      action: "MASTER_CHANGE",
      entityType: "Setting",
      entityId: row.id,
      changes: { feed_stock_start: { before, after: input.start || null } },
      requestId: input.requestId,
    });
    return { replayed: false };
  });
}

/**
 * The feed stock per feed (and other name) and dimension, in base units, from the valid intake and withdrawals.
 * `until` (a day): the stock at the end of that day. With a start day set (setStockStart) only the intake and withdrawals from that day count. It counts from the day of the first intake that was not sent back: the intake from then on, minus the withdrawals from
 * then on (Lili's "az első bevételezéstől számít"; the withdrawals of before are from a time the stock was not kept). A
 * delivery that was only ever sent back does not start it. A feed with withdrawals but no received intake is listed with
 * tracked = false: it has no starting stock, so its level is only a count of what was taken and must not raise an alert.
 */
export async function feedStock(now = new Date(), until?: string): Promise<StockRow[]> {
  const today = businessDayOf(now);
  const [intake, taken, baseOf] = await Promise.all([
    prisma.feedIntakeItem.findMany({
      where: { status: "VALID" },
      include: { quantities: { include: { unit: true } }, feed: { include: { names: true } } },
    }),
    prisma.withdrawalItem.findMany({
      where: { status: "VALID" },
      include: { quantities: { include: { unit: true } }, feed: { include: { names: true } }, withdrawalDay: true },
    }),
    baseUnits(),
  ]);
  // "in use" (no alert, not on the stock card when off): fed today by its period (point 14), not the old flag
  const onToday = await feedsOn(prisma, today);
  const weekFrom = dayToDate(addDays(today, -7));
  const monthFrom = dayToDate(addDays(today, -30));
  const todayDate = dayToDate(today);
  // the explicit start of the stock (an admin's, Takarmányhűtő page): what is dated before it is archive, not stock
  const set = await getStockStart();
  const archiveBefore = set ? dayToDate(set) : null;
  // `until`: the stock as it stood at the end of that day (the export's closing stock); later items are not yet in it
  const untilDate = until ? dayToDate(until) : null;
  const rows = new Map<string, StockRow>();
  const row = (it: { feedId: string; otherName: string | null; feed: { names: { name: string; validFrom: Date; validTo: Date | null }[] } }, dimension: Dimension, unit: string) => {
    // the other name as the reports and the Excel read it (other-name.ts): case and spaces do not make a second row
    const other = it.otherName ? otherKey(it.otherName) : null;
    const key = `${it.feedId}|${other ?? ""}|${dimension}`;
    let r = rows.get(key);
    if (!r) {
      const name = pickValid(it.feed.names, now)?.name ?? it.feed.names.at(-1)?.name ?? "?";
      r = { key, feedId: it.feedId, feed: other ? `${name}: ${otherLabel(other)}` : name, otherName: other, dimension, unit, received: 0, returned: 0, taken: 0, level: 0, negative: false, week: 0, month: 0, tracked: false, active: onToday.has(it.feedId) };
      rows.set(key, r);
    }
    return r;
  };
  // the day of each row's first intake that was NOT sent back: the stock counts from there (Lili's screen, 2026-10-30 11:26 UTC).
  // "First" is the first RECORDED (the smallest createdAt), not the earliest-dated: an intake of 2019 keyed in today must not
  // draw the start back and take every old withdrawal out of today's stock (Lili keys old data in back to 2018; acrobot 40205,
  // A3: measured 1000 g became 800 g). The set start (feed_stock_start) still overrides this, as before.
  const from = new Map<string, Date>();
  const firstRecorded = new Map<string, Date>();
  const inScope = intake.filter((it) => !(archiveBefore && it.intakeDay < archiveBefore) && !(untilDate && it.intakeDay > untilDate));
  for (const it of inScope) {
    if (it.returned) continue;
    for (const q of it.quantities) {
      const r = row(it, q.unit.dimension, baseOf.get(q.unit.dimension) ?? q.unit.symbol);
      r.tracked = true;
      const first = firstRecorded.get(r.key);
      if (!first || it.createdAt < first) {
        firstRecorded.set(r.key, it.createdAt);
        from.set(r.key, it.intakeDay);
      }
    }
  }
  // an intake dated before the start is archive, as a withdrawal is; a send-back is only shown (it never was in the stock), as before
  for (const it of inScope) {
    for (const q of it.quantities) {
      const r = row(it, q.unit.dimension, baseOf.get(q.unit.dimension) ?? q.unit.symbol);
      const v = Number(q.quantity) * Number(q.unit.factorToBase ?? 1);
      if (it.returned) {
        r.returned += v;
        continue;
      }
      const start = from.get(r.key);
      if (start && it.intakeDay < start) continue;
      r.received += v;
    }
  }
  for (const it of taken) {
    const d = it.withdrawalDay.businessDay;
    if (archiveBefore && d < archiveBefore) continue;
    if (untilDate && d > untilDate) continue;
    for (const q of it.quantities) {
      const r = row(it, q.unit.dimension, baseOf.get(q.unit.dimension) ?? q.unit.symbol);
      const v = Number(q.quantity) * Number(q.unit.factorToBase ?? 1);
      // a withdrawal before the first received intake is from before the stock existed: it is not taken from it
      const start = from.get(r.key);
      if (start && d < start) continue;
      r.taken += v;
      if (d > weekFrom && d <= todayDate) r.week += v;
      if (d > monthFrom && d <= todayDate) r.month += v;
    }
  }
  return [...rows.values()]
    .map((r) => {
      const level = round(r.received - r.taken);
      return { ...r, received: round(r.received), returned: round(r.returned), taken: round(r.taken), week: round(r.week), month: round(r.month), level, negative: level < 0 };
    })
    .sort((a, b) => a.feed.localeCompare(b.feed, "hu") || a.unit.localeCompare(b.unit));
}

export type BalanceRow = {
  key: string;
  feedId: string;
  feed: string;
  dimension: Dimension;
  unit: string;
  /** the stock at the start of the period's first day */
  opening: number;
  /** received in the period (a delivery sent back does not count) */
  received: number;
  /** taken from the stock in the period */
  taken: number;
  /** taken in the period before this feed's stock started (before its first intake): not from the stock */
  beforeStock: number;
  /** opening + received - taken: the stock at the end of the period's last day (for a tracked feed feedStock's level; 0 otherwise) */
  closing: number;
  tracked: boolean;
  active: boolean;
};

/**
 * Lili 2026-11-01 (point 7): the period's balance per feed and dimension, by feedStock's rules: what is dated before the set start
 * of the stock is archive; the stock counts from the feed's first RECORDED intake that was not sent back (A3), so a withdrawal before it is not
 * taken from the stock. Such a withdrawal inside the period stands in its own column ("before the stock started"), and does not
 * make the opening negative: a feed without a stock yet opens at 0, not at minus its withdrawals (feedStock's tracked = false
 * level). For a tracked feed the closing is feedStock(until = to)'s level; a feed without a stock closes at 0 (feedStock counts it
 * down by its withdrawals, which here stand in "before the stock started"; barracuda on #169).
 */
export async function feedBalance(from: string, to: string, now = new Date()): Promise<BalanceRow[]> {
  const [intake, taken, baseOf, set] = await Promise.all([
    // every intake, not only those up to `to`: the stock's start is the first RECORDED one, which may be dated after the period
    prisma.feedIntakeItem.findMany({
      where: { status: "VALID", returned: false },
      include: { quantities: { include: { unit: true } }, feed: { include: { names: true } } },
    }),
    prisma.withdrawalItem.findMany({
      where: { status: "VALID", withdrawalDay: { businessDay: { lte: dayToDate(to) } } },
      include: { quantities: { include: { unit: true } }, feed: { include: { names: true } }, withdrawalDay: true },
    }),
    baseUnits(),
    getStockStart(),
  ]);
  // "in use": fed today by its periods (point 14), not the old flag, which a period's end by the calendar leaves behind (barracuda)
  const onToday = await feedsOn(prisma, businessDayOf(now));
  const archiveBefore = set ? dayToDate(set) : null;
  const fromDate = dayToDate(from);
  const rows = new Map<string, BalanceRow>();
  const row = (it: { feedId: string; otherName: string | null; feed: { names: { name: string; validFrom: Date; validTo: Date | null }[] } }, dimension: Dimension, unit: string) => {
    const other = it.otherName ? otherKey(it.otherName) : null;
    const key = `${it.feedId}|${other ?? ""}|${dimension}`;
    let r = rows.get(key);
    if (!r) {
      const name = pickValid(it.feed.names, now)?.name ?? it.feed.names.at(-1)?.name ?? "?";
      r = { key, feedId: it.feedId, feed: other ? `${name}: ${otherLabel(other)}` : name, dimension, unit, opening: 0, received: 0, taken: 0, beforeStock: 0, closing: 0, tracked: false, active: onToday.has(it.feedId) };
      rows.set(key, r);
    }
    return r;
  };
  // the stock's start, as feedStock: the day of the first RECORDED intake (an old intake keyed in later does not draw it back)
  const toDate = dayToDate(to);
  const first = new Map<string, Date>();
  const firstRecorded = new Map<string, Date>();
  const counted = intake.filter((it) => !(archiveBefore && it.intakeDay < archiveBefore));
  for (const it of counted) {
    for (const q of it.quantities) {
      const key = `${it.feedId}|${it.otherName ? otherKey(it.otherName) : ""}|${q.unit.dimension}`;
      const f = firstRecorded.get(key);
      if (!f || it.createdAt < f) {
        firstRecorded.set(key, it.createdAt);
        first.set(key, it.intakeDay);
      }
    }
  }
  for (const it of counted) {
    if (it.intakeDay > toDate) continue;
    for (const q of it.quantities) {
      const r = row(it, q.unit.dimension, baseOf.get(q.unit.dimension) ?? q.unit.symbol);
      const start = first.get(r.key);
      // dated before the stock's start: archive, as in feedStock
      if (start && it.intakeDay < start) continue;
      const v = Number(q.quantity) * Number(q.unit.factorToBase ?? 1);
      if (it.intakeDay < fromDate) r.opening += v;
      else r.received += v;
      r.tracked = true;
    }
  }
  for (const it of taken) {
    const d = it.withdrawalDay.businessDay;
    if (archiveBefore && d < archiveBefore) continue;
    for (const q of it.quantities) {
      const r = row(it, q.unit.dimension, baseOf.get(q.unit.dimension) ?? q.unit.symbol);
      const v = Number(q.quantity) * Number(q.unit.factorToBase ?? 1);
      const start = first.get(r.key);
      if (!start || d < start) {
        // not from the stock; before the period it is not this period's business either
        if (d >= fromDate) r.beforeStock += v;
      } else if (d < fromDate) r.opening -= v;
      else r.taken += v;
    }
  }
  return [...rows.values()]
    .map((r) => ({ ...r, opening: round(r.opening), received: round(r.received), taken: round(r.taken), beforeStock: round(r.beforeStock), closing: round(r.opening + r.received - r.taken) }))
    .filter((r) => r.opening !== 0 || r.received !== 0 || r.taken !== 0 || r.beforeStock !== 0 || (r.tracked && r.active))
    .sort((a, b) => a.feed.localeCompare(b.feed, "hu") || a.unit.localeCompare(b.unit));
}

/**
 * How long a tracked stock lasts at the average withdrawal of the last 30 days, and whether it is "running out" by the
 * chemicals' rule (notices.ts runningOut): at or below zero, or at most RUN_OUT_DAYS left. Without a withdrawal there is
 * no estimate (and no notice unless the level is at or below zero). Not tracked (no intake yet) or inactive (taken out of the
 * feed list): never running out, so a feed Lili retired with a stock of zero does not speak at every login.
 */
export function stockStatus(r: Pick<StockRow, "level" | "month" | "tracked" | "active">): { daysLeft: number | null; low: boolean } {
  const perDay = r.month / 30;
  // never negative: a stock at or below zero has run out, "0 days", not "-30"
  const daysLeft = perDay > 0 ? Math.max(0, Math.round((r.level / perDay) * 10) / 10) : null;
  return { daysLeft, low: r.tracked && r.active && (r.level <= 0 || (daysLeft !== null && daysLeft <= RUN_OUT_DAYS)) };
}
