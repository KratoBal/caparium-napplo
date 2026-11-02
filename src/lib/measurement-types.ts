// Lili 2026-11-02 09:36 and 09:40 UTC (acrobot 39956, 39960; memory 2583): the water measurements on one settings card, as the
// pools, the feeds and the animals: one row each (name, unit, daily or weekly, which tables and which pools there, from when to
// when), and opened, everything that belongs to it. Admin only. Nothing is deleted:
// - a NAME change holds from its day on; the days before keep the old name (parameter_name, as the pool's name);
// - a measurement is CLOSED with its last day ("Meddig"): its columns end there, its values stay;
// - the decimals and the plausible range are the measurement's for all time, as before;
// - a UNIT change is not a change of a field: it closes the measurement on the day before and starts its successor, with the
//   same name, tables, pools and place in the order, the new unit and the references asked again in it. The successor points
//   back (predecessorId) and keeps the built-in behaviour (baseCode: the NO3 and PO4 dilution).
import { z } from "zod";
import { diffFields, writeAudit } from "./audit";
import { prisma } from "./db";
import { canonicalDecimal, compareDecimal } from "./decimal";
import { takesDilution } from "./dilution";
import { AppError } from "./errors";
import { FIRST_NAME_FROM, moduleLevel, pickValid, validAt } from "./master";
import type { Actor } from "./measurements";
import { decimal, freeCode, nameTaken } from "./new-measurement";
import { addDays, businessDayOf, resolveLocalDateTime } from "./time";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A dátum alakja ÉÉÉÉ-HH-NN.");
const requestId = z.string().min(8).max(100);
const decimalText = z.string().trim().max(32).nullable().optional();

async function requireAdmin(actor: Actor) {
  if ((await moduleLevel(prisma, actor.id, actor.role, "SETTINGS")) !== "ADMIN") {
    throw new AppError(403, "ADMIN_ONLY", "A méréseket csak adminisztrátor módosíthatja.");
  }
}

/** A day's start, Europe/Budapest. */
function startOf(d: string): Date {
  const at = resolveLocalDateTime(`${d}T00:00`)?.instant;
  if (!at) throw new AppError(422, "INVALID_DAY", "A dátum érvénytelen.");
  return at;
}

/** The last day a [from, until) period covers. */
const lastDayOf = (until: Date) => businessDayOf(new Date(until.getTime() - 1));

const replayed = async (id: string) => !!(await prisma.auditEntry.findFirst({ where: { requestId: id } }));

// ---------------------------------------------------------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------------------------------------------------------

export type MeasurementTypeView = Awaited<ReturnType<typeof listMeasurementTypes>>[number];

export async function listMeasurementTypes(now = new Date()) {
  const params = await prisma.parameter.findMany({
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    include: {
      unit: true,
      names: true,
      zimsNames: true,
      zimsUnitNames: true,
      referenceRanges: { where: validAt(now) },
      conversions: { where: validAt(now), orderBy: { validFrom: "desc" }, take: 1 },
      groups: {
        orderBy: { validFrom: "asc" },
        include: { group: { include: { memberships: { where: validAt(now), orderBy: { sortOrder: "asc" }, include: { pool: { include: { names: true } } } } } } },
      },
    },
  });
  const pools = await prisma.pool.findMany({ include: { names: true } });
  const poolName = new Map(pools.map((p) => [p.id, pickValid(p.names, now)?.displayName ?? p.code]));
  const nameOf = (p: (typeof params)[number]) => pickValid(p.names, now)?.displayName ?? p.names.at(-1)?.displayName ?? p.code;
  const successorOf = new Map(params.filter((p) => p.predecessorId).map((p) => [p.predecessorId!, p.id]));
  return params.map((p) => {
    const open = p.groups.filter((g) => g.validTo === null || g.validTo > now);
    // the pools it is measured in today: its open columns' chosen pools, or every member of the table
    const measuredIn = new Map<string, string>();
    for (const g of open) {
      for (const m of g.group.memberships) {
        if (g.poolIds.length === 0 || g.poolIds.includes(m.poolId)) measuredIn.set(m.poolId, poolName.get(m.poolId) ?? "?");
      }
    }
    const common = p.referenceRanges.find((r) => r.poolId === null);
    const range = (r: { min: unknown; max: unknown } | undefined) =>
      r ? { min: r.min === null ? null : canonicalDecimal(String(r.min)), max: r.max === null ? null : canonicalDecimal(String(r.max)) } : null;
    const conversion = p.conversions[0];
    const froms = p.groups.map((g) => g.validFrom.getTime());
    const closed = p.groups.length > 0 && p.groups.every((g) => g.validTo !== null);
    return {
      id: p.id,
      code: p.code,
      name: nameOf(p),
      unit: { id: p.unit.id, symbol: p.unit.symbol },
      decimals: p.decimals,
      plausibleMin: p.plausibleMin === null ? null : canonicalDecimal(p.plausibleMin.toString()),
      plausibleMax: p.plausibleMax === null ? null : canonicalDecimal(p.plausibleMax.toString()),
      frequencies: [...new Set(p.groups.map((g) => g.group.frequency))],
      tables: p.groups.map((g) => ({
        id: g.id,
        groupName: g.group.name,
        frequency: g.group.frequency,
        pools: g.poolIds.length === 0 ? null : g.poolIds.map((id) => poolName.get(id) ?? "?"),
        from: businessDayOf(g.validFrom),
        to: g.validTo ? lastDayOf(g.validTo) : null,
      })),
      from: froms.length ? businessDayOf(new Date(Math.min(...froms))) : null,
      to: closed ? lastDayOf(new Date(Math.max(...p.groups.map((g) => g.validTo!.getTime())))) : null,
      inForce: open.length > 0,
      predecessorId: p.predecessorId,
      successorId: successorOf.get(p.id) ?? null,
      zimsName: pickValid(p.zimsNames, now)?.zimsName ?? p.zimsNames.at(-1)?.zimsName ?? null,
      zimsUnit: pickValid(p.zimsUnitNames.filter((z) => z.unitId === p.unitId), now)?.zimsUnit ?? null,
      common: range(common),
      pools: [...measuredIn.entries()].map(([poolId, name]) => {
        const own = p.referenceRanges.find((r) => r.poolId === poolId);
        return { poolId, name, own: !!own, range: range(own ?? common) };
      }),
      conversion: conversion ? { label: conversion.label, factor: canonicalDecimal(conversion.factor.toString()), decimals: conversion.decimals, from: businessDayOf(conversion.validFrom) } : null,
      dilution: takesDilution(p.baseCode ?? p.code),
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// A name from a day on
// ---------------------------------------------------------------------------------------------------------------------------

export const renameSchema = z.object({ requestId, parameterId: z.uuid(), name: z.string().trim().min(2, "A név legalább 2 karakter legyen.").max(40), from: day });

export async function renameMeasurementType(actor: Actor, raw: z.input<typeof renameSchema>, now = new Date()) {
  const input = renameSchema.parse(raw);
  await requireAdmin(actor);
  if (await replayed(input.requestId)) return { replayed: true };
  const at = startOf(input.from);
  return prisma.$transaction(async (tx) => {
    const current = await tx.parameterName.findFirst({ where: { parameterId: input.parameterId, validTo: null } });
    if (!current) throw new AppError(404, "NOT_FOUND", "A mérés nem található.");
    if (current.displayName === input.name) throw new AppError(422, "NO_CHANGE", "Nincs változás.");
    if (at <= current.validFrom) throw new AppError(422, "TOO_EARLY", `A mostani név ${businessDayOf(current.validFrom)} óta érvényes; az új név ennél későbbi naptól indulhat.`);
    if (await nameTaken(tx, input.name, now, input.parameterId)) throw new AppError(409, "NAME_TAKEN", "Ilyen nevű mérés már van.");
    await tx.parameterName.update({ where: { id: current.id }, data: { validTo: at } });
    await tx.parameterName.create({ data: { parameterId: input.parameterId, displayName: input.name, validFrom: at } });
    await writeAudit(tx, {
      userId: actor.id,
      action: "MASTER_CHANGE",
      entityType: "Parameter",
      entityId: input.parameterId,
      changes: { ...diffFields({ name: current.displayName }, { name: input.name }), from: { before: null, after: input.from } },
      requestId: input.requestId,
    });
    return { replayed: false };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// Closed with its last day
// ---------------------------------------------------------------------------------------------------------------------------

export const closeSchema = z.object({ requestId, parameterId: z.uuid(), to: day });

/** The columns of a measurement still open at `until` end there; refused while a value stands on a later day. */
async function closeColumns(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], parameterId: string, until: Date) {
  const cols = await tx.groupParameter.findMany({ where: { parameterId, OR: [{ validTo: null }, { validTo: { gt: until } }] } });
  if (cols.length === 0) throw new AppError(409, "ALREADY_CLOSED", "A mérés ezen a napon már le van zárva.");
  if (cols.some((c) => c.validFrom >= until)) throw new AppError(422, "BEFORE_START", "A lezárás napja a mérés egyik táblájának kezdete előtt van.");
  const later = await tx.measurement.count({ where: { parameterId, status: "VALID", measuredAt: { gte: until } } });
  if (later > 0) throw new AppError(409, "VALUES_AFTER", `${later} érvényes mérés áll a megadott nap után; a lezárás azokat elrejtené a táblákból.`);
  for (const c of cols) await tx.groupParameter.update({ where: { id: c.id }, data: { validTo: until } });
  return cols;
}

export async function closeMeasurementType(actor: Actor, raw: z.input<typeof closeSchema>) {
  const input = closeSchema.parse(raw);
  await requireAdmin(actor);
  if (await replayed(input.requestId)) return { replayed: true };
  const until = startOf(addDays(input.to, 1));
  return prisma.$transaction(async (tx) => {
    // the parameter row locked: a unit change of the same measurement at the same time waits
    await tx.$queryRaw`SELECT id FROM "parameter" WHERE id = ${input.parameterId}::uuid FOR UPDATE`;
    if (!(await tx.parameter.findUnique({ where: { id: input.parameterId } }))) throw new AppError(404, "NOT_FOUND", "A mérés nem található.");
    const cols = await closeColumns(tx, input.parameterId, until);
    await writeAudit(tx, {
      userId: actor.id,
      action: "MASTER_CHANGE",
      entityType: "Parameter",
      entityId: input.parameterId,
      changes: { closed: { before: null, after: { lastDay: input.to, columns: cols.length } } },
      requestId: input.requestId,
    });
    return { replayed: false, columns: cols.length };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// The decimals and the plausible range: for all time, as before
// ---------------------------------------------------------------------------------------------------------------------------

export const limitsSchema = z.object({ requestId, parameterId: z.uuid(), decimals: z.number().int().min(0).max(4), plausibleMin: decimalText, plausibleMax: decimalText });

function plausible(minRaw: string | null | undefined, maxRaw: string | null | undefined) {
  const min = decimal(minRaw, "A hihető tartomány alja");
  const max = decimal(maxRaw, "A hihető tartomány teteje");
  if (min !== null && max !== null && compareDecimal(min, max) > 0) throw new AppError(422, "BAD_RANGE", "A hihető tartomány alja nagyobb a tetejénél.");
  return { min, max };
}

export async function setMeasurementLimits(actor: Actor, raw: z.input<typeof limitsSchema>) {
  const input = limitsSchema.parse(raw);
  await requireAdmin(actor);
  if (await replayed(input.requestId)) return { replayed: true };
  const range = plausible(input.plausibleMin, input.plausibleMax);
  return prisma.$transaction(async (tx) => {
    const p = await tx.parameter.findUnique({ where: { id: input.parameterId } });
    if (!p) throw new AppError(404, "NOT_FOUND", "A mérés nem található.");
    const before = { decimals: p.decimals, plausibleMin: p.plausibleMin?.toString() ?? null, plausibleMax: p.plausibleMax?.toString() ?? null };
    const after = { decimals: input.decimals, plausibleMin: range.min, plausibleMax: range.max };
    if (before.decimals === after.decimals && (before.plausibleMin === null ? null : canonicalDecimal(before.plausibleMin)) === after.plausibleMin && (before.plausibleMax === null ? null : canonicalDecimal(before.plausibleMax)) === after.plausibleMax) {
      throw new AppError(422, "NO_CHANGE", "Nincs változás.");
    }
    await tx.parameter.update({ where: { id: p.id }, data: after });
    await writeAudit(tx, { userId: actor.id, action: "MASTER_CHANGE", entityType: "Parameter", entityId: p.id, changes: diffFields(before, after), requestId: input.requestId });
    return { replayed: false };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// A unit change: the measurement closed, its successor started
// ---------------------------------------------------------------------------------------------------------------------------

export const unitChangeSchema = z.object({
  requestId,
  parameterId: z.uuid(),
  /** the successor's first day; the measurement's last day is the day before */
  from: day,
  unitId: z.uuid({ error: "Válassz mértékegységet." }),
  zimsUnit: z.string().trim().min(1, "Add meg a ZIMS-mértékegységet.").max(40),
  decimals: z.number().int().min(0).max(4),
  plausibleMin: decimalText,
  plausibleMax: decimalText,
  /** the references asked again in the new unit: the common one, and each pool's own */
  referenceMin: decimalText,
  referenceMax: decimalText,
  poolReferences: z.array(z.object({ poolId: z.uuid(), min: decimalText, max: decimalText })).max(50).default([]),
});

function reference(minRaw: string | null | undefined, maxRaw: string | null | undefined, what: string) {
  const min = decimal(minRaw, `${what} alja`);
  const max = decimal(maxRaw, `${what} teteje`);
  if (min !== null && max !== null && compareDecimal(min, max) > 0) throw new AppError(422, "BAD_RANGE", `${what} alja nagyobb a tetejénél.`);
  return { min, max };
}

export async function changeMeasurementUnit(actor: Actor, raw: z.input<typeof unitChangeSchema>, now = new Date()) {
  const input = unitChangeSchema.parse(raw);
  await requireAdmin(actor);
  if (await replayed(input.requestId)) return { replayed: true };
  const at = startOf(input.from);
  const range = plausible(input.plausibleMin, input.plausibleMax);
  const common = reference(input.referenceMin, input.referenceMax, "A közös referencia");
  const own = input.poolReferences.map((r) => ({ poolId: r.poolId, ...reference(r.min, r.max, "A medence referenciája") })).filter((r) => r.min !== null || r.max !== null);
  return prisma.$transaction(async (tx) => {
    // the order first (it shifts it), then the row, in the order an order save takes them too: no deadlock (parameter-order.ts)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('parameter-order'))`;
    await tx.$queryRaw`SELECT id FROM "parameter" WHERE id = ${input.parameterId}::uuid FOR UPDATE`;
    const old = await tx.parameter.findUnique({ where: { id: input.parameterId }, include: { names: true, zimsNames: true } });
    if (!old) throw new AppError(404, "NOT_FOUND", "A mérés nem található.");
    if (old.unitId === input.unitId) throw new AppError(422, "SAME_UNIT", "Ez a mostani mértékegysége.");
    const unit = await tx.unit.findUnique({ where: { id: input.unitId } });
    if (!unit || !unit.active) throw new AppError(422, "UNIT_NOT_FOUND", "A mértékegység nem található.");
    if (await tx.parameter.findUnique({ where: { predecessorId: old.id } })) throw new AppError(409, "HAS_SUCCESSOR", "Ennek a mérésnek már van utódja.");
    const name = pickValid(old.names, now)?.displayName ?? old.names.at(-1)?.displayName ?? old.code;
    if (await nameTaken(tx, name, now, old.id)) throw new AppError(409, "NAME_TAKEN", "Ilyen nevű mérés már van.");
    // the columns end the day before, and each starts again with the successor, with its pools and its own end if it had one
    const ends = new Map((await tx.groupParameter.findMany({ where: { parameterId: old.id, OR: [{ validTo: null }, { validTo: { gt: at } }] } })).map((c) => [c.id, c.validTo]));
    const cols = await closeColumns(tx, old.id, at);
    // its place in the order: right after the measurement it follows
    await tx.parameter.updateMany({ where: { sortOrder: { gt: old.sortOrder } }, data: { sortOrder: { increment: 1 } } });
    const code = await freeCode(tx, name);
    const next = await tx.parameter.create({
      data: {
        code,
        unitId: unit.id,
        decimals: input.decimals,
        plausibleMin: range.min,
        plausibleMax: range.max,
        sortOrder: old.sortOrder + 1,
        predecessorId: old.id,
        baseCode: old.baseCode ?? old.code,
        names: { create: { displayName: name, validFrom: FIRST_NAME_FROM } },
        zimsNames: { create: { zimsName: pickValid(old.zimsNames, now)?.zimsName ?? old.zimsNames.at(-1)?.zimsName ?? name, validFrom: FIRST_NAME_FROM } },
        zimsUnitNames: { create: { unitId: unit.id, zimsUnit: input.zimsUnit, validFrom: FIRST_NAME_FROM } },
      },
    });
    for (const c of cols) {
      const end = ends.get(c.id) ?? null;
      await tx.groupParameter.create({ data: { groupId: c.groupId, parameterId: next.id, sortOrder: c.sortOrder, validFrom: at, validTo: end, poolIds: c.poolIds } });
    }
    if (common.min !== null || common.max !== null) {
      await tx.referenceRange.create({ data: { parameterId: next.id, poolId: null, min: common.min, max: common.max, unitId: unit.id, validFrom: at, createdById: actor.id } });
    }
    for (const r of own) {
      await tx.referenceRange.create({ data: { parameterId: next.id, poolId: r.poolId, min: r.min, max: r.max, unitId: unit.id, validFrom: at, createdById: actor.id } });
    }
    await writeAudit(tx, {
      userId: actor.id,
      action: "MASTER_CHANGE",
      entityType: "Parameter",
      entityId: old.id,
      changes: { unitChange: { before: { parameter: old.code }, after: { parameter: code, unit: unit.symbol, from: input.from, columns: cols.length, ownReferences: own.length } } },
      requestId: input.requestId,
    });
    return { replayed: false, id: next.id, code };
  });
}
