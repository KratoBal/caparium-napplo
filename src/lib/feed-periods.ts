// Lili 2026-11-01 (point 14): the days a feed is fed. A feed has one or more periods (firstDay, lastDay or open, both inclusive,
// business days); every list of a day offers the feeds whose period covers that day, so the old data of 2019 is entered with the
// feeds of 2019. A closed period takes the place of "inactive": switching a feed off closes its period the day before, switching it
// on opens one from today. Admin only (Lili 14:27 UTC, msg 1566458550266499085).
import { z } from "zod";
import { writeAudit } from "./audit";
import { prisma, type Tx } from "./db";
import { AppError } from "./errors";
import { FEED_HISTORY_START } from "./feed-history";
import { moduleLevel } from "./master";
import type { Role } from "./permissions";
import { addDays, businessDayOf, dateToDay, dayToDate, isValidDay } from "./time";

export { FEED_HISTORY_START };

export type Period = { firstDay: string; lastDay: string | null };

export const covers = (p: Period, day: string) => p.firstDay <= day && (p.lastDay === null || day <= p.lastDay);

/** The periods of a feed in order; null when they overlap or a later one starts before an open one ends (refused on save). */
export function checkPeriods(periods: Period[]): string | null {
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

/** The ids of the feeds fed on a day. */
export async function feedsOn(tx: Tx | typeof prisma, day: string): Promise<Set<string>> {
  const d = dayToDate(day);
  const rows = await tx.feedPeriod.findMany({ where: { firstDay: { lte: d }, OR: [{ lastDay: null }, { lastDay: { gte: d } }] }, select: { feedId: true } });
  return new Set(rows.map((r) => r.feedId));
}

export async function feedIsOn(tx: Tx | typeof prisma, feedId: string, day: string): Promise<boolean> {
  const d = dayToDate(day);
  return (await tx.feedPeriod.count({ where: { feedId, firstDay: { lte: d }, OR: [{ lastDay: null }, { lastDay: { gte: d } }] } })) > 0;
}

export function periodView(p: { firstDay: Date; lastDay: Date | null }): Period {
  return { firstDay: dateToDay(p.firstDay), lastDay: p.lastDay ? dateToDay(p.lastDay) : null };
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A dátum alakja ÉÉÉÉ-HH-NN.");
export const feedPeriodsSchema = z.object({
  requestId: z.string().min(8).max(100),
  periods: z.array(z.object({ firstDay: day, lastDay: day.nullable() })).max(50),
});

type Actor = { id: string; role: Role };

/**
 * An admin sets a feed's periods (the whole list: added, moved and removed ones at once). Refused when they overlap. A feed may
 * have none (it is offered on no day), its recorded items stay. The previous list is in the audit entry.
 */
export async function setFeedPeriods(actor: Actor, feedId: string, input: z.infer<typeof feedPeriodsSchema>) {
  if ((await moduleLevel(prisma, actor.id, actor.role, "SETTINGS")) !== "ADMIN") {
    throw new AppError(403, "ADMIN_ONLY", "A takarmány etetési időszakait csak adminisztrátor állíthatja.");
  }
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  const wrong = checkPeriods(input.periods);
  if (wrong) throw new AppError(422, "BAD_PERIODS", wrong);
  return prisma.$transaction(async (tx) => {
    const feed = await tx.feed.findUnique({ where: { id: feedId }, include: { periods: { orderBy: { firstDay: "asc" } } } });
    if (!feed) throw new AppError(404, "NOT_FOUND", "A takarmány nem található.");
    const before = feed.periods.map(periodView);
    const after = [...input.periods].sort((a, b) => a.firstDay.localeCompare(b.firstDay));
    if (JSON.stringify(before) === JSON.stringify(after)) throw new AppError(422, "NO_CHANGE", "Nincs változás.");
    await tx.feedPeriod.deleteMany({ where: { feedId } });
    for (const p of after) {
      await tx.feedPeriod.create({ data: { feedId, firstDay: dayToDate(p.firstDay), lastDay: p.lastDay ? dayToDate(p.lastDay) : null, createdById: actor.id } });
    }
    // the old flag follows today's state, for anything that still reads it
    const today = businessDayOf(new Date());
    await tx.feed.update({ where: { id: feedId }, data: { active: after.some((p) => covers(p, today)) } });
    await writeAudit(tx, {
      userId: actor.id,
      action: "MASTER_CHANGE",
      entityType: "Feed",
      entityId: feedId,
      changes: { periods: { before, after } },
      requestId: input.requestId,
    });
    return { replayed: false };
  });
}

/**
 * The old switch, kept (the feed list's Inaktiválás / Aktiválás, the copies' clean-up): off closes the period that covers today on
 * the day before, so today the feed is not offered; on opens a period from today. Inside the caller's transaction.
 */
export async function switchFeed(tx: Tx, feedId: string, on: boolean, actorId: string, now = new Date()) {
  const today = businessDayOf(now);
  const t = dayToDate(today);
  const open = await tx.feedPeriod.findFirst({ where: { feedId, firstDay: { lte: t }, OR: [{ lastDay: null }, { lastDay: { gte: t } }] } });
  if (on) {
    if (open) return;
    // a later period that already starts: it begins today instead
    const next = await tx.feedPeriod.findFirst({ where: { feedId, firstDay: { gt: t } }, orderBy: { firstDay: "asc" } });
    if (next) await tx.feedPeriod.update({ where: { id: next.id }, data: { firstDay: t } });
    else await tx.feedPeriod.create({ data: { feedId, firstDay: t, lastDay: null, createdById: actorId } });
    return;
  }
  if (!open) return;
  const yesterday = dayToDate(addDays(today, -1));
  // a period that began today is gone altogether; any other ends yesterday
  if (open.firstDay.getTime() >= t.getTime()) await tx.feedPeriod.delete({ where: { id: open.id } });
  else await tx.feedPeriod.update({ where: { id: open.id }, data: { lastDay: yesterday } });
}
