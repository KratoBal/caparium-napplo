// Eating statuses (adatmodell 10. terület; EVE-01..EVE-06, EVE-11, DN-03, R-1, R-2).
// One valid status per (day, animal), always an individual animal (EVE-03). A selected animal ate,
// partly ate or did not eat; an animal not selected can only have a fasting day (INV). The automatic
// fasting days are written by the close (feeding.ts recomputeFasting); a manual status replaces an
// automatic one for the same animal, so vitamin and medicine can be marked on a fasting day too.

import type { EatingStatus } from "@prisma/client";
import { z } from "zod";
import { diffFields, writeAudit } from "./audit";
import { prisma } from "./db";
import { AppError, isUniqueViolation } from "./errors";
import { aliveOnDay, enforce, facts, fastingEligible, selectedOn } from "./feeding";
import { requireReason } from "./reasons";
import type { Actor } from "./measurements";
import { canCreate, canModify } from "./permissions";
import { dateToDay, dayToDate } from "./time";

const requestId = z.string().min(8).max(100);
const reason = z.string().trim().min(3, "Az indoklás legalább 3 karakter legyen.").max(500);

export const eatingSchema = z.object({
  requestId,
  clientTimestamp: z.iso.datetime({ offset: true }).optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  animalId: z.uuid(),
  statusId: z.uuid().optional(),
  expectedVersion: z.number().int().min(1).optional(),
  state: z.enum(["EATEN", "PARTIAL", "NOT_EATEN", "FASTING"]),
  vitamin: z.boolean().default(false),
  medicine: z.boolean().default(false),
  medicineNote: z.string().trim().max(300).refine((v) => !/^[=+\-@\t\r]/.test(v), "A megjegyzés nem kezdődhet =, +, -, @ jellel.").optional(),
  reason: reason.optional(),
});
export type EatingInput = z.input<typeof eatingSchema>;

export const eatingInvalidateSchema = z.object({ requestId, expectedVersion: z.number().int().min(1), reason: reason.optional() });

function snapshot(s: Pick<EatingStatus, "state" | "source" | "vitamin" | "medicine" | "medicineNote" | "status">) {
  return { state: s.state, source: s.source, vitamin: s.vitamin, medicine: s.medicine, medicineNote: s.medicineNote, status: s.status };
}

/** Records or changes the eating status of one animal on one day (EVE-01, EVE-02, EVE-04, EVE-05). */
export async function setEatingStatus(actor: Actor, raw: EatingInput, serverNow = new Date()) {
  const input = eatingSchema.parse(raw);
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  const note = input.medicineNote ? input.medicineNote : null;
  if (note && !input.medicine) throw new AppError(422, "NOTE_WITHOUT_MEDICINE", "Gyógyszer-megjegyzés csak bejelölt gyógyszer mellett adható.");
  const clientTs = input.clientTimestamp ? new Date(input.clientTimestamp) : null;
  try {
    return await prisma.$transaction(async (tx) => {
      const { f, fd } = await facts(tx, actor, input.day, serverNow, clientTs);
      const alive = await aliveOnDay(tx, input.day, [input.animalId]);
      if (!alive.has(input.animalId)) throw new AppError(422, "NOT_ALIVE", "Ezen a napon nem élő vagy még nem érkezett állat.");
      const selected = (await selectedOn(tx, fd.id)).has(input.animalId);
      if (selected && input.state === "FASTING") {
        throw new AppError(422, "SELECTED_NOT_FASTING", "A mai listán kiválasztott állatnak nem lehet koplalónapja: előbb vedd ki a listából.");
      }
      if (!selected && input.state !== "FASTING") {
        throw new AppError(422, "NOT_SELECTED", "A mai listán nem szereplő állatnak csak koplalónapja lehet.");
      }

      const current = await tx.eatingStatus.findFirst({ where: { feedingDayId: fd.id, animalId: input.animalId, status: "VALID" } });
      if (input.statusId) {
        if (!current || current.id !== input.statusId) throw new AppError(409, "VERSION_CONFLICT", "Az állapot időközben megváltozott.");
        if (current.version !== input.expectedVersion) throw new AppError(409, "VERSION_CONFLICT", "Az állapot időközben megváltozott.");
      } else if (current?.source === "MANUAL") {
        throw new AppError(409, "CELL_TAKEN", "Ennek az állatnak ma már van evési állapota.", { statusId: current.id, version: current.version });
      }

      const data = { state: input.state, vitamin: input.vitamin, medicine: input.medicine, medicineNote: note };
      if (current?.source === "MANUAL") {
        await enforce(tx, canModify(f.level, { day: f.d, today: f.today, closed: f.closed, isOwn: current.createdById === actor.id, othersToo: true }), input.reason);
        const res = await tx.eatingStatus.updateMany({
          where: { id: current.id, version: current.version, status: "VALID" },
          data: { ...data, version: { increment: 1 }, updatedById: actor.id, updatedAt: serverNow },
        });
        if (res.count !== 1) throw new AppError(409, "VERSION_CONFLICT", "Az állapot időközben megváltozott.");
        await writeAudit(tx, {
          userId: actor.id,
          action: "UPDATE",
          entityType: "EatingStatus",
          entityId: current.id,
          changes: diffFields(snapshot(current), snapshot({ ...current, ...data })),
          reason: input.reason ?? null,
          requestId: input.requestId,
          clientTimestamp: clientTs,
        });
        return { replayed: false, statusId: current.id, version: current.version + 1 };
      }

      await enforce(tx, canCreate(f.level, { day: f.d, today: f.today, closed: f.closed }), input.reason);
      if (current) {
        // an automatic fasting day: the manual status takes its place (and keeps it at a recompute)
        const why = "kézi evési állapot váltja";
        await tx.eatingStatus.update({ where: { id: current.id }, data: { status: "INVALIDATED", invalidationReason: why, version: { increment: 1 }, updatedById: actor.id, updatedAt: serverNow } });
        await writeAudit(tx, { userId: actor.id, action: "INVALIDATE", entityType: "EatingStatus", entityId: current.id, changes: { status: { before: "VALID", after: "INVALIDATED" } }, reason: why, requestId: input.requestId });
      }
      const row = await tx.eatingStatus.create({
        data: { feedingDayId: fd.id, animalId: input.animalId, ...data, source: "MANUAL", requestId: input.requestId, createdById: actor.id, updatedById: actor.id },
      });
      await writeAudit(tx, {
        userId: actor.id,
        action: "CREATE",
        entityType: "EatingStatus",
        entityId: row.id,
        changes: diffFields(null, { animalId: input.animalId, ...snapshot(row) }),
        reason: input.reason ?? null,
        requestId: input.requestId,
        clientTimestamp: clientTs,
      });
      return { replayed: false, statusId: row.id, version: row.version };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError(409, "CELL_TAKEN", "Ennek az állatnak közben más már rögzített evési állapotot.");
    throw e;
  }
}

/** Invalidates a manual status; an automatic fasting day follows the list and the close only. */
export async function invalidateEatingStatus(actor: Actor, id: string, raw: z.input<typeof eatingInvalidateSchema>, serverNow = new Date()) {
  const input = eatingInvalidateSchema.parse(raw);
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  return prisma.$transaction(async (tx) => {
    const st = await tx.eatingStatus.findUnique({ where: { id }, include: { feedingDay: true } });
    if (!st) throw new AppError(404, "NOT_FOUND", "Az állapot nem található.");
    if (st.source === "AUTOMATIC") {
      throw new AppError(409, "AUTOMATIC", "Az automatikus koplalónap a listát követi: az állatot a listára véve vagy kézi állapottal lehet felülírni.");
    }
    const { f } = await facts(tx, actor, dateToDay(st.feedingDay.businessDay), serverNow, null);
    await enforce(tx, canModify(f.level, { day: f.d, today: f.today, closed: f.closed, isOwn: st.createdById === actor.id, othersToo: true }), input.reason);
    await requireReason(tx, true, input.reason, "Az érvénytelenítéshez indoklás kell.");
    const res = await tx.eatingStatus.updateMany({
      where: { id, version: input.expectedVersion, status: "VALID" },
      data: { status: "INVALIDATED", invalidationReason: input.reason, version: { increment: 1 }, updatedById: actor.id, updatedAt: serverNow },
    });
    if (res.count !== 1) throw new AppError(409, "VERSION_CONFLICT", "Az állapot időközben megváltozott.");
    await writeAudit(tx, { userId: actor.id, action: "INVALIDATE", entityType: "EatingStatus", entityId: id, changes: { status: { before: "VALID", after: "INVALIDATED" } }, reason: input.reason, requestId: input.requestId });
    return { replayed: false };
  });
}

export type EatingRow = {
  animalId: string;
  selected: boolean;
  status: { id: string; version: number; state: string; source: string; vitamin: boolean; medicine: boolean; medicineNote: string | null; createdById: string } | null;
  /** an open day: not selected, would get a fasting day at the close ("koplal, még nem végleges") */
  pendingFasting: boolean;
};

/** The eating log of one day: the stored statuses and, on an open day, the fasting days to come. */
export async function eatingDayView(d: string): Promise<{ day: string; listState: string; lock: string; reopened: boolean; rows: EatingRow[] }> {
  const fd = await prisma.feedingDay.findUnique({
    where: { businessDay: dayToDate(d) },
    include: { journalDay: { include: { reopenings: { where: { reclosedAt: null } } } } },
  });
  const alive = await aliveOnDay(prisma, d);
  const selected = fd ? await selectedOn(prisma, fd.id) : new Set<string>();
  const statuses = fd ? await prisma.eatingStatus.findMany({ where: { feedingDayId: fd.id, status: "VALID" } }) : [];
  const byAnimal = new Map(statuses.map((s) => [s.animalId, s]));
  const closed = fd?.journalDay.state === "CLOSED";
  const eligible = closed ? new Set<string>() : await fastingEligible(prisma, d);
  const rows = [...alive].map((animalId): EatingRow => {
    const s = byAnimal.get(animalId);
    return {
      animalId,
      selected: selected.has(animalId),
      status: s ? { id: s.id, version: s.version, state: s.state, source: s.source, vitamin: s.vitamin, medicine: s.medicine, medicineNote: s.medicineNote, createdById: s.createdById } : null,
      pendingFasting: !closed && !s && !selected.has(animalId) && eligible.has(animalId),
    };
  });
  return {
    day: d,
    listState: fd?.listState ?? "NOT_FINALIZED",
    lock: fd?.journalDay.state ?? "OPEN",
    reopened: (fd?.journalDay.reopenings.length ?? 0) > 0,
    rows,
  };
}
