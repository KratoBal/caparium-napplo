// Feed intake and the feed stock (the "Takarmányhűtő", Lili 2026-10-29 package item 9; Balázs 2026-10-30 10:17 UTC).
// What arrives in the freezer, a few times a week. The stock of a feed is never stored (R-16, as the chemicals): it is
// the sum of the valid intake that was not sent back, minus the valid withdrawals (withdrawal.ts). A delivery sent
// back stays on the list (it was here) but does not count. No day lock: the permission rules are the withdrawal's,
// an aquarist records and changes today's intake, an earlier day is an admin's with a reason.

import type { Dimension, FeedIntakeItem } from "@prisma/client";
import { z } from "zod";
import { diffFields, writeAudit } from "./audit";
import { prisma, type Tx } from "./db";
import { canonicalDecimal, compareDecimal, parseDecimalInput } from "./decimal";
import { AppError } from "./errors";
import { moduleLevel, pickValid } from "./master";
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
    if (!feed || !feed.active) throw new AppError(422, "FEED_NOT_FOUND", "A takarmány nem található vagy nem aktív.");
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
      item = await tx.feedIntakeItem.create({ data: { ...data, requestId: input.requestId, createdById: actor.id } });
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
};

const round = (v: number) => Math.round(v * 10000) / 10000;

/**
 * The feed stock per feed (and other name) and dimension, in base units, from the valid intake and withdrawals.
 * A feed with withdrawals but no intake is listed with tracked = false: it has no starting stock, so its level is
 * only a count of what was taken and must not raise an alert.
 */
export async function feedStock(now = new Date()): Promise<StockRow[]> {
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
  const weekFrom = dayToDate(addDays(today, -7));
  const monthFrom = dayToDate(addDays(today, -30));
  const todayDate = dayToDate(today);
  const rows = new Map<string, StockRow>();
  const row = (it: { feedId: string; otherName: string | null; feed: { names: { name: string; validFrom: Date; validTo: Date | null }[] } }, dimension: Dimension, unit: string) => {
    const key = `${it.feedId}|${it.otherName?.toLowerCase() ?? ""}|${dimension}`;
    let r = rows.get(key);
    if (!r) {
      const name = pickValid(it.feed.names, now)?.name ?? it.feed.names.at(-1)?.name ?? "?";
      r = { key, feedId: it.feedId, feed: it.otherName ? `${name}: ${it.otherName}` : name, otherName: it.otherName, dimension, unit, received: 0, returned: 0, taken: 0, level: 0, negative: false, week: 0, month: 0, tracked: false };
      rows.set(key, r);
    }
    return r;
  };
  for (const it of intake) {
    for (const q of it.quantities) {
      const r = row(it, q.unit.dimension, baseOf.get(q.unit.dimension) ?? q.unit.symbol);
      const v = Number(q.quantity) * Number(q.unit.factorToBase ?? 1);
      r.tracked = true;
      if (it.returned) r.returned += v;
      else r.received += v;
    }
  }
  for (const it of taken) {
    const d = it.withdrawalDay.businessDay;
    for (const q of it.quantities) {
      const r = row(it, q.unit.dimension, baseOf.get(q.unit.dimension) ?? q.unit.symbol);
      const v = Number(q.quantity) * Number(q.unit.factorToBase ?? 1);
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

/**
 * How long a tracked stock lasts at the average withdrawal of the last 30 days, and whether it is "running out" by the
 * chemicals' rule (notices.ts runningOut): at or below zero, or at most RUN_OUT_DAYS left. Without a withdrawal there is
 * no estimate (and no notice unless the level is at or below zero). Not tracked (no intake yet): never running out.
 */
export function stockStatus(r: Pick<StockRow, "level" | "month" | "tracked">): { daysLeft: number | null; low: boolean } {
  const perDay = r.month / 30;
  const daysLeft = perDay > 0 ? Math.round((r.level / perDay) * 10) / 10 : null;
  return { daysLeft, low: r.tracked && (r.level <= 0 || (daysLeft !== null && daysLeft <= RUN_OUT_DAYS)) };
}
