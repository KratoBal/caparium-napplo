// Lili 2026-11-01 (point 16): the days a pool is in use. A pool has one or more periods (firstDay, lastDay or open, both inclusive,
// business days); a renovation is a gap between two. Every list of a day takes the pools in use that day: the measurement grid, a
// new measurement, a pool tick, a dosing, an animal's placement; so the old data of 2019 is entered with the pools of 2019. A closed
// period takes the place of "inactive": switching a pool off closes its period the day before, on opens one from today. Admin only
// (Lili 14:27 UTC, msg 1566458550266499085). Pool.active follows today's state for what still reads it.
import { z } from "zod";
import { writeAudit } from "./audit";
import { prisma, type Tx } from "./db";
import { AppError } from "./errors";
import { moduleLevel } from "./master";
import type { Role } from "./permissions";
import { addDays, businessDayOf, dateToDay, dayToDate, isValidDay, resolveLocalDateTime } from "./time";

/** The first day of the pools' history (the migration's start, as the feeds'). */
export const POOL_HISTORY_START = "2018-12-07";

export type PoolPeriod = { firstDay: string; lastDay: string | null };

export const poolCovers = (p: PoolPeriod, day: string) => p.firstDay <= day && (p.lastDay === null || day <= p.lastDay);

/** Why a list of periods cannot be saved, or null: a bad day, an end before its start, an overlap. */
export function checkPoolPeriods(periods: PoolPeriod[]): string | null {
  const sorted = [...periods].sort((a, b) => a.firstDay.localeCompare(b.firstDay));
  for (const p of sorted) {
    if (!isValidDay(p.firstDay) || (p.lastDay !== null && !isValidDay(p.lastDay))) return "A dátum érvénytelen.";
    if (p.lastDay !== null && p.lastDay < p.firstDay) return "Egy időszak vége nem lehet a kezdete előtt.";
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    if (prev.lastDay === null || prev.lastDay >= sorted[i].firstDay) return "Az időszakok nem fedhetik egymást.";
  }
  return null;
}

const coveringDay = (d: Date) => ({ firstDay: { lte: d }, OR: [{ lastDay: null }, { lastDay: { gte: d } }] });

/** A Prisma `where` on Pool: in use on the day (its period covers it). */
export function poolInUse(day: string) {
  return { periods: { some: coveringDay(dayToDate(day)) } };
}

/** The ids of the pools in use on a day. */
export async function poolsOn(tx: Tx | typeof prisma, day: string): Promise<Set<string>> {
  const rows = await tx.poolPeriod.findMany({ where: coveringDay(dayToDate(day)), select: { poolId: true } });
  return new Set(rows.map((r) => r.poolId));
}

export async function poolIsOn(tx: Tx | typeof prisma, poolId: string, day: string): Promise<boolean> {
  return (await tx.poolPeriod.count({ where: { poolId, ...coveringDay(dayToDate(day)) } })) > 0;
}

export function poolPeriodView(p: { firstDay: Date; lastDay: Date | null }): PoolPeriod {
  return { firstDay: dateToDay(p.firstDay), lastDay: p.lastDay ? dateToDay(p.lastDay) : null };
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A dátum alakja ÉÉÉÉ-HH-NN.");
export const poolPeriodsSchema = z.object({
  requestId: z.string().min(8).max(100),
  periods: z.array(z.object({ firstDay: day, lastDay: day.nullable() })).max(50),
});

type Actor = { id: string; role: Role };

/** An admin sets a pool's periods (the whole list at once); overlaps refused; the previous list is in the audit entry. */
export async function setPoolPeriods(actor: Actor, poolId: string, input: z.infer<typeof poolPeriodsSchema>) {
  if ((await moduleLevel(prisma, actor.id, actor.role, "SETTINGS")) !== "ADMIN") {
    throw new AppError(403, "ADMIN_ONLY", "A medence használati időszakait csak adminisztrátor állíthatja.");
  }
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  const wrong = checkPoolPeriods(input.periods);
  if (wrong) throw new AppError(422, "BAD_PERIODS", wrong);
  return prisma.$transaction(async (tx) => {
    const pool = await tx.pool.findUnique({ where: { id: poolId }, include: { periods: { orderBy: { firstDay: "asc" } } } });
    if (!pool) throw new AppError(404, "POOL_NOT_FOUND", "A medence nem található.");
    const before = pool.periods.map(poolPeriodView);
    const after = [...input.periods].sort((a, b) => a.firstDay.localeCompare(b.firstDay));
    if (JSON.stringify(before) === JSON.stringify(after)) throw new AppError(422, "NO_CHANGE", "Nincs változás.");
    await tx.poolPeriod.deleteMany({ where: { poolId } });
    for (const p of after) {
      await tx.poolPeriod.create({ data: { poolId, firstDay: dayToDate(p.firstDay), lastDay: p.lastDay ? dayToDate(p.lastDay) : null, createdById: actor.id } });
    }
    const today = businessDayOf(new Date());
    await tx.pool.update({ where: { id: poolId }, data: { active: after.some((p) => poolCovers(p, today)) } });
    const memberships = await groupStartFollowsPeriods(tx, poolId, after[0]?.firstDay ?? null);
    await writeAudit(tx, {
      userId: actor.id,
      action: "MASTER_CHANGE",
      entityType: "Pool",
      entityId: poolId,
      changes: { periods: { before, after }, ...(memberships.length ? { memberships: { before: memberships.map((m) => m.before), after: memberships.map((m) => m.after) } } : {}) },
      requestId: input.requestId,
    });
    return { replayed: false };
  });
}

/**
 * A pool's first membership of each of its groups begins no later than its first period (Lili keys old data in back to 2018;
 * acrobot 40205, B4): a pool added today got its memberships from today, so drawing its period back still left it out of the old
 * days' tables (measured: NOT_IN_GROUP on 2019 after the period was set from 2018-12-07). Only drawn back, never pushed later:
 * a later first period does not cut a membership whose old days may hold measurements.
 */
async function groupStartFollowsPeriods(tx: Tx, poolId: string, firstDay: string | null) {
  if (!firstDay) return [];
  const start = resolveLocalDateTime(`${firstDay}T00:00`)!.instant;
  const all = await tx.groupMembership.findMany({ where: { poolId }, orderBy: { validFrom: "asc" } });
  const moved: { before: string; after: string }[] = [];
  for (const groupId of new Set(all.map((m) => m.groupId))) {
    const earliest = all.find((m) => m.groupId === groupId)!;
    if (earliest.validFrom <= start) continue;
    await tx.groupMembership.update({ where: { id: earliest.id }, data: { validFrom: start } });
    moved.push({ before: `${groupId}:${earliest.validFrom.toISOString()}`, after: `${groupId}:${start.toISOString()}` });
  }
  return moved;
}

/** The old switch (Beállítások > Medencék, Inaktiválás / Aktiválás): off closes today's period on the day before, on opens one from today. */
export async function switchPool(tx: Tx, poolId: string, on: boolean, actorId: string, now = new Date()) {
  const today = businessDayOf(now);
  const t = dayToDate(today);
  const open = await tx.poolPeriod.findFirst({ where: { poolId, ...coveringDay(t) } });
  if (on) {
    if (open) return;
    const next = await tx.poolPeriod.findFirst({ where: { poolId, firstDay: { gt: t } }, orderBy: { firstDay: "asc" } });
    if (next) await tx.poolPeriod.update({ where: { id: next.id }, data: { firstDay: t } });
    else await tx.poolPeriod.create({ data: { poolId, firstDay: t, lastDay: null, createdById: actorId } });
    return;
  }
  if (!open) return;
  if (open.firstDay.getTime() >= t.getTime()) await tx.poolPeriod.delete({ where: { id: open.id } });
  else await tx.poolPeriod.update({ where: { id: open.id }, data: { lastDay: dayToDate(addDays(today, -1)) } });
}
