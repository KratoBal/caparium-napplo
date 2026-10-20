// Feed withdrawal (adatmodell 12. terület; KIV-01..KIV-04, TAK-06, T-10, DN-17, R-11).
// What is taken out of the freezer on a day, for a use day (default the next day, T-10). Quantities per
// dimension as for the feeding items (T-08). The day's input closes with the "Lezárás" button (any
// aquarist, today) or at midnight; reopening is admin work with a reason (KIV-03, the journal days).
// NY-07 default (temporary, documented): no feed stock, only usage; the withdrawal items are the usage.

import type { Dimension, WithdrawalItem } from "@prisma/client";
import { z } from "zod";
import { diffFields, writeAudit } from "./audit";
import { prisma, type Tx } from "./db";
import { canonicalDecimal, compareDecimal, parseDecimalInput } from "./decimal";
import { AppError, isUniqueViolation } from "./errors";
import { dayBounds } from "./feeding";
import { ensureJournalDay, moduleLevel, pickValid } from "./master";
import { requireReason } from "./reasons";
import type { Actor } from "./measurements";
import { closedAt } from "./measurements";
import { canCreate, canModify, effectiveNow, type Decision, type Level } from "./permissions";
import { addDays, businessDayOf, dateToDay, dayToDate } from "./time";

export const OTHER_MAX = 5; // KIV-04, setting egyéb_takarmány_max
const USE_DAY_MAX_AHEAD = 7; // temporary: a use day at most a week after the withdrawal

const requestId = z.string().min(8).max(100);
const reason = z.string().trim().min(3, "Az indoklás legalább 3 karakter legyen.").max(500);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const exportSafe = (v: string) => !/^[=+\-@\t\r]/.test(v);

export async function ensureWithdrawalDay(tx: Tx, d: string) {
  const journal = await ensureJournalDay(tx, "WITHDRAWAL", null, d);
  await tx.$executeRaw`
    INSERT INTO "withdrawal_day" ("id", "businessDay", "journalDayId")
    VALUES (gen_random_uuid(), ${dayToDate(d)}::date, ${journal.id}::uuid)
    ON CONFLICT DO NOTHING`;
  const wd = await tx.withdrawalDay.findUniqueOrThrow({ where: { businessDay: dayToDate(d) } });
  return { wd, journal };
}

/** The writers of a withdrawal day wait for each other, as on a feeding day (review of #10). */
async function facts(tx: Tx, actor: Actor, d: string, serverNow: Date, clientTs: Date | null) {
  const level: Level = await moduleLevel(tx, actor.id, actor.role, "WITHDRAWAL");
  const ensured = await ensureWithdrawalDay(tx, d);
  await tx.$queryRaw`SELECT "id" FROM "withdrawal_day" WHERE "id" = ${ensured.wd.id}::uuid FOR UPDATE`;
  const journal = await tx.journalDay.findUniqueOrThrow({ where: { id: ensured.journal.id } });
  const eff = effectiveNow(serverNow, clientTs, 30, 48);
  return { level, wd: ensured.wd, journal, today: businessDayOf(eff.now), closed: closedAt(journal, eff.now) };
}

async function enforce(tx: Tx, decision: Decision, why: string | undefined) {
  if (decision.kind === "DENY") throw new AppError(403, decision.code, decision.message);
  await requireReason(tx, decision.reasonRequired, why, "Korábbi vagy lezárt nap módosításához indoklás kell.");
}

export const withdrawalSchema = z.object({
  requestId,
  clientTimestamp: z.iso.datetime({ offset: true }).optional(),
  day,
  useDay: day.optional(),
  itemId: z.uuid().optional(),
  expectedVersion: z.number().int().min(1).optional(),
  feedId: z.uuid(),
  otherName: z.string().trim().min(1).max(60).refine(exportSafe, "A név nem kezdődhet =, +, -, @ jellel.").optional(),
  quantities: z.array(z.object({ value: z.string().min(1).max(32), unitId: z.uuid() })).min(1).max(3),
  reason: reason.optional(),
});
export type WithdrawalInput = z.input<typeof withdrawalSchema>;
export const withdrawalInvalidateSchema = z.object({ requestId, expectedVersion: z.number().int().min(1), reason: reason.optional() });

function snapshot(i: WithdrawalItem, q: { quantity: string; unitId: string }[]) {
  return { feedId: i.feedId, otherName: i.otherName, useDay: dateToDay(i.useDay), quantities: q, status: i.status };
}

/** KIV-01, KIV-04: records or changes one withdrawal item. */
export async function saveWithdrawalItem(actor: Actor, raw: WithdrawalInput, serverNow = new Date()) {
  const input = withdrawalSchema.parse(raw);
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  const useDay = input.useDay ?? addDays(input.day, 1);
  if (useDay < input.day || useDay > addDays(input.day, USE_DAY_MAX_AHEAD)) {
    throw new AppError(422, "USE_DAY", `A felhasználás napja a kivétel napja és az azt követő ${USE_DAY_MAX_AHEAD} nap közé essen.`);
  }
  const clientTs = input.clientTimestamp ? new Date(input.clientTimestamp) : null;
  try {
    return await prisma.$transaction(async (tx) => {
      const f = await facts(tx, actor, input.day, serverNow, clientTs);
      const prior = input.itemId ? await tx.withdrawalItem.findUnique({ where: { id: input.itemId }, include: { quantities: true } }) : null;
      if (input.itemId) {
        if (!prior || prior.withdrawalDayId !== f.wd.id) throw new AppError(404, "NOT_FOUND", "A tétel nem található.");
        if (prior.status !== "VALID") throw new AppError(409, "NOT_EDITABLE", "Ez a tétel már nem érvényes.");
        if (prior.version !== input.expectedVersion) throw new AppError(409, "VERSION_CONFLICT", "A tétel időközben megváltozott.");
        await enforce(tx, canModify(f.level, { day: input.day, today: f.today, closed: f.closed, isOwn: prior.createdById === actor.id }), input.reason);
      } else {
        await enforce(tx, canCreate(f.level, { day: input.day, today: f.today, closed: f.closed }), input.reason);
      }
      const feed = await tx.feed.findUnique({ where: { id: input.feedId }, include: { type: true } });
      if (!feed || !feed.active) throw new AppError(422, "FEED_NOT_FOUND", "A takarmány nem található vagy nem aktív.");
      const isOther = feed.type.code === "EGYEB";
      if (isOther && !input.otherName) throw new AppError(422, "OTHER_NAME", "Az „Egyéb” takarmányhoz a nevét is meg kell adni (KIV-04).");
      const otherName = isOther ? input.otherName! : null;
      if (otherName) {
        // KIV-04: at most 5 different other names a day
        const names = await tx.withdrawalItem.findMany({
          where: { withdrawalDayId: f.wd.id, status: "VALID", otherName: { not: null }, ...(prior ? { id: { not: prior.id } } : {}) },
          select: { otherName: true, feedId: true },
        });
        // one name whatever its case (review note on #13). Checked here, not only by the index: the
        // database's lower() folds ASCII only, "É" and "é" would pass it
        if (names.some((x) => x.feedId === feed.id && x.otherName!.toLowerCase() === otherName.toLowerCase())) {
          throw new AppError(409, "CELL_TAKEN", "Ebből a takarmányból ma már van kivételi tétel: azt módosítsd.");
        }
        const distinct = new Set(names.map((n) => n.otherName!.toLowerCase()));
        if (!distinct.has(otherName.toLowerCase()) && distinct.size >= OTHER_MAX) {
          throw new AppError(422, "TOO_MANY_OTHER", `Egy napon legfeljebb ${OTHER_MAX} különböző egyéb takarmány vehető ki.`);
        }
      }
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
      const data = { withdrawalDayId: f.wd.id, useDay: dayToDate(useDay), feedId: feed.id, otherName, updatedById: actor.id, updatedAt: serverNow };
      let item: WithdrawalItem;
      if (prior) {
        const res = await tx.withdrawalItem.updateMany({ where: { id: prior.id, version: prior.version, status: "VALID" }, data: { ...data, version: { increment: 1 } } });
        if (res.count !== 1) throw new AppError(409, "VERSION_CONFLICT", "A tétel időközben megváltozott.");
        await tx.withdrawalQuantity.deleteMany({ where: { itemId: prior.id } });
        item = await tx.withdrawalItem.findUniqueOrThrow({ where: { id: prior.id } });
      } else {
        item = await tx.withdrawalItem.create({ data: { ...data, requestId: input.requestId, createdById: actor.id } });
      }
      await tx.withdrawalQuantity.createMany({ data: quantities.map((q) => ({ ...q, itemId: item.id })) });
      await writeAudit(tx, {
        userId: actor.id,
        action: prior ? "UPDATE" : "CREATE",
        entityType: "WithdrawalItem",
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
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError(409, "CELL_TAKEN", "Ebből a takarmányból ma már van kivételi tétel: azt módosítsd.");
    throw e;
  }
}

export async function invalidateWithdrawalItem(actor: Actor, id: string, raw: z.input<typeof withdrawalInvalidateSchema>, serverNow = new Date()) {
  const input = withdrawalInvalidateSchema.parse(raw);
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  return prisma.$transaction(async (tx) => {
    const it = await tx.withdrawalItem.findUnique({ where: { id }, include: { withdrawalDay: true } });
    if (!it) throw new AppError(404, "NOT_FOUND", "A tétel nem található.");
    const d = dateToDay(it.withdrawalDay.businessDay);
    const f = await facts(tx, actor, d, serverNow, null);
    await enforce(tx, canModify(f.level, { day: d, today: f.today, closed: f.closed, isOwn: it.createdById === actor.id }), input.reason);
    await requireReason(tx, true, input.reason, "Az érvénytelenítéshez indoklás kell.");
    const res = await tx.withdrawalItem.updateMany({
      where: { id, version: input.expectedVersion, status: "VALID" },
      data: { status: "INVALIDATED", invalidationReason: input.reason, version: { increment: 1 }, updatedById: actor.id, updatedAt: serverNow },
    });
    if (res.count !== 1) throw new AppError(409, "VERSION_CONFLICT", "A tétel időközben megváltozott.");
    await writeAudit(tx, { userId: actor.id, action: "INVALIDATE", entityType: "WithdrawalItem", entityId: id, changes: { status: { before: "VALID", after: "INVALIDATED" } }, reason: input.reason, requestId: input.requestId });
    return { replayed: false };
  });
}

export const closeSchema = z.object({ requestId, day });

/** KIV-03 "Lezárás": an aquarist closes today's input; an admin may close any open day. */
export async function closeWithdrawalDay(actor: Actor, raw: z.input<typeof closeSchema>, serverNow = new Date()) {
  const input = closeSchema.parse(raw);
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  return prisma.$transaction(async (tx) => {
    const f = await facts(tx, actor, input.day, serverNow, null);
    if (f.level === "NONE" || f.level === "READ") throw new AppError(403, "READ_ONLY", "A kivételi napot nem zárhatod le.");
    if (f.level !== "ADMIN" && input.day !== f.today) throw new AppError(403, "NOT_TODAY", "Korábbi napot csak adminisztrátor zárhat le.");
    // a future day closed in advance would lock its aquarists out (review note on #13), admin or not
    if (input.day > f.today) throw new AppError(422, "FUTURE_DAY", "Jövőbeli napot nem lehet lezárni.");
    const res = await tx.journalDay.updateMany({
      where: { id: f.journal.id, state: "OPEN" },
      data: { state: "CLOSED", closeMode: "MANUAL", closedById: actor.id, closedAt: serverNow, closeRanAt: serverNow },
    });
    if (res.count !== 1) throw new AppError(409, "NOT_OPEN", "Ez a nap már le van zárva.");
    await tx.journalReopen.updateMany({ where: { journalDayId: f.journal.id, reclosedAt: null }, data: { reclosedAt: serverNow } });
    await writeAudit(tx, {
      userId: actor.id,
      action: "CLOSE",
      entityType: "JournalDay",
      entityId: f.journal.id,
      changes: { state: { before: "OPEN", after: "CLOSED" }, businessDay: { before: null, after: input.day } },
      requestId: input.requestId,
    });
    return { replayed: false };
  });
}

async function baseUnits() {
  return new Map((await prisma.unit.findMany({ where: { isBase: true } })).map((u) => [u.dimension, u.symbol]));
}

/** The day: items, and the total per base unit in the corner (KIV-02). */
export async function withdrawalDayView(d: string) {
  const wd = await prisma.withdrawalDay.findUnique({ where: { businessDay: dayToDate(d) }, include: { journalDay: true } });
  const at = dayBounds(d).start;
  const items = wd
    ? await prisma.withdrawalItem.findMany({
        where: { withdrawalDayId: wd.id, status: "VALID" },
        include: { quantities: { include: { unit: true } }, feed: { include: { names: true, type: true } } },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const baseOf = await baseUnits();
  const totals: Record<string, number> = {};
  for (const it of items) {
    for (const q of it.quantities) {
      const base = baseOf.get(q.unit.dimension) ?? q.unit.symbol;
      totals[base] = (totals[base] ?? 0) + Number(q.quantity) * Number(q.unit.factorToBase ?? 1);
    }
  }
  return {
    day: d,
    lock: wd?.journalDay.state ?? "OPEN",
    items: items.map((it) => ({
      id: it.id,
      version: it.version,
      useDay: dateToDay(it.useDay),
      type: it.feed.type.name,
      feed: pickValid(it.feed.names, at)?.name ?? it.feed.names.at(-1)?.name ?? "?",
      otherName: it.otherName,
      quantities: it.quantities.map((q) => ({ value: canonicalDecimal(q.quantity), unit: q.unit.symbol })),
      createdById: it.createdById,
    })),
    totals,
  };
}

export type CompareRow = { key: string; feed: string; unit: string; taken: number; given: number; paired: boolean };

/**
 * TAK-06, R-11: taken out (by use day) against given (the feeding items, by feeding day) per feed and
 * base unit for a period. The difference is a report, not an error. An "Egyéb" item has a free name,
 * so it is not paired: it stands as its own row, on the side it came from.
 */
export async function takenVersusGiven(from: string, to: string): Promise<CompareRow[]> {
  if (from > to) throw new AppError(422, "BAD_PERIOD", "Az időszak vége nem lehet a kezdete előtt.");
  const range = { gte: dayToDate(from), lte: dayToDate(to) };
  const end = dayBounds(to).end;
  const [taken, given, baseOf] = await Promise.all([
    prisma.withdrawalItem.findMany({
      where: { status: "VALID", useDay: range },
      include: { quantities: { include: { unit: true } }, feed: { include: { names: true } } },
    }),
    prisma.feedingItem.findMany({
      where: { status: "VALID", feedingDay: { businessDay: range } },
      include: { quantities: { include: { unit: true } }, feed: { include: { names: true } } },
    }),
    baseUnits(),
  ]);
  const rows = new Map<string, CompareRow>();
  const add = (side: "taken" | "given", it: (typeof taken)[number] | (typeof given)[number]) => {
    const name = pickValid(it.feed.names, new Date(end.getTime() - 1))?.name ?? it.feed.names.at(-1)?.name ?? "?";
    for (const q of it.quantities) {
      const unit = baseOf.get(q.unit.dimension) ?? q.unit.symbol;
      const paired = it.otherName === null;
      // an other feed's name without case: "Tintahal" and "tintahal" are one (as the cell index)
      const key = paired ? `${it.feedId}|${unit}` : `${side}|${it.feedId}|${it.otherName!.toLowerCase()}|${unit}`;
      const row = rows.get(key) ?? { key, feed: paired ? name : `${name}: ${it.otherName}`, unit, taken: 0, given: 0, paired };
      row[side] += Number(q.quantity) * Number(q.unit.factorToBase ?? 1);
      rows.set(key, row);
    }
  };
  for (const it of taken) add("taken", it);
  for (const it of given) add("given", it);
  return [...rows.values()].sort((a, b) => Number(b.paired) - Number(a.paired) || a.feed.localeCompare(b.feed, "hu") || a.unit.localeCompare(b.unit));
}
