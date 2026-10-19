// The feeding log on screen (TAK-04; Notes N7: period, pool, animal, "Evési minta"). Read only: the
// items of a period, filtered by pool and animal, with totals per base unit, and the eating pattern of
// the same animals. A group item counts for an animal it was given to (its participant snapshot, R-8),
// and for a pool if any participant was there that day. Names are the ones valid on the day (K3).

import { prisma } from "./db";
import { AppError } from "./errors";
import { dayBounds } from "./feeding";
import { pickValid } from "./master";
import { addDays, dateToDay, dayToDate } from "./time";

export const LOG_MAX_DAYS = 92; // a screen, not an export: about a quarter

export type LogFilter = { from: string; to: string; poolId: string | null; animalId: string | null };

export type LogRow = {
  id: string;
  day: string;
  recipient: string;
  pools: string;
  feed: string;
  quantities: string;
};

export async function feedingLog(f: LogFilter) {
  if (f.from > f.to) throw new AppError(422, "BAD_PERIOD", "Az időszak vége nem lehet a kezdete előtt.");
  const days: string[] = [];
  for (let d = f.from; d <= f.to; d = addDays(d, 1)) {
    days.push(d);
    if (days.length > LOG_MAX_DAYS) throw new AppError(422, "PERIOD_TOO_LONG", `A naplóban legfeljebb ${LOG_MAX_DAYS} nap kérhető le egyszerre; hosszabb időszakra az Excel való.`);
  }
  const range = { gte: dayToDate(f.from), lte: dayToDate(f.to) };
  const [items, statuses, baseUnits, placements] = await Promise.all([
    prisma.feedingItem.findMany({
      where: { status: "VALID", feedingDay: { businessDay: range } },
      include: {
        feedingDay: true,
        quantities: { include: { unit: true } },
        feed: { include: { names: true } },
        animal: { include: { names: true } },
        group: { include: { names: true } },
        participants: true,
      },
      orderBy: [{ feedingDay: { businessDay: "asc" } }, { createdAt: "asc" }],
    }),
    prisma.eatingStatus.findMany({ where: { status: "VALID", feedingDay: { businessDay: range } }, include: { feedingDay: true } }),
    prisma.unit.findMany({ where: { isBase: true } }),
    prisma.placement.findMany({ include: { pool: { include: { names: true } } }, orderBy: { validFrom: "asc" } }),
  ]);
  const baseOf = new Map(baseUnits.map((u) => [u.dimension, u.symbol]));

  // where each animal was on a day (the placement valid at the day's start, or the first one that day)
  const poolOn = (animalId: string, day: string) => {
    const { start, end } = dayBounds(day);
    const p = placements.find((x) => x.animalId === animalId && x.validFrom < end && (!x.validTo || x.validTo > start));
    return p ? { id: p.poolId, name: pickValid(p.pool.names, start)?.displayName ?? p.pool.code } : null;
  };

  const rows: LogRow[] = [];
  // R-8 invents no split of a group item: under a filter its whole amount is shown apart, so an
  // animal's (or a pool's) total never reads as if it ate the group's food alone (review of #11)
  const totals: Record<string, number> = {};
  const own: Record<string, number> = {};
  const group: Record<string, number> = {};
  for (const it of items) {
    const day = dateToDay(it.feedingDay.businessDay);
    const at = dayBounds(day).start;
    const members = it.animalId ? [it.animalId] : it.participants.map((p) => p.animalId);
    if (f.animalId && !members.includes(f.animalId)) continue;
    const pools = members.map((m) => poolOn(m, day)).filter((p): p is { id: string; name: string } => p !== null);
    if (f.poolId && !pools.some((p) => p.id === f.poolId)) continue;
    for (const q of it.quantities) {
      const base = baseOf.get(q.unit.dimension) ?? q.unit.symbol;
      const v = Number(q.quantity) * Number(q.unit.factorToBase ?? 1);
      totals[base] = (totals[base] ?? 0) + v;
      const part = it.animalId ? own : group;
      part[base] = (part[base] ?? 0) + v;
    }
    const feed = pickValid(it.feed.names, at)?.name ?? it.feed.names.at(-1)?.name ?? "?";
    rows.push({
      id: it.id,
      day,
      recipient: it.animal
        ? pickValid(it.animal.names, at)?.name ?? "?"
        : `${pickValid(it.group!.names, at)?.name ?? "?"} (csoport)`,
      pools: [...new Set(pools.map((p) => p.name))].join(", "),
      feed: it.otherName ? `${feed}: ${it.otherName}` : feed,
      quantities: it.quantities.map((q) => `${Number(q.quantity).toString().replace(".", ",")} ${q.unit.symbol}`).join(" + "),
    });
  }

  // the eating pattern of the same filter: one row per animal, one cell per day
  const animalIds = new Set<string>();
  for (const s of statuses) {
    const day = dateToDay(s.feedingDay.businessDay);
    if (f.animalId && s.animalId !== f.animalId) continue;
    if (f.poolId && poolOn(s.animalId, day)?.id !== f.poolId) continue;
    animalIds.add(s.animalId);
  }
  const names = await prisma.animalName.findMany({ where: { animalId: { in: [...animalIds] } } });
  const end = dayBounds(f.to).end;
  const pattern = [...animalIds]
    .map((id) => {
      const own = names.filter((n) => n.animalId === id);
      const cells = Object.fromEntries(
        statuses
          .filter((s) => s.animalId === id)
          .map((s) => [dateToDay(s.feedingDay.businessDay), { state: s.state, vitamin: s.vitamin, medicine: s.medicine }]),
      );
      return { id, name: pickValid(own, new Date(end.getTime() - 1))?.name ?? own.at(-1)?.name ?? "?", cells };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "hu"));

  return { days, rows, totals, own, group, filtered: f.animalId !== null || f.poolId !== null, pattern };
}
