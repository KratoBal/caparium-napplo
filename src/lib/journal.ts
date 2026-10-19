// Journal-day locks of the water log (adatmodell 14. terület; R-4, R-15; ÁLT-16).
// The water journal closes automatically at the end of the business day. An admin may reopen a
// closed day (with a reason) and close it again; every step is audited. The job is idempotent:
// it can run every minute, on several instances, and after a downtime it closes every missed day.

import { z } from "zod";
import { writeAudit } from "./audit";
import { prisma, SYSTEM_USER_ID } from "./db";
import { AppError } from "./errors";
import { ensureJournalDay, moduleLevel } from "./master";
import type { Actor } from "./measurements";
import { addDays, businessDayOf, dateToDay, dayToDate, resolveLocalDateTime } from "./time";

/** The planned automatic close of a business day: the next local midnight (DST-safe). */
export function plannedClose(day: string): Date {
  const r = resolveLocalDateTime(`${addDays(day, 1)}T00:00`);
  if (!r) throw new Error(`no midnight after ${day}`);
  return r.instant;
}

export type JobResult = { created: number; closed: number };

export async function runJournalJob(now = new Date()): Promise<JobResult> {
  const today = businessDayOf(now);
  const groups = await prisma.measurementGroup.findMany({ where: { active: true } });
  let created = 0;
  for (const g of groups) {
    const before = await prisma.journalDay.count({ where: { kind: "WATER", groupId: g.id, businessDay: dayToDate(today) } });
    await ensureJournalDay(prisma, "WATER", g.id, today);
    if (before === 0) created += 1;
  }

  // every open water day before today, unless an admin has reopened it and not closed it again
  const due = await prisma.journalDay.findMany({
    where: {
      kind: "WATER",
      state: "OPEN",
      businessDay: { lt: dayToDate(today) },
      reopenings: { none: { reclosedAt: null } },
    },
    orderBy: { businessDay: "asc" },
  });
  let closed = 0;
  for (const j of due) {
    const day = dateToDay(j.businessDay);
    const done = await prisma.$transaction(async (tx) => {
      const res = await tx.journalDay.updateMany({
        where: { id: j.id, state: "OPEN" },
        data: { state: "CLOSED", closeMode: "AUTOMATIC", closedById: SYSTEM_USER_ID, closedAt: plannedClose(day), closeRanAt: now },
      });
      if (res.count !== 1) return false;
      await writeAudit(tx, {
        userId: SYSTEM_USER_ID,
        action: "CLOSE",
        entityType: "JournalDay",
        entityId: j.id,
        changes: { state: { before: "OPEN", after: "CLOSED" }, businessDay: { before: null, after: day } },
      });
      return true;
    });
    if (done) closed += 1;
  }
  return { created, closed };
}

export const dayActionSchema = z.object({
  requestId: z.string().min(8).max(100),
  groupId: z.uuid(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(3, "Az indoklás legalább 3 karakter legyen.").max(500).optional(),
});
export type DayActionInput = z.infer<typeof dayActionSchema>;

async function requireAdmin(actor: Actor) {
  const level = await moduleLevel(prisma, actor.id, actor.role, "WATER");
  if (level !== "ADMIN") throw new AppError(403, "ADMIN_ONLY", "Napot újranyitni és lezárni csak adminisztrátor tud.");
}

async function replayed(requestId: string) {
  return (await prisma.auditEntry.findFirst({ where: { requestId, entityType: "JournalDay" } })) !== null;
}

export async function reopenDay(actor: Actor, input: DayActionInput) {
  await requireAdmin(actor);
  if (!input.reason) throw new AppError(422, "REASON_REQUIRED", "Az újranyitáshoz indoklás kell.");
  if (await replayed(input.requestId)) return { replayed: true };
  return prisma.$transaction(async (tx) => {
    const j = await tx.journalDay.findFirst({ where: { kind: "WATER", groupId: input.groupId, businessDay: dayToDate(input.day) } });
    if (!j || j.state !== "CLOSED") throw new AppError(409, "NOT_CLOSED", "Ez a nap nincs lezárva.");
    const res = await tx.journalDay.updateMany({
      where: { id: j.id, state: "CLOSED" },
      data: { state: "OPEN", closeMode: null, closedById: null, closedAt: null, closeRanAt: null },
    });
    if (res.count !== 1) throw new AppError(409, "NOT_CLOSED", "Ez a nap nincs lezárva.");
    await tx.journalReopen.create({ data: { journalDayId: j.id, reopenedById: actor.id, reason: input.reason! } });
    await writeAudit(tx, {
      userId: actor.id,
      action: "REOPEN",
      entityType: "JournalDay",
      entityId: j.id,
      changes: { state: { before: "CLOSED", after: "OPEN" }, businessDay: { before: null, after: input.day } },
      reason: input.reason,
      requestId: input.requestId,
    });
    return { replayed: false };
  });
}

export async function recloseDay(actor: Actor, input: DayActionInput, now = new Date()) {
  await requireAdmin(actor);
  if (await replayed(input.requestId)) return { replayed: true };
  return prisma.$transaction(async (tx) => {
    const j = await tx.journalDay.findFirst({
      where: { kind: "WATER", groupId: input.groupId, businessDay: dayToDate(input.day) },
      include: { reopenings: { where: { reclosedAt: null } } },
    });
    if (!j || j.state !== "OPEN" || j.reopenings.length === 0) {
      throw new AppError(409, "NOT_REOPENED", "Csak újranyitott napot lehet kézzel lezárni.");
    }
    await tx.journalDay.update({
      where: { id: j.id },
      data: { state: "CLOSED", closeMode: "MANUAL", closedById: actor.id, closedAt: now, closeRanAt: now },
    });
    await tx.journalReopen.updateMany({ where: { journalDayId: j.id, reclosedAt: null }, data: { reclosedAt: now } });
    await writeAudit(tx, {
      userId: actor.id,
      action: "CLOSE",
      entityType: "JournalDay",
      entityId: j.id,
      changes: { state: { before: "OPEN", after: "CLOSED" }, businessDay: { before: null, after: input.day } },
      reason: input.reason ?? null,
      requestId: input.requestId,
    });
    return { replayed: false };
  });
}

/** The lock of a day as the pages show it. */
export async function dayStatus(groupId: string, day: string) {
  const j = await prisma.journalDay.findFirst({
    where: { kind: "WATER", groupId, businessDay: dayToDate(day) },
    include: { reopenings: { where: { reclosedAt: null } } },
  });
  return {
    state: (j?.state ?? "OPEN") as "OPEN" | "CLOSED",
    closeMode: j?.closeMode ?? null,
    reopened: (j?.reopenings.length ?? 0) > 0,
  };
}
