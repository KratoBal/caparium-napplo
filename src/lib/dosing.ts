// Chemical dosing and its stock (adatmodell 13.; ADA-01..ADA-06, JAV-09, R-16).
// A dosing (pool, chemical, amount, unit, who) writes its USAGE movement in the same transaction, in the
// chemical's stock unit; its change or invalidation changes the movement the same way, so the log and
// the stock cannot drift apart. The stock level is the sum of the valid movements, never stored; a
// negative level is allowed and flagged (R-16). The day's lock is the DOSING journal day (midnight).
// NY-08 default (temporary, documented): no starting stock; intake is admin work.

import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { writeAudit } from "./audit";
import { prisma, type Tx } from "./db";
import { canonicalDecimal, compareDecimal, parseDecimalInput } from "./decimal";
import { AppError } from "./errors";
import { ensureJournalDay, moduleLevel, monogramResolver, pickValid } from "./master";
import { requireReason } from "./reasons";
import type { Actor } from "./measurements";
import { closedAt } from "./measurements";
import { canCreate, canModify, effectiveNow } from "./permissions";
import { addDays, businessDayOf, dateToDay, dayToDate, resolveLocalDateTime } from "./time";

const requestId = z.string().min(8).max(100);
const reason = z.string().trim().min(3, "Az indoklás legalább 3 karakter legyen.").max(500);
const safeText = (max: number) => z.string().trim().min(1).max(max).refine((v) => !/^[=+\-@\t\r]/.test(v), "A szöveg nem kezdődhet =, +, -, @ jellel.");

/** The amount in the chemical's stock unit (JAV-09): only within one dimension. */
async function toStockUnit(tx: Tx, chemicalId: string, quantity: string, unitId: string) {
  const chem = await tx.chemical.findUnique({ where: { id: chemicalId }, include: { stockUnit: true } });
  if (!chem) throw new AppError(404, "CHEMICAL_NOT_FOUND", "A vegyszer nem található.");
  const unit = await tx.unit.findUnique({ where: { id: unitId } });
  if (!unit) throw new AppError(422, "UNIT_NOT_FOUND", "Ismeretlen mértékegység.");
  if (unit.dimension !== chem.stockUnit.dimension) {
    throw new AppError(422, "UNIT_DIMENSION", `Ez a vegyszer ${chem.stockUnit.symbol} egységben van nyilvántartva; ${unit.symbol} egységben nem adagolható (átváltás nélkül).`);
  }
  const v = parseDecimalInput(quantity);
  if (v === null || compareDecimal(v, "0") <= 0) throw new AppError(422, "INVALID_VALUE", "A mennyiség pozitív szám legyen.");
  const inStock = Math.round(((Number(v) * Number(unit.factorToBase ?? 1)) / Number(chem.stockUnit.factorToBase ?? 1)) * 10000) / 10000;
  // review note on #15: an amount too small for the stock unit would round to 0 and fail the sign check
  // with a 500; fixed digits also keep a tiny or huge number out of the "1e-7" form
  if (inStock === 0) throw new AppError(422, "ZERO_IN_STOCK", `Ez a mennyiség a készlet egységében (${chem.stockUnit.symbol}) nullára kerekedik; adj meg nagyobbat.`);
  return { chem, unit, value: v, inStock: inStock.toFixed(4).replace(/\.?0+$/, "") };
}

export const dosingSchema = z.object({
  requestId,
  clientTimestamp: z.iso.datetime({ offset: true }).optional(),
  dosingId: z.uuid().optional(),
  expectedVersion: z.number().int().min(1).optional(),
  performedAtLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
  poolId: z.uuid(),
  chemicalId: z.uuid(),
  quantity: z.string().min(1).max(32),
  unitId: z.uuid(),
  reason: reason.optional(),
});

/** ADA-01, ADA-02: records or changes one dosing, and its USAGE movement with it. */
export async function saveDosing(actor: Actor, raw: z.input<typeof dosingSchema>, serverNow = new Date()) {
  const input = dosingSchema.parse(raw);
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  const clientTs = input.clientTimestamp ? new Date(input.clientTimestamp) : null;
  const eff = effectiveNow(serverNow, clientTs, 30, 48);
  const performedAt = input.performedAtLocal ? resolveLocalDateTime(input.performedAtLocal)?.instant : eff.now;
  if (!performedAt) throw new AppError(422, "INVALID_TIME", "Az időpont érvénytelen.");
  if (performedAt.getTime() > serverNow.getTime() + 5 * 60_000) throw new AppError(422, "FUTURE_TIME", "Jövőbeli adagolást nem lehet rögzíteni.");
  const day = businessDayOf(performedAt);
  const today = businessDayOf(eff.now);
  const level = await moduleLevel(prisma, actor.id, actor.role, "DOSING");
  return prisma.$transaction(async (tx) => {
    const journal = await ensureJournalDay(tx, "DOSING", null, day);
    const closed = closedAt(journal, eff.now);
    const prior = input.dosingId ? await tx.dosing.findUnique({ where: { id: input.dosingId }, include: { movement: true } }) : null;
    if (input.dosingId) {
      if (!prior) throw new AppError(404, "NOT_FOUND", "Az adagolás nem található.");
      if (prior.status !== "VALID") throw new AppError(409, "NOT_EDITABLE", "Ez az adagolás már nem érvényes.");
      if (prior.version !== input.expectedVersion) throw new AppError(409, "VERSION_CONFLICT", "Az adagolás időközben megváltozott.");
      const d = canModify(level, { day: dateToDay(prior.businessDay), today, closed, isOwn: prior.createdById === actor.id, targetDay: day });
      if (d.kind === "DENY") throw new AppError(403, d.code, d.message);
      await requireReason(tx, d.reasonRequired, input.reason, "Korábbi vagy lezárt nap módosításához indoklás kell.");
    } else {
      const d = canCreate(level, { day, today, closed });
      if (d.kind === "DENY") throw new AppError(403, d.code, d.message);
      await requireReason(tx, d.reasonRequired, input.reason, "Korábbi vagy lezárt nap módosításához indoklás kell.");
    }
    const pool = await tx.pool.findUnique({ where: { id: input.poolId } });
    if (!pool || !pool.active) throw new AppError(422, "POOL_NOT_FOUND", "A medence nem található.");
    const { chem, unit, value, inStock } = await toStockUnit(tx, input.chemicalId, input.quantity, input.unitId);
    if (!chem.active) throw new AppError(422, "CHEMICAL_INACTIVE", "Ez a vegyszer nem aktív.");
    const data = { performedAt, businessDay: dayToDate(day), poolId: pool.id, chemicalId: chem.id, quantity: value, unitId: unit.id, updatedById: actor.id, updatedAt: serverNow };
    let dosingId: string;
    if (prior) {
      const res = await tx.dosing.updateMany({ where: { id: prior.id, version: prior.version, status: "VALID" }, data: { ...data, version: { increment: 1 } } });
      if (res.count !== 1) throw new AppError(409, "VERSION_CONFLICT", "Az adagolás időközben megváltozott.");
      dosingId = prior.id;
      // the movement follows its source in the same transaction (R-16)
      await tx.stockMovement.update({
        where: { dosingId: prior.id },
        data: { chemicalId: chem.id, quantity: `-${inStock}`, originalQuantity: value, originalUnitId: unit.id, at: performedAt, businessDay: dayToDate(day), version: { increment: 1 } },
      });
    } else {
      const created = await tx.dosing.create({ data: { ...data, performedById: actor.id, requestId: input.requestId, createdById: actor.id } });
      dosingId = created.id;
      await tx.stockMovement.create({
        data: {
          chemicalId: chem.id,
          type: "USAGE",
          quantity: `-${inStock}`,
          originalQuantity: value,
          originalUnitId: unit.id,
          at: performedAt,
          businessDay: dayToDate(day),
          dosingId,
          requestId: `${input.requestId}:mozgas`,
          createdById: actor.id,
        },
      });
    }
    await writeAudit(tx, {
      userId: actor.id,
      action: prior ? "UPDATE" : "CREATE",
      entityType: "Dosing",
      entityId: dosingId,
      changes: {
        pool: { before: prior?.poolId ?? null, after: pool.id },
        chemical: { before: prior?.chemicalId ?? null, after: chem.id },
        quantity: { before: prior ? canonicalDecimal(prior.quantity) : null, after: value },
        unit: { before: prior?.unitId ?? null, after: unit.id },
        stockQuantity: { before: prior?.movement ? canonicalDecimal(prior.movement.quantity) : null, after: `-${inStock}` },
      },
      reason: input.reason ?? null,
      requestId: input.requestId,
      clientTimestamp: clientTs,
    });
    return { replayed: false, dosingId };
  });
}

export const dosingInvalidateSchema = z.object({ requestId, expectedVersion: z.number().int().min(1), reason: reason.optional() });

/** Invalidates a dosing and its movement together (R-16). */
export async function invalidateDosing(actor: Actor, id: string, raw: z.input<typeof dosingInvalidateSchema>, serverNow = new Date()) {
  const input = dosingInvalidateSchema.parse(raw);
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  const level = await moduleLevel(prisma, actor.id, actor.role, "DOSING");
  return prisma.$transaction(async (tx) => {
    const cur = await tx.dosing.findUnique({ where: { id } });
    if (!cur) throw new AppError(404, "NOT_FOUND", "Az adagolás nem található.");
    const journal = await ensureJournalDay(tx, "DOSING", null, dateToDay(cur.businessDay));
    const d = canModify(level, { day: dateToDay(cur.businessDay), today: businessDayOf(serverNow), closed: closedAt(journal, serverNow), isOwn: cur.createdById === actor.id });
    if (d.kind === "DENY") throw new AppError(403, d.code, d.message);
    await requireReason(tx, true, input.reason, "Az érvénytelenítéshez indoklás kell.");
    const res = await tx.dosing.updateMany({
      where: { id, version: input.expectedVersion, status: "VALID" },
      data: { status: "INVALIDATED", invalidationReason: input.reason, version: { increment: 1 }, updatedById: actor.id, updatedAt: serverNow },
    });
    if (res.count !== 1) throw new AppError(409, "VERSION_CONFLICT", "Az adagolás időközben megváltozott.");
    await tx.stockMovement.update({ where: { dosingId: id }, data: { status: "INVALIDATED", invalidationReason: input.reason, version: { increment: 1 } } });
    await writeAudit(tx, { userId: actor.id, action: "INVALIDATE", entityType: "Dosing", entityId: id, changes: { status: { before: "VALID", after: "INVALIDATED" } }, reason: input.reason, requestId: input.requestId });
    return { replayed: false };
  });
}

async function requireDosingAdmin(actor: Actor) {
  if ((await moduleLevel(prisma, actor.id, actor.role, "DOSING")) !== "ADMIN") {
    throw new AppError(403, "ADMIN_ONLY", "Ezt csak adminisztrátor rögzítheti.");
  }
}

export const intakeSchema = z.object({
  requestId,
  chemicalId: z.uuid(),
  quantity: z.string().min(1).max(32),
  unitId: z.uuid(),
  type: z.enum(["INTAKE", "CORRECTION"]).default("INTAKE"),
  /** a correction may go either way */
  negative: z.boolean().default(false),
  note: safeText(200).optional(),
});

/** Intake and stock correction (NY-08 default: admin work, no starting stock). */
export async function recordMovement(actor: Actor, raw: z.input<typeof intakeSchema>, serverNow = new Date()) {
  const input = intakeSchema.parse(raw);
  await requireDosingAdmin(actor);
  const prior = await prisma.stockMovement.findUnique({ where: { requestId: input.requestId } });
  if (prior) return { replayed: true, id: prior.id };
  if (input.type === "INTAKE" && input.negative) throw new AppError(422, "INTAKE_NEGATIVE", "A bevételezés nem lehet negatív; a csökkentés korrekció.");
  return prisma.$transaction(async (tx) => {
    const { chem, unit, value, inStock } = await toStockUnit(tx, input.chemicalId, input.quantity, input.unitId);
    const row = await tx.stockMovement.create({
      data: {
        chemicalId: chem.id,
        type: input.type,
        quantity: input.negative ? `-${inStock}` : inStock,
        originalQuantity: value,
        originalUnitId: unit.id,
        at: serverNow,
        businessDay: dayToDate(businessDayOf(serverNow)),
        note: input.note ?? null,
        requestId: input.requestId,
        createdById: actor.id,
      },
    });
    await writeAudit(tx, {
      userId: actor.id,
      action: "CREATE",
      entityType: "StockMovement",
      entityId: row.id,
      changes: { type: { before: null, after: input.type }, quantity: { before: null, after: row.quantity.toString() } },
      requestId: input.requestId,
    });
    return { replayed: false, id: row.id };
  });
}

export const chemicalSchema = z.object({ requestId, name: safeText(80), stockUnitId: z.uuid() });

/** A new chemical with its stock unit (JAV-09); admin. */
export async function createChemical(actor: Actor, raw: z.input<typeof chemicalSchema>, serverNow = new Date()) {
  const input = chemicalSchema.parse(raw);
  await requireDosingAdmin(actor);
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  return prisma.$transaction(async (tx) => {
    const unit = await tx.unit.findUnique({ where: { id: input.stockUnitId } });
    if (!unit || !["MASS", "VOLUME", "COUNT"].includes(unit.dimension)) throw new AppError(422, "UNIT", "A készlet egysége tömeg, térfogat vagy darab legyen.");
    const names = await tx.chemicalName.findMany({ where: { validTo: null } });
    if (names.some((n) => n.name.toLowerCase() === input.name.toLowerCase())) throw new AppError(409, "NAME_TAKEN", "Ilyen nevű vegyszer már van.");
    const chem = await tx.chemical.create({ data: { stockUnitId: unit.id, names: { create: { name: input.name, validFrom: serverNow } } } });
    await writeAudit(tx, { userId: actor.id, action: "MASTER_CHANGE", entityType: "Chemical", entityId: chem.id, changes: { name: { before: null, after: input.name }, stockUnit: { before: null, after: unit.symbol } }, requestId: input.requestId });
    return { replayed: false, id: chem.id };
  });
}

/** ADA-06: the level of each chemical (the sum of its valid movements) and its usage of the last 7 and 30 days. */
export async function stockLevels(now = new Date()) {
  const today = businessDayOf(now);
  const chems = await prisma.chemical.findMany({ include: { names: true, stockUnit: true } });
  const sums = await prisma.stockMovement.groupBy({ by: ["chemicalId"], where: { status: "VALID" }, _sum: { quantity: true } });
  const usage = async (days: number) =>
    prisma.stockMovement.groupBy({
      by: ["chemicalId"],
      where: { status: "VALID", type: "USAGE", businessDay: { gt: dayToDate(addDays(today, -days)), lte: dayToDate(today) } },
      _sum: { quantity: true },
    });
  const [w, m] = await Promise.all([usage(7), usage(30)]);
  const val = (rows: { chemicalId: string; _sum: { quantity: Prisma.Decimal | null } }[], id: string) => Number(rows.find((r) => r.chemicalId === id)?._sum.quantity ?? 0);
  return chems
    .map((c) => {
      const level = val(sums, c.id);
      return {
        id: c.id,
        name: pickValid(c.names, now)?.name ?? c.names.at(-1)?.name ?? "?",
        unit: c.stockUnit.symbol,
        unitId: c.stockUnitId,
        dimension: c.stockUnit.dimension,
        active: c.active,
        level: Math.round(level * 10000) / 10000,
        negative: level < 0,
        week: Math.round(-val(w, c.id) * 10000) / 10000,
        month: Math.round(-val(m, c.id) * 10000) / 10000,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "hu"));
}

export type DosingFilter = { from: string; to: string; poolId: string | null; chemicalId: string | null };

/** ADA-05: the dosing log of a period, filterable; names and monograms as they were (K3, K4). */
export async function dosingLog(f: DosingFilter) {
  if (f.from > f.to) throw new AppError(422, "BAD_PERIOD", "Az időszak vége nem lehet a kezdete előtt.");
  const rows = await prisma.dosing.findMany({
    where: {
      businessDay: { gte: dayToDate(f.from), lte: dayToDate(f.to) },
      ...(f.poolId ? { poolId: f.poolId } : {}),
      ...(f.chemicalId ? { chemicalId: f.chemicalId } : {}),
    },
    include: { pool: { include: { names: true } }, chemical: { include: { names: true } }, unit: true },
    orderBy: [{ performedAt: "asc" }, { createdAt: "asc" }],
  });
  const mono = await monogramResolver(rows.map((r) => r.performedById));
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    status: r.status,
    invalidationReason: r.invalidationReason,
    day: dateToDay(r.businessDay),
    at: r.performedAt,
    pool: pickValid(r.pool.names, r.performedAt)?.displayName ?? r.pool.code,
    chemical: pickValid(r.chemical.names, r.performedAt)?.name ?? "?",
    quantity: canonicalDecimal(r.quantity),
    unit: r.unit.symbol,
    by: mono.monogram(r.performedById, r.performedAt),
    createdById: r.createdById,
  }));
}
