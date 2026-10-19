// Measurement writes (adatmodell 4. terület, K5, K6, K9; T-02, T-07, R-6, R-10).
// Every write: permission check, optimistic version, idempotent request id, and the audit
// entry in the same transaction as the change.

import type { DiluentWater, Measurement, RecordStatus } from "@prisma/client";
import { z } from "zod";
import { diffFields, writeAudit } from "./audit";
import { prisma, type Tx } from "./db";
import { compareDecimal, parseDecimalInput, canonicalDecimal } from "./decimal";
import { AppError, isUniqueViolation } from "./errors";
import { ensureJournalDay, getSetting, groupLayout, moduleLevel, referenceAt } from "./master";
import { canCreate, canModify, effectiveNow, type Decision, type Role } from "./permissions";
import { businessDayOf, dateToDay, dayToDate, resolveLocalDateTime } from "./time";

export type Actor = { id: string; role: Role };

const reasonSchema = z.string().trim().min(3, "Az indoklás legalább 3 karakter legyen.").max(500);

const optionalFields = {
  measuredAtLocal: z.string().optional(),
  responsibleUserId: z.uuid().optional(),
  traineePerformed: z.boolean().optional(),
  dilution: z.number().int().min(1).max(100).nullable().optional(),
  diluentWater: z.enum(["RO", "SW"]).nullable().optional(),
  reason: reasonSchema.optional(),
  confirmPlausibility: z.boolean().optional(),
  newRound: z.boolean().optional(),
};

export const createSchema = z.object({
  requestId: z.string().min(8).max(100),
  clientTimestamp: z.iso.datetime({ offset: true }).optional(),
  groupId: z.uuid(),
  roundId: z.uuid().nullable().optional(),
  poolId: z.uuid(),
  parameterId: z.uuid(),
  value: z.string().min(1).max(32),
  ...optionalFields,
});

export const updateSchema = z.object({
  requestId: z.string().min(8).max(100),
  clientTimestamp: z.iso.datetime({ offset: true }).optional(),
  expectedVersion: z.number().int().min(1),
  value: z.string().min(1).max(32).optional(),
  ...optionalFields,
});

export const invalidateSchema = z.object({
  requestId: z.string().min(8).max(100),
  clientTimestamp: z.iso.datetime({ offset: true }).optional(),
  expectedVersion: z.number().int().min(1),
  reason: reasonSchema,
});

export const newRoundSchema = z.object({
  requestId: z.string().min(8).max(100),
  clientTimestamp: z.iso.datetime({ offset: true }).optional(),
  groupId: z.uuid(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: reasonSchema.optional(),
});

export type CreateInput = z.infer<typeof createSchema>;
export type UpdateInput = z.infer<typeof updateSchema>;
export type InvalidateInput = z.infer<typeof invalidateSchema>;
export type NewRoundInput = z.infer<typeof newRoundSchema>;

export type MeasurementView = {
  id: string;
  roundId: string;
  poolId: string;
  parameterId: string;
  value: string;
  measuredAt: string;
  businessDay: string;
  version: number;
  status: RecordStatus;
  responsibleUserId: string;
  createdById: string;
  traineePerformed: boolean;
  dilution: number | null;
  diluentWater: DiluentWater | null;
};

export type WriteResult = {
  measurement: MeasurementView;
  /** true when this request id was already processed: nothing new was written */
  replayed: boolean;
  /** the wall-clock time was in the autumn repeated hour; the earlier instant was used */
  ambiguousTime?: boolean;
};

export function toView(m: Measurement): MeasurementView {
  return {
    id: m.id,
    roundId: m.roundId,
    poolId: m.poolId,
    parameterId: m.parameterId,
    value: canonicalDecimal(m.value),
    measuredAt: m.measuredAt.toISOString(),
    businessDay: dateToDay(m.businessDay),
    version: m.version,
    status: m.status,
    responsibleUserId: m.responsibleUserId,
    createdById: m.createdById,
    traineePerformed: m.traineePerformed,
    dilution: m.dilution,
    diluentWater: m.diluentWater,
  };
}

/** The audited fields of a measurement, as plain JSON values. */
function snapshot(m: Measurement): Record<string, unknown> {
  return {
    value: canonicalDecimal(m.value),
    measuredAt: m.measuredAt.toISOString(),
    businessDay: dateToDay(m.businessDay),
    roundId: m.roundId,
    poolId: m.poolId,
    parameterId: m.parameterId,
    unitId: m.unitId,
    responsibleUserId: m.responsibleUserId,
    traineePerformed: m.traineePerformed,
    dilution: m.dilution,
    diluentWater: m.diluentWater,
    referenceRangeId: m.referenceRangeId,
    status: m.status,
    invalidationReason: m.invalidationReason,
    version: m.version,
  };
}

function parseValue(raw: string): string {
  const v = parseDecimalInput(raw);
  if (v === null) {
    throw new AppError(422, "INVALID_VALUE", "Az érték nem szám. Tizedesvessző és pont is használható.");
  }
  return v;
}

function parseClientTs(s: string | undefined): Date | null {
  return s ? new Date(s) : null;
}

function resolveMeasuredAt(local: string | undefined, fallback: Date): { at: Date; ambiguous: boolean } {
  if (!local) return { at: fallback, ambiguous: false };
  const r = resolveLocalDateTime(local);
  if (!r) throw new AppError(422, "INVALID_TIME", "A mérés időpontja érvénytelen.");
  return { at: r.instant, ambiguous: r.ambiguous };
}

function checkPlausible(value: string, p: { plausibleMin: string | null; plausibleMax: string | null }, confirmed?: boolean) {
  if (confirmed) return;
  const low = p.plausibleMin !== null && compareDecimal(value, p.plausibleMin) < 0;
  const high = p.plausibleMax !== null && compareDecimal(value, p.plausibleMax) > 0;
  if (low || high) {
    throw new AppError(
      422,
      "IMPLAUSIBLE_VALUE",
      "Ez az érték szokatlan, lehet, hogy elírás. Ellenőrizd, és ha helyes, erősítsd meg.",
      { plausibleMin: p.plausibleMin, plausibleMax: p.plausibleMax },
    );
  }
}

type LateWindow = { graceMinutes: number; maxLateHours: number };

async function lateWindow(tx: Tx, at: Date): Promise<LateWindow> {
  return {
    graceMinutes: Number(await getSetting(tx, "late_save_grace_minutes", at)),
    maxLateHours: Number(await getSetting(tx, "late_save_max_hours", at)),
  };
}

/**
 * Applies the K9 rule around a permission check: first at the effective time; if that denies,
 * but the client's (late) original time would allow it, the save becomes PENDING.
 */
function decideWithLateRule(
  check: (today: string) => Decision,
  serverNow: Date,
  clientTs: Date | null,
  window: LateWindow,
): { decision: Decision; pending: boolean } {
  const eff = effectiveNow(serverNow, clientTs, window.graceMinutes, window.maxLateHours);
  const decision = check(businessDayOf(eff.now));
  if (decision.kind === "ALLOW") return { decision, pending: false };
  if (eff.late && eff.clientNow) {
    const atClient = check(businessDayOf(eff.clientNow));
    if (atClient.kind === "ALLOW") return { decision: atClient, pending: true };
  }
  return { decision, pending: false };
}

function enforce(decision: Decision, reason: string | undefined): void {
  if (decision.kind === "DENY") throw new AppError(403, decision.code, decision.message);
  if (decision.reasonRequired && !reason) {
    throw new AppError(422, "REASON_REQUIRED", "Korábbi vagy lezárt nap módosításához indoklás kell.");
  }
}

async function findOrCreateRound(
  tx: Tx,
  actor: Actor,
  groupId: string,
  day: string,
  opts: { roundId?: string | null; newRound?: boolean },
) {
  const businessDay = dayToDate(day);
  if (opts.roundId && !opts.newRound) {
    const round = await tx.measurementRound.findUnique({ where: { id: opts.roundId } });
    if (!round || round.groupId !== groupId) throw new AppError(404, "ROUND_NOT_FOUND", "A mérési kör nem található.");
    if (dateToDay(round.businessDay) === day) return round;
    // The measurement time points to another day: it belongs to that day's round (R-6).
  }
  const latest = await tx.measurementRound.findFirst({ where: { groupId, businessDay }, orderBy: { seq: "desc" } });
  if (latest && !opts.newRound) return latest;
  const seq = (latest?.seq ?? 0) + 1;
  await tx.$executeRaw`
    INSERT INTO "measurement_round" ("id", "groupId", "businessDay", "seq", "createdById", "createdAt")
    VALUES (gen_random_uuid(), ${groupId}::uuid, ${businessDay}::date, ${seq}, ${actor.id}::uuid, now())
    ON CONFLICT DO NOTHING`;
  const round = await tx.measurementRound.findFirst({ where: { groupId, businessDay, seq } });
  if (!round) throw new Error("round could not be created");
  return round;
}

async function responsibleUser(tx: Tx, id: string): Promise<string> {
  const u = await tx.user.findUnique({ where: { id } });
  if (!u || !u.active || (u.role !== "AQUARIST" && u.role !== "ADMIN")) {
    throw new AppError(422, "INVALID_RESPONSIBLE", "A „Mérést végezte” mezőben aktív dolgozó álljon.");
  }
  return u.id;
}

async function conflictDetails(roundId: string, poolId: string, parameterId: string) {
  const existing = await prisma.measurement.findFirst({
    where: { roundId, poolId, parameterId, status: "VALID" },
    include: { round: true },
  });
  return existing ? toView(existing) : null;
}

async function auditConflict(actor: Actor, entityId: string, kept: unknown, rejected: unknown, requestId: string) {
  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, {
      userId: actor.id,
      action: "CONFLICT_REJECTED",
      entityType: "Measurement",
      entityId,
      changes: { value: { before: kept, after: rejected } },
      requestId,
    });
  });
}

export async function createMeasurement(actor: Actor, input: CreateInput, serverNow = new Date()): Promise<WriteResult> {
  const prior = await prisma.measurement.findUnique({ where: { requestId: input.requestId } });
  if (prior) {
    if (prior.createdById !== actor.id) throw new AppError(409, "REQUEST_ID_REUSED", "Ismételt kérésazonosító.");
    return { measurement: toView(prior), replayed: true };
  }
  const value = parseValue(input.value);
  const clientTs = parseClientTs(input.clientTimestamp);
  let cell: { roundId: string } | null = null;

  try {
    return await prisma.$transaction(async (tx) => {
      const grace = await lateWindow(tx, serverNow);
      const eff = effectiveNow(serverNow, clientTs, grace.graceMinutes, grace.maxLateHours);
      const { at: measuredAt, ambiguous } = resolveMeasuredAt(input.measuredAtLocal, eff.clientNow ?? serverNow);
      const day = businessDayOf(measuredAt);

      const group = await tx.measurementGroup.findUnique({ where: { id: input.groupId } });
      if (!group || !group.active) throw new AppError(404, "GROUP_NOT_FOUND", "A mérési csoport nem található.");
      const layout = await groupLayout(tx, group.id, measuredAt);
      const pool = layout.pools.find((p) => p.id === input.poolId);
      const param = layout.parameters.find((p) => p.id === input.parameterId);
      if (!pool || !param) {
        throw new AppError(422, "NOT_IN_GROUP", "Ez a medence vagy paraméter ezen a napon nem tartozik a csoporthoz.");
      }
      checkPlausible(value, param, input.confirmPlausibility);

      const journal = await ensureJournalDay(tx, "WATER", group.id, day);
      const level = await moduleLevel(tx, actor.id, actor.role, "WATER");
      const { decision, pending } = decideWithLateRule(
        (today) => canCreate(level, { day, today, closed: journal.state === "CLOSED" }),
        serverNow,
        clientTs,
        grace,
      );
      enforce(decision, input.reason);

      const round = await findOrCreateRound(tx, actor, group.id, day, { roundId: input.roundId, newRound: input.newRound });
      cell = { roundId: round.id };
      const responsibleId = await responsibleUser(tx, input.responsibleUserId ?? actor.id);
      const ref = await referenceAt(tx, param.id, measuredAt);

      const created = await tx.measurement.create({
        data: {
          roundId: round.id,
          poolId: pool.id,
          parameterId: param.id,
          value,
          unitId: param.unit.id,
          measuredAt,
          businessDay: dayToDate(day),
          dilution: input.dilution ?? null,
          diluentWater: input.diluentWater ?? null,
          responsibleUserId: responsibleId,
          traineePerformed: input.traineePerformed ?? false,
          referenceRangeId: ref?.id ?? null,
          requestId: input.requestId,
          status: pending ? "PENDING" : "VALID",
          createdById: actor.id,
          clientTimestamp: clientTs,
          updatedById: actor.id,
        },
      });
      await writeAudit(tx, {
        userId: actor.id,
        action: pending ? "PENDING_CREATED" : "CREATE",
        entityType: "Measurement",
        entityId: created.id,
        changes: diffFields(null, snapshot(created)),
        reason: input.reason ?? null,
        requestId: input.requestId,
        clientTimestamp: clientTs,
      });
      return { measurement: toView(created), replayed: false, ambiguousTime: ambiguous || undefined };
    });
  } catch (e) {
    if (isUniqueViolation(e, "requestId")) {
      const again = await prisma.measurement.findUnique({ where: { requestId: input.requestId } });
      if (again) return { measurement: toView(again), replayed: true };
    }
    if (isUniqueViolation(e) && cell) {
      const existing = await conflictDetails((cell as { roundId: string }).roundId, input.poolId, input.parameterId);
      if (existing) {
        await auditConflict(actor, existing.id, existing.value, value, input.requestId);
        throw new AppError(409, "CELL_TAKEN", "Ebbe a cellába közben más már mentett értéket.", { existing });
      }
    }
    throw e;
  }
}

async function alreadyProcessed(requestId: string, entityId: string): Promise<boolean> {
  const hit = await prisma.auditEntry.findFirst({ where: { requestId, entityId } });
  return hit !== null;
}

export async function updateMeasurement(
  actor: Actor,
  id: string,
  input: UpdateInput,
  serverNow = new Date(),
): Promise<WriteResult> {
  if (await alreadyProcessed(input.requestId, id)) {
    const cur = await prisma.measurement.findUnique({ where: { id } });
    if (!cur) throw new AppError(404, "NOT_FOUND", "A mérés nem található.");
    return { measurement: toView(cur), replayed: true };
  }
  const clientTs = parseClientTs(input.clientTimestamp);
  const newValue = input.value !== undefined ? parseValue(input.value) : undefined;
  let target: { roundId: string; poolId: string; parameterId: string } | null = null;

  try {
    return await prisma.$transaction(async (tx) => {
      const cur = await tx.measurement.findUnique({ where: { id }, include: { round: true } });
      if (!cur) throw new AppError(404, "NOT_FOUND", "A mérés nem található.");
      if (cur.status !== "VALID") {
        throw new AppError(409, "NOT_EDITABLE", "Érvénytelenített vagy függő mérés nem módosítható.");
      }
      if (cur.version !== input.expectedVersion) {
        throw new AppError(409, "VERSION_CONFLICT", "A mérés időközben megváltozott.", { current: toView(cur) });
      }
      const grace = await lateWindow(tx, serverNow);
      const { at: measuredAt, ambiguous } = resolveMeasuredAt(input.measuredAtLocal, cur.measuredAt);
      const oldDay = dateToDay(cur.businessDay);
      const newDay = businessDayOf(measuredAt);

      const oldJournal = await ensureJournalDay(tx, "WATER", cur.round.groupId, oldDay);
      const newJournal = newDay === oldDay ? oldJournal : await ensureJournalDay(tx, "WATER", cur.round.groupId, newDay);
      const level = await moduleLevel(tx, actor.id, actor.role, "WATER");
      const { decision } = decideWithLateRule(
        (today) =>
          canModify(level, {
            day: oldDay,
            today,
            closed: oldJournal.state === "CLOSED",
            isOwn: cur.createdById === actor.id,
            targetDay: newDay,
            targetClosed: newJournal.state === "CLOSED",
          }),
        serverNow,
        clientTs,
        grace,
      );
      // A late edit is not turned into a pending row: the original value stays valid,
      // and the user gets the denial (only creations queue as PENDING, K9).
      enforce(decision, input.reason);

      const layout = await groupLayout(tx, cur.round.groupId, measuredAt);
      const param = layout.parameters.find((p) => p.id === cur.parameterId);
      if (!layout.pools.some((p) => p.id === cur.poolId) || !param) {
        throw new AppError(422, "NOT_IN_GROUP", "Ezen a napon ez a medence vagy paraméter nem tartozik a csoporthoz.");
      }
      if (newValue !== undefined) checkPlausible(newValue, param, input.confirmPlausibility);

      let roundId = cur.roundId;
      if (newDay !== oldDay || input.newRound) {
        const round = await findOrCreateRound(tx, actor, cur.round.groupId, newDay, { newRound: input.newRound });
        roundId = round.id;
      }
      target = { roundId, poolId: cur.poolId, parameterId: cur.parameterId };
      const responsibleId =
        input.responsibleUserId !== undefined ? await responsibleUser(tx, input.responsibleUserId) : cur.responsibleUserId;
      const ref = await referenceAt(tx, cur.parameterId, measuredAt);

      const res = await tx.measurement.updateMany({
        where: { id, version: input.expectedVersion, status: "VALID" },
        data: {
          roundId,
          value: newValue ?? undefined,
          measuredAt,
          businessDay: dayToDate(newDay),
          responsibleUserId: responsibleId,
          traineePerformed: input.traineePerformed ?? undefined,
          dilution: input.dilution === undefined ? undefined : input.dilution,
          diluentWater: input.diluentWater === undefined ? undefined : input.diluentWater,
          referenceRangeId: ref?.id ?? null,
          version: { increment: 1 },
          updatedById: actor.id,
          updatedAt: serverNow,
        },
      });
      if (res.count !== 1) {
        const now = await tx.measurement.findUnique({ where: { id } });
        throw new AppError(409, "VERSION_CONFLICT", "A mérés időközben megváltozott.", { current: now ? toView(now) : null });
      }
      const updated = await tx.measurement.findUniqueOrThrow({ where: { id } });
      await writeAudit(tx, {
        userId: actor.id,
        action: "UPDATE",
        entityType: "Measurement",
        entityId: id,
        changes: diffFields(snapshot(cur), snapshot(updated)),
        reason: input.reason ?? null,
        requestId: input.requestId,
        clientTimestamp: clientTs,
      });
      return { measurement: toView(updated), replayed: false, ambiguousTime: ambiguous || undefined };
    });
  } catch (e) {
    if (e instanceof AppError && e.code === "VERSION_CONFLICT") {
      const current = (e.details?.current ?? null) as MeasurementView | null;
      await auditConflict(actor, id, current?.value ?? null, newValue ?? null, input.requestId);
    }
    if (isUniqueViolation(e) && target) {
      const t = target as { roundId: string; poolId: string; parameterId: string };
      const existing = await conflictDetails(t.roundId, t.poolId, t.parameterId);
      throw new AppError(
        409,
        "TARGET_CELL_TAKEN",
        "A célnapon ez a cella már foglalt. Nyiss új mérési kört, vagy vesd el az áthelyezést.",
        { existing },
      );
    }
    throw e;
  }
}

export async function invalidateMeasurement(
  actor: Actor,
  id: string,
  input: InvalidateInput,
  serverNow = new Date(),
): Promise<WriteResult> {
  if (await alreadyProcessed(input.requestId, id)) {
    const cur = await prisma.measurement.findUniqueOrThrow({ where: { id } });
    return { measurement: toView(cur), replayed: true };
  }
  const clientTs = parseClientTs(input.clientTimestamp);
  return prisma.$transaction(async (tx) => {
    const cur = await tx.measurement.findUnique({ where: { id }, include: { round: true } });
    if (!cur) throw new AppError(404, "NOT_FOUND", "A mérés nem található.");
    if (cur.status !== "VALID") throw new AppError(409, "NOT_EDITABLE", "Ez a mérés már nem érvényes.");
    if (cur.version !== input.expectedVersion) {
      throw new AppError(409, "VERSION_CONFLICT", "A mérés időközben megváltozott.", { current: toView(cur) });
    }
    const grace = await lateWindow(tx, serverNow);
    const day = dateToDay(cur.businessDay);
    const journal = await ensureJournalDay(tx, "WATER", cur.round.groupId, day);
    const level = await moduleLevel(tx, actor.id, actor.role, "WATER");
    const { decision } = decideWithLateRule(
      (today) => canModify(level, { day, today, closed: journal.state === "CLOSED", isOwn: cur.createdById === actor.id }),
      serverNow,
      clientTs,
      grace,
    );
    enforce(decision, input.reason);
    const res = await tx.measurement.updateMany({
      where: { id, version: input.expectedVersion, status: "VALID" },
      data: {
        status: "INVALIDATED",
        invalidationReason: input.reason,
        version: { increment: 1 },
        updatedById: actor.id,
        updatedAt: serverNow,
      },
    });
    if (res.count !== 1) throw new AppError(409, "VERSION_CONFLICT", "A mérés időközben megváltozott.");
    const updated = await tx.measurement.findUniqueOrThrow({ where: { id } });
    await writeAudit(tx, {
      userId: actor.id,
      action: "INVALIDATE",
      entityType: "Measurement",
      entityId: id,
      changes: diffFields(snapshot(cur), snapshot(updated)),
      reason: input.reason,
      requestId: input.requestId,
      clientTimestamp: clientTs,
    });
    return { measurement: toView(updated), replayed: false };
  });
}

/** "Új mérés ma" (T-07): opens the next round of a group on a day; earlier rounds stay. */
export async function openNewRound(actor: Actor, input: NewRoundInput, serverNow = new Date()) {
  const replay = await prisma.auditEntry.findFirst({ where: { requestId: input.requestId, entityType: "MeasurementRound" } });
  if (replay) {
    const round = await prisma.measurementRound.findUniqueOrThrow({ where: { id: replay.entityId } });
    return { round, replayed: true };
  }
  const clientTs = parseClientTs(input.clientTimestamp);
  return prisma.$transaction(async (tx) => {
    const group = await tx.measurementGroup.findUnique({ where: { id: input.groupId } });
    if (!group || !group.active) throw new AppError(404, "GROUP_NOT_FOUND", "A mérési csoport nem található.");
    const grace = await lateWindow(tx, serverNow);
    const journal = await ensureJournalDay(tx, "WATER", group.id, input.day);
    const level = await moduleLevel(tx, actor.id, actor.role, "WATER");
    const { decision } = decideWithLateRule(
      (today) => canCreate(level, { day: input.day, today, closed: journal.state === "CLOSED" }),
      serverNow,
      clientTs,
      grace,
    );
    enforce(decision, input.reason);
    const round = await findOrCreateRound(tx, actor, group.id, input.day, { newRound: true });
    await writeAudit(tx, {
      userId: actor.id,
      action: "CREATE",
      entityType: "MeasurementRound",
      entityId: round.id,
      changes: diffFields(null, { groupId: group.id, businessDay: input.day, seq: round.seq }),
      reason: input.reason ?? null,
      requestId: input.requestId,
      clientTimestamp: clientTs,
    });
    return { round, replayed: false };
  });
}

