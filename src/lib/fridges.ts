// The fridges' and freezers' daily temperature book (Lili 2026-11-02 12:34 and 13:21 UTC, Caparium thread msg 1566792513673764997
// and 1566804526357413899; Bálint's idea; task caparium-hutok). It replaces the paper book kept beside the fridges.
//
// Its own tables (fridge, fridge_reading), nothing shared with the water measurements: Lili's worry was that the fridges would
// end up in the water report, the weekly table, the ZIMS or the measurement order, and none of those reads these tables.
//
// Who: a reading is recorded by whoever records the daily water measurement (WATER module RECORD or ADMIN); an aquarist on
// today only, an admin on an earlier day too. The fridges themselves are settings (SETTINGS admin). No delete anywhere: a
// fridge is closed (and may be opened again), a reading is invalidated; a correction invalidates the old reading and records
// the new one in the same transaction. Every write is audited with it.

import { z } from "zod";
import { diffFields, writeAudit } from "./audit";
import { prisma, type Tx } from "./db";
import { canonicalDecimal, compareDecimal, parseDecimalInput } from "./decimal";
import { AppError, isUniqueViolation } from "./errors";
import { moduleLevel } from "./master";
import type { Actor } from "./measurements";
import { canCreate, canModify, effectiveNow } from "./permissions";
import { requireReason } from "./reasons";
import { businessDayOf, dateToDay, dayToDate, resolveLocalDateTime } from "./time";

export type FridgeKindKey = "FRIDGE" | "FREEZER";
export const FRIDGE_KIND_LABEL: Record<FridgeKindKey, string> = { FRIDGE: "hűtő", FREEZER: "fagyasztó" };

const requestId = z.string().min(8).max(100);
const reason = z.string().trim().min(3, "Az indoklás legalább 3 karakter legyen.").max(500);
// the name goes into the Excel: no leading character a spreadsheet reads as a formula (as the other names, src/lib/admin.ts)
const fridgeName = z
  .string()
  .trim()
  .min(1, "A név nem lehet üres.")
  .max(60)
  .refine((v) => !/^[=+\-@\t\r]/.test(v), "A név nem kezdődhet =, +, -, @ jellel (táblázatkezelőben képletként futna).");
const temperatureText = z.string().trim().min(1, "Adj meg hőmérsékletet.").max(16);

/** The widest a thermometer of a fridge or a freezer may say: beyond it the number is a typo, not a reading. */
const PLAUSIBLE = { min: "-60", max: "40" };

/** "4,5" or "-18" -> "4.5" / "-18"; one decimal at most, within the plausible span. */
export function parseTemperature(raw: string, what = "A hőmérséklet"): string {
  const v = parseDecimalInput(raw, 1);
  if (v === null) throw new AppError(422, "INVALID_TEMPERATURE", `${what} szám legyen, legfeljebb egy tizedesjeggyel (például 4,5 vagy -18).`);
  if (compareDecimal(v, PLAUSIBLE.min) < 0 || compareDecimal(v, PLAUSIBLE.max) > 0) {
    throw new AppError(422, "IMPLAUSIBLE_TEMPERATURE", `${what} -60 és 40 °C között lehet.`);
  }
  return v;
}

/** Outside the fridge's range (the limits themselves are inside). */
export function outOfRange(temperature: string, min: string, max: string): boolean {
  return compareDecimal(temperature, min) < 0 || compareDecimal(temperature, max) > 0;
}

/** "4.5" -> "4,5" for people. */
export const huTemp = (v: string) => v.replace(".", ",");

// ---------------------------------------------------------------------------
// Settings: the fridges (SETTINGS admin)
// ---------------------------------------------------------------------------

async function requireSettingsAdmin(actor: Actor) {
  if ((await moduleLevel(prisma, actor.id, actor.role, "SETTINGS")) !== "ADMIN") {
    throw new AppError(403, "ADMIN_ONLY", "A beállításokat csak adminisztrátor módosíthatja.");
  }
}

function checkRange(min: string, max: string) {
  if (compareDecimal(min, max) >= 0) throw new AppError(422, "RANGE_ORDER", "A minimum legyen kisebb a maximumnál.");
}

export const fridgeSchema = z.object({
  requestId,
  name: fridgeName,
  kind: z.enum(["FRIDGE", "FREEZER"]),
  min: temperatureText,
  max: temperatureText,
});

export async function createFridge(actor: Actor, raw: z.input<typeof fridgeSchema>, serverNow = new Date()) {
  const input = fridgeSchema.parse(raw);
  await requireSettingsAdmin(actor);
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId, entityType: "Fridge" } })) return { replayed: true };
  const min = parseTemperature(input.min, "A minimum");
  const max = parseTemperature(input.max, "A maximum");
  checkRange(min, max);
  try {
    return await prisma.$transaction(async (tx) => {
      const last = await tx.fridge.aggregate({ _max: { sortOrder: true } });
      const row = await tx.fridge.create({
        data: { name: input.name, kind: input.kind, minC: min, maxC: max, sortOrder: (last._max.sortOrder ?? 0) + 1, createdById: actor.id, updatedById: actor.id, createdAt: serverNow, updatedAt: serverNow },
      });
      await writeAudit(tx, {
        userId: actor.id,
        action: "CREATE",
        entityType: "Fridge",
        entityId: row.id,
        changes: diffFields(null, { name: input.name, kind: input.kind, minC: min, maxC: max }),
        requestId: input.requestId,
      });
      return { replayed: false, fridgeId: row.id };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError(409, "NAME_TAKEN", "Ilyen nevű hűtő már van.");
    throw e;
  }
}

export const updateFridgeSchema = z.object({
  requestId,
  name: fridgeName.optional(),
  kind: z.enum(["FRIDGE", "FREEZER"]).optional(),
  min: temperatureText.optional(),
  max: temperatureText.optional(),
  /** false closes the fridge (no new reading; its readings stay), true opens it again */
  active: z.boolean().optional(),
});

/**
 * Changes a fridge. A new range acts from now on: the readings already taken keep the range they were taken with
 * (fridge_reading.minC/maxC), so an old reading does not turn red, or back, because the limits moved.
 */
export async function updateFridge(actor: Actor, id: string, raw: z.input<typeof updateFridgeSchema>, serverNow = new Date()) {
  const input = updateFridgeSchema.parse(raw);
  await requireSettingsAdmin(actor);
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId, entityType: "Fridge" } })) return { replayed: true };
  try {
    return await prisma.$transaction(async (tx) => {
      const cur = await tx.fridge.findUnique({ where: { id } });
      if (!cur) throw new AppError(404, "NOT_FOUND", "A hűtő nem található.");
      const before = { name: cur.name, kind: cur.kind, minC: canonicalDecimal(cur.minC), maxC: canonicalDecimal(cur.maxC), active: cur.active };
      const after = {
        name: input.name ?? before.name,
        kind: input.kind ?? before.kind,
        minC: input.min !== undefined ? parseTemperature(input.min, "A minimum") : before.minC,
        maxC: input.max !== undefined ? parseTemperature(input.max, "A maximum") : before.maxC,
        active: input.active ?? before.active,
      };
      checkRange(after.minC, after.maxC);
      const changes = diffFields(before, after);
      if (Object.keys(changes).length === 0) return { replayed: false, changed: false };
      await tx.fridge.update({ where: { id }, data: { ...after, updatedById: actor.id, updatedAt: serverNow } });
      await writeAudit(tx, { userId: actor.id, action: "UPDATE", entityType: "Fridge", entityId: id, changes, requestId: input.requestId });
      return { replayed: false, changed: true };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError(409, "NAME_TAKEN", "Ilyen nevű hűtő már van.");
    throw e;
  }
}

export type FridgeView = { id: string; name: string; kind: FridgeKindKey; min: string; max: string; active: boolean };

const view = (f: { id: string; name: string; kind: FridgeKindKey; minC: { toString(): string }; maxC: { toString(): string }; active: boolean }): FridgeView => ({
  id: f.id,
  name: f.name,
  kind: f.kind,
  min: canonicalDecimal(f.minC),
  max: canonicalDecimal(f.maxC),
  active: f.active,
});

/** The fridges in their order; the closed ones only when asked (the settings list them, to open one again). */
export async function listFridges(opts: { closedToo: boolean }): Promise<FridgeView[]> {
  const rows = await prisma.fridge.findMany({ where: opts.closedToo ? {} : { active: true }, orderBy: [{ active: "desc" }, { sortOrder: "asc" }] });
  return rows.map(view);
}

// ---------------------------------------------------------------------------
// Readings (WATER RECORD or ADMIN)
// ---------------------------------------------------------------------------

export const fridgeReadingSchema = z.object({
  requestId,
  clientTimestamp: z.iso.datetime({ offset: true }).optional(),
  fridgeId: z.uuid(),
  /** the date and time of the reading, local; empty = now */
  measuredAtLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
  temperature: temperatureText,
  defrost: z.boolean().default(false),
  note: z.string().trim().max(200, "A megjegyzés legfeljebb 200 karakter.").optional(),
  /** a correction: the reading this one replaces, invalidated in the same transaction */
  replacesId: z.uuid().optional(),
  expectedVersion: z.number().int().min(1).optional(),
  reason: reason.optional(),
});

async function writeAllowed(tx: Tx, actor: Actor) {
  return moduleLevel(tx, actor.id, actor.role, "WATER");
}

/**
 * Records one reading, or a correction of one (`replacesId`): the old reading is invalidated and the new one recorded
 * together, so the book never shows both or neither. An aquarist records on today only; an admin on an earlier day too
 * (with a reason when the reason switch is on). A fridge that is closed takes no new reading.
 */
export async function saveFridgeReading(actor: Actor, raw: z.input<typeof fridgeReadingSchema>, serverNow = new Date()) {
  const input = fridgeReadingSchema.parse(raw);
  const replay = await prisma.fridgeReading.findUnique({ where: { requestId: input.requestId } });
  if (replay) return { replayed: true, readingId: replay.id };
  const clientTs = input.clientTimestamp ? new Date(input.clientTimestamp) : null;
  const eff = effectiveNow(serverNow, clientTs, 30, 48);
  const measuredAt = input.measuredAtLocal ? resolveLocalDateTime(input.measuredAtLocal)?.instant : eff.now;
  if (!measuredAt) throw new AppError(422, "INVALID_TIME", "Az időpont érvénytelen.");
  if (measuredAt.getTime() > serverNow.getTime() + 5 * 60_000) throw new AppError(422, "FUTURE_TIME", "Jövőbeli leolvasást nem lehet rögzíteni.");
  const temperature = parseTemperature(input.temperature);
  const day = businessDayOf(measuredAt);
  const today = businessDayOf(eff.now);
  const note = input.note ? input.note : null;
  try {
    return await prisma.$transaction(async (tx) => {
      const level = await writeAllowed(tx, actor);
      // the book has no day lock of its own: a fridge reading is not part of the water sheet, so the water day's close
      // does not bind it; the day rule is the measurement's (an aquarist today, an admin an earlier day too)
      let prior: Awaited<ReturnType<typeof tx.fridgeReading.findUnique>> = null;
      if (input.replacesId) {
        prior = await tx.fridgeReading.findUnique({ where: { id: input.replacesId } });
        if (!prior) throw new AppError(404, "NOT_FOUND", "A leolvasás nem található.");
        if (prior.status !== "VALID") throw new AppError(409, "NOT_EDITABLE", "Ez a leolvasás már nem érvényes.");
        if (prior.version !== input.expectedVersion) throw new AppError(409, "VERSION_CONFLICT", "A leolvasás időközben megváltozott.");
        const d = canModify(level, { day: dateToDay(prior.businessDay), today, closed: false, isOwn: prior.createdById === actor.id, othersToo: true, targetDay: day });
        if (d.kind === "DENY") throw new AppError(403, d.code, d.message);
        await requireReason(tx, d.reasonRequired, input.reason, "Korábbi nap leolvasásának javításához indoklás kell.");
      } else {
        const d = canCreate(level, { day, today, closed: false });
        if (d.kind === "DENY") throw new AppError(403, d.code, d.message);
        await requireReason(tx, d.reasonRequired, input.reason, "Korábbi napra rögzítéshez indoklás kell.");
      }
      const fridge = await tx.fridge.findUnique({ where: { id: input.fridgeId } });
      if (!fridge) throw new AppError(404, "FRIDGE_NOT_FOUND", "A hűtő nem található.");
      // a correction of a reading taken before the fridge was closed is still a correction of the book; a new reading is not
      if (!fridge.active && !prior) throw new AppError(422, "FRIDGE_CLOSED", "Ez a hűtő le van zárva, új leolvasás nem rögzíthető rá.");
      if (prior && prior.fridgeId !== fridge.id) throw new AppError(422, "OTHER_FRIDGE", "A javítás csak ugyanannak a hűtőnek a leolvasása lehet.");
      if (prior) {
        const res = await tx.fridgeReading.updateMany({
          where: { id: prior.id, version: prior.version, status: "VALID" },
          data: { status: "INVALIDATED", invalidationReason: input.reason ?? null, version: { increment: 1 }, updatedById: actor.id, updatedAt: serverNow },
        });
        if (res.count !== 1) throw new AppError(409, "VERSION_CONFLICT", "A leolvasás időközben megváltozott.");
      }
      // the range of the moment: a correction keeps the range the replaced reading was taken with
      const minC = prior ? canonicalDecimal(prior.minC) : canonicalDecimal(fridge.minC);
      const maxC = prior ? canonicalDecimal(prior.maxC) : canonicalDecimal(fridge.maxC);
      const row = await tx.fridgeReading.create({
        data: {
          fridgeId: fridge.id,
          measuredAt,
          businessDay: dayToDate(day),
          temperatureC: temperature,
          minC,
          maxC,
          defrost: input.defrost,
          note,
          requestId: input.requestId,
          createdById: actor.id,
          updatedById: actor.id,
          createdAt: serverNow,
          updatedAt: serverNow,
        },
      });
      if (prior) {
        await writeAudit(tx, {
          userId: actor.id,
          action: "INVALIDATE",
          entityType: "FridgeReading",
          entityId: prior.id,
          changes: { status: { before: "VALID", after: "INVALIDATED" }, replacedBy: { before: null, after: row.id } },
          reason: input.reason ?? null,
          requestId: `${input.requestId}:javitas`,
        });
      }
      await writeAudit(tx, {
        userId: actor.id,
        action: "CREATE",
        entityType: "FridgeReading",
        entityId: row.id,
        changes: {
          fridge: { before: prior?.fridgeId ?? null, after: fridge.id },
          temperature: { before: prior ? canonicalDecimal(prior.temperatureC) : null, after: temperature },
          measuredAt: { before: prior?.measuredAt.toISOString() ?? null, after: measuredAt.toISOString() },
          defrost: { before: prior?.defrost ?? null, after: input.defrost },
          note: { before: prior?.note ?? null, after: note },
        },
        reason: input.reason ?? null,
        requestId: input.requestId,
        clientTimestamp: clientTs,
      });
      return { replayed: false, readingId: row.id, outOfRange: outOfRange(temperature, minC, maxC) };
    });
  } catch (e) {
    // the same request twice at once: the second finds the first's row
    if (isUniqueViolation(e)) {
      const won = await prisma.fridgeReading.findUnique({ where: { requestId: input.requestId } });
      if (won) return { replayed: true, readingId: won.id };
    }
    throw e;
  }
}

export const fridgeInvalidateSchema = z.object({ requestId, expectedVersion: z.number().int().min(1), reason: reason.optional() });

/** Invalidates a reading recorded by mistake (a wrong fridge, a double save). The row stays, marked. */
export async function invalidateFridgeReading(actor: Actor, id: string, raw: z.input<typeof fridgeInvalidateSchema>, serverNow = new Date()) {
  const input = fridgeInvalidateSchema.parse(raw);
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId, entityType: "FridgeReading" } })) return { replayed: true };
  return prisma.$transaction(async (tx) => {
    const level = await writeAllowed(tx, actor);
    const cur = await tx.fridgeReading.findUnique({ where: { id } });
    if (!cur) throw new AppError(404, "NOT_FOUND", "A leolvasás nem található.");
    const d = canModify(level, { day: dateToDay(cur.businessDay), today: businessDayOf(serverNow), closed: false, isOwn: cur.createdById === actor.id, othersToo: true });
    if (d.kind === "DENY") throw new AppError(403, d.code, d.message);
    await requireReason(tx, true, input.reason, "Az érvénytelenítéshez indoklás kell.");
    const res = await tx.fridgeReading.updateMany({
      where: { id, version: input.expectedVersion, status: "VALID" },
      data: { status: "INVALIDATED", invalidationReason: input.reason ?? null, version: { increment: 1 }, updatedById: actor.id, updatedAt: serverNow },
    });
    if (res.count !== 1) throw new AppError(409, "VERSION_CONFLICT", "A leolvasás időközben megváltozott.");
    await writeAudit(tx, { userId: actor.id, action: "INVALIDATE", entityType: "FridgeReading", entityId: id, changes: { status: { before: "VALID", after: "INVALIDATED" } }, reason: input.reason ?? null, requestId: input.requestId });
    return { replayed: false };
  });
}

export type ReadingView = {
  id: string;
  fridgeId: string;
  fridge: string;
  kind: FridgeKindKey;
  measuredAt: string;
  day: string;
  temperature: string;
  min: string;
  max: string;
  outOfRange: boolean;
  defrost: boolean;
  note: string | null;
  version: number;
  createdById: string;
};

type ReadingRow = {
  id: string;
  fridgeId: string;
  measuredAt: Date;
  businessDay: Date;
  temperatureC: { toString(): string };
  minC: { toString(): string };
  maxC: { toString(): string };
  defrost: boolean;
  note: string | null;
  version: number;
  createdById: string;
  fridge: { name: string; kind: FridgeKindKey; sortOrder: number };
};

function readingView(r: ReadingRow): ReadingView {
  const temperature = canonicalDecimal(r.temperatureC);
  const min = canonicalDecimal(r.minC);
  const max = canonicalDecimal(r.maxC);
  return {
    id: r.id,
    fridgeId: r.fridgeId,
    fridge: r.fridge.name,
    kind: r.fridge.kind,
    measuredAt: r.measuredAt.toISOString(),
    day: dateToDay(r.businessDay),
    temperature,
    min,
    max,
    outOfRange: outOfRange(temperature, min, max),
    defrost: r.defrost,
    note: r.note,
    version: r.version,
    createdById: r.createdById,
  };
}

/** The valid readings of a period, in time order (the fridge's order within one instant). */
export async function fridgeReadings(from: string, to: string): Promise<ReadingView[]> {
  const rows = await prisma.fridgeReading.findMany({
    where: { status: "VALID", businessDay: { gte: dayToDate(from), lte: dayToDate(to) } },
    include: { fridge: { select: { name: true, kind: true, sortOrder: true } } },
    orderBy: [{ measuredAt: "asc" }, { fridge: { sortOrder: "asc" } }, { createdAt: "asc" }],
  });
  return rows.map(readingView);
}

/**
 * The daily card: the open fridges, and a closed one too when it has a reading that day (its row must not vanish from
 * an old day), each with the day's valid readings.
 */
export async function fridgeDay(day: string): Promise<{ fridges: FridgeView[]; readings: ReadingView[] }> {
  const readings = await fridgeReadings(day, day);
  const withReading = new Set(readings.map((r) => r.fridgeId));
  const fridges = (await listFridges({ closedToo: true })).filter((f) => f.active || withReading.has(f.id));
  return { fridges, readings };
}
