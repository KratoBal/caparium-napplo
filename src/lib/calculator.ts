// The feed calculator, the feeding reference and the body weight log (adatmodell 9.; KALK-01, KALK-02,
// EGY-08, JAV-06, D-16, D-41).
// KALK-01 (the description's field table, D-41): inputs BW (kg, the last measured weight), FR a week
// (% of BW, 1..8) and N (feedings a week, 1..7); outputs FR a day, F kg and F g per feeding, Fw g a
// week. FR = F × N / (BW/100), so F = FR × BW / 100 / N.
// NY-15 / D-16 defaults (temporary, documented, decided at the joint check V-18): FR in steps of 0.5;
// a day's amount deviates "roughly" from the reference beyond ±20 %.

import { z } from "zod";
import { writeAudit } from "./audit";
import { prisma, type Tx } from "./db";
import { canonicalDecimal, compareDecimal, parseDecimalInput } from "./decimal";
import { AppError } from "./errors";
import { dayBounds } from "./feeding";
import { moduleLevel } from "./master";
import { requireReason } from "./reasons";
import type { Actor } from "./measurements";
import { canCreate, canModify, effectiveNow } from "./permissions";
import { businessDayOf, dateToDay, dayToDate } from "./time";

export { calculate, deviates, DEVIATION, FR_STEP, type CalcResult } from "./calc-math";
import { calculate } from "./calc-math";

const requestId = z.string().min(8).max(100);
const reason = z.string().trim().min(3, "Az indoklás legalább 3 karakter legyen.").max(500);

// ---------------------------------------------------------------------------
// JAV-06: body weight
// ---------------------------------------------------------------------------

export const bodyWeightSchema = z.object({
  requestId,
  clientTimestamp: z.iso.datetime({ offset: true }).optional(),
  animalId: z.uuid(),
  measuredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  weightKg: z.string().min(1).max(32),
  note: z.string().trim().max(200).refine((v) => !/^[=+\-@\t\r]/.test(v), "A megjegyzés nem kezdődhet =, +, -, @ jellel.").optional(),
  reason: reason.optional(),
});

export async function recordBodyWeight(actor: Actor, raw: z.input<typeof bodyWeightSchema>, serverNow = new Date()) {
  const input = bodyWeightSchema.parse(raw);
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  const clientTs = input.clientTimestamp ? new Date(input.clientTimestamp) : null;
  const eff = effectiveNow(serverNow, clientTs, 30, 48);
  const today = businessDayOf(eff.now);
  const day = input.measuredOn ?? today;
  // a weight measured in the future would become the calculator's default (review note on #14)
  if (day > today) throw new AppError(422, "FUTURE_DAY", "Jövőbeli napra nem lehet testtömeget rögzíteni.");
  const level = await moduleLevel(prisma, actor.id, actor.role, "FEEDING");
  const d = canCreate(level, { day, today, closed: false });
  if (d.kind === "DENY") throw new AppError(403, d.code, d.message);
  await requireReason(prisma, d.reasonRequired, input.reason, "Korábbi napra rögzített méréshez indoklás kell.");
  const w = parseDecimalInput(input.weightKg);
  if (w === null || compareDecimal(w, "0") <= 0) throw new AppError(422, "INVALID_VALUE", "A testtömeg pozitív szám legyen (kg).");
  return prisma.$transaction(async (tx) => {
    if (!(await tx.animal.findUnique({ where: { id: input.animalId } }))) throw new AppError(404, "ANIMAL_NOT_FOUND", "Az állat nem található.");
    const row = await tx.bodyWeight.create({
      data: { animalId: input.animalId, measuredOn: dayToDate(day), weightKg: w, note: input.note ?? null, requestId: input.requestId, createdById: actor.id, updatedById: actor.id },
    });
    await writeAudit(tx, {
      userId: actor.id,
      action: "CREATE",
      entityType: "BodyWeight",
      entityId: row.id,
      changes: { animalId: { before: null, after: input.animalId }, measuredOn: { before: null, after: day }, weightKg: { before: null, after: w } },
      reason: input.reason ?? null,
      requestId: input.requestId,
      clientTimestamp: clientTs,
    });
    return { replayed: false, id: row.id };
  });
}

export const bodyWeightInvalidateSchema = z.object({ requestId, expectedVersion: z.number().int().min(1), reason: reason.optional() });

export async function invalidateBodyWeight(actor: Actor, id: string, raw: z.input<typeof bodyWeightInvalidateSchema>, serverNow = new Date()) {
  const input = bodyWeightInvalidateSchema.parse(raw);
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  const level = await moduleLevel(prisma, actor.id, actor.role, "FEEDING");
  return prisma.$transaction(async (tx) => {
    const cur = await tx.bodyWeight.findUnique({ where: { id } });
    if (!cur) throw new AppError(404, "NOT_FOUND", "A mérés nem található.");
    const d = canModify(level, { day: dateToDay(cur.measuredOn), today: businessDayOf(serverNow), closed: false, isOwn: cur.createdById === actor.id });
    if (d.kind === "DENY") throw new AppError(403, d.code, d.message);
    await requireReason(tx, true, input.reason, "Az érvénytelenítéshez indoklás kell.");
    const res = await tx.bodyWeight.updateMany({
      where: { id, version: input.expectedVersion, status: "VALID" },
      data: { status: "INVALIDATED", invalidationReason: input.reason, version: { increment: 1 }, updatedById: actor.id, updatedAt: serverNow },
    });
    if (res.count !== 1) throw new AppError(409, "VERSION_CONFLICT", "A mérés időközben megváltozott.");
    await writeAudit(tx, { userId: actor.id, action: "INVALIDATE", entityType: "BodyWeight", entityId: id, changes: { status: { before: "VALID", after: "INVALIDATED" } }, reason: input.reason, requestId: input.requestId });
    return { replayed: false };
  });
}

/** The last valid weight of an animal (the calculator's default BW). */
export async function lastBodyWeight(animalId: string) {
  const w = await prisma.bodyWeight.findFirst({ where: { animalId, status: "VALID" }, orderBy: [{ measuredOn: "desc" }, { createdAt: "desc" }] });
  return w ? { day: dateToDay(w.measuredOn), weightKg: canonicalDecimal(w.weightKg) } : null;
}

// ---------------------------------------------------------------------------
// KALK-01, KALK-02: a calculation, optionally saved as the reference
// ---------------------------------------------------------------------------

export const calcSchema = z.object({
  requestId,
  animalId: z.uuid(),
  bwKg: z.string().min(1).max(32),
  frWeekPct: z.number(),
  nWeek: z.number().int(),
  saveAsReference: z.boolean().default(false),
});

export async function runCalculator(actor: Actor, raw: z.input<typeof calcSchema>, serverNow = new Date()) {
  const input = calcSchema.parse(raw);
  const prior = await prisma.calculatorRun.findUnique({ where: { requestId: input.requestId } });
  if (prior) return { replayed: true, runId: prior.id };
  const level = await moduleLevel(prisma, actor.id, actor.role, "FEEDING");
  if (level === "NONE" || level === "READ") throw new AppError(403, "READ_ONLY", "A kalkulátor mentéséhez rögzítési jog kell.");
  const bw = parseDecimalInput(input.bwKg);
  if (bw === null) throw new AppError(422, "BW", "A testtömeg pozitív szám legyen (kg).");
  const r = calculate(Number(bw), input.frWeekPct, input.nWeek);
  return prisma.$transaction(async (tx) => {
    if (!(await tx.animal.findUnique({ where: { id: input.animalId } }))) throw new AppError(404, "ANIMAL_NOT_FOUND", "Az állat nem található.");
    const run = await tx.calculatorRun.create({
      data: {
        animalId: input.animalId,
        bwKg: bw,
        frWeekPct: String(input.frWeekPct),
        nWeek: input.nWeek,
        frDayPct: String(r.frDayPct),
        fKg: String(r.fKg),
        fG: String(r.fG),
        fwG: String(r.fwG),
        savedAsReference: input.saveAsReference,
        requestId: input.requestId,
        createdById: actor.id,
      },
    });
    await writeAudit(tx, {
      userId: actor.id,
      action: "CREATE",
      entityType: "CalculatorRun",
      entityId: run.id,
      changes: { inputs: { before: null, after: { bwKg: bw, frWeekPct: input.frWeekPct, nWeek: input.nWeek } }, fG: { before: null, after: r.fG } },
      requestId: input.requestId,
    });
    if (input.saveAsReference) await saveReference(tx, actor, { animalId: input.animalId }, String(r.fG), run.id, input.requestId, serverNow);
    return { replayed: false, runId: run.id, ...r };
  });
}

/** KALK-02: "every save overwrites" = a new version from now; the old one stays for the old days. */
async function saveReference(tx: Tx, actor: Actor, who: { animalId?: string; groupId?: string }, quantityG: string, runId: string | null, requestId: string, now: Date) {
  const where = who.animalId ? { animalId: who.animalId } : { groupId: who.groupId };
  // the recipient's row is locked first (review note on #14): a lock on the open version alone does
  // not hold when there is none yet, and two first saves would both insert (FOR NO KEY UPDATE, as for
  // the lifecycle, so the foreign-key checks of other writers are not blocked)
  if (who.animalId) await tx.$queryRaw`SELECT "id" FROM "animal" WHERE "id" = ${who.animalId}::uuid FOR NO KEY UPDATE`;
  else await tx.$queryRaw`SELECT "id" FROM "animal_group" WHERE "id" = ${who.groupId ?? null}::uuid FOR NO KEY UPDATE`;
  const open = await tx.feedingReference.findFirst({ where: { ...where, validTo: null } });
  if (open) await tx.feedingReference.update({ where: { id: open.id }, data: { validTo: now } });
  const ref = await tx.feedingReference.create({ data: { ...where, quantityG, calculatorRunId: runId, validFrom: now, createdById: actor.id } });
  await writeAudit(tx, {
    userId: actor.id,
    action: "CREATE",
    entityType: "FeedingReference",
    entityId: ref.id,
    changes: { quantityG: { before: open ? canonicalDecimal(open.quantityG) : null, after: quantityG } },
    requestId,
  });
}

/** The reference valid on a day (at its end, or now for today): recipient key -> grams per feeding. */
export async function referencesOn(day: string, now = new Date()): Promise<Record<string, number>> {
  const { end } = dayBounds(day);
  const at = new Date(Math.min(end.getTime() - 1, now.getTime()));
  const refs = await prisma.feedingReference.findMany({ where: { validFrom: { lte: at }, OR: [{ validTo: null }, { validTo: { gt: at } }] } });
  return Object.fromEntries(refs.map((r) => [r.animalId ?? `g:${r.groupId}`, Number(r.quantityG)]));
}
