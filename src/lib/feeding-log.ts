// The feeding log on screen (TAK-04; Notes N7: period, pool, animal, "Evési minta"). Read only: the
// items of a period, filtered by pool and animal, with totals per base unit, and the eating pattern of
// the same animals. A group item counts for an animal it was given to (its participant snapshot, R-8),
// and for a pool if any participant was there that day. Names are the ones valid on the day (K3).

import { compareAnimals } from "./animal-order";
import { prisma } from "./db";
import { GIVEN } from "./eating-labels";
import { AppError } from "./errors";
import { isDerivedFasting, listFacts } from "./eating-pattern";
import { dayBounds } from "./feeding";
import { nameAt, pickValid } from "./master";
import { addDays, businessDayOf, dateToDay, dayToDate } from "./time";

export const LOG_MAX_DAYS = 92; // a screen, not an export: about a quarter

export type LogFilter = { from: string; to: string; poolId: string | null; animalId: string | null };

/** One quantity of one item, in the base unit of its dimension: what the reports add up (EGY-13). */
export type LogEntry = { day: string; recipient: string; feed: string; unit: string; value: number; group: boolean };

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
  const [items, statuses, baseUnits, placements, events, selected] = await Promise.all([
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
    prisma.lifecycleEvent.findMany({ where: { status: "VALID" }, select: { animalId: true, type: true, occurredAt: true } }),
    listFacts(f.from, f.to),
  ]);
  const baseOf = new Map(baseUnits.map((u) => [u.dimension, u.symbol]));

  // where each animal was on a day (the placement valid at the day's start, or the first one that day)
  const poolOn = (animalId: string, day: string) => {
    const { start, end } = dayBounds(day);
    const p = placements.find((x) => x.animalId === animalId && x.validFrom < end && (!x.validTo || x.validTo > start));
    return p ? { id: p.poolId, name: pickValid(p.pool.names, start)?.displayName ?? p.pool.code } : null;
  };

  const rows: LogRow[] = [];
  const entries: LogEntry[] = [];
  // the admin's position of each recipient (null: a group, or never placed), for the order of the rows and the reports
  const recipientOrder = new Map<string, number | null>();
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
    const recipient = it.animal ? nameAt(it.animal.names, at)?.name ?? "?" : `${nameAt(it.group!.names, at)?.name ?? "?"} (csoport)`;
    recipientOrder.set(recipient, it.animal ? it.animal.sortOrder : null);
    for (const q of it.quantities) {
      entries.push({
        day,
        recipient,
        feed: it.otherName ? `${feed}: ${it.otherName}` : feed,
        unit: baseOf.get(q.unit.dimension) ?? q.unit.symbol,
        value: Number(q.quantity) * Number(q.unit.factorToBase ?? 1),
        group: !it.animalId,
      });
    }
    rows.push({
      id: it.id,
      day,
      recipient: it.animal
        ? nameAt(it.animal.names, at)?.name ?? "?"
        : `${nameAt(it.group!.names, at)?.name ?? "?"} (csoport)`,
      pools: [...new Set(pools.map((p) => p.name))].join(", "),
      feed: it.otherName ? `${feed}: ${it.otherName}` : feed,
      quantities: it.quantities.map((q) => `${Number(q.quantity).toString().replace(".", ",")} ${q.unit.symbol}`).join(" + ") || GIVEN,
    });
  }

  // within a day the rows follow the animals' order (Lili 2026-10-26, msg 1564402506396598303), the items of one recipient in the
  // order they were given (the sort is stable, the rows came in by day and time); a group, with no position, follows by name
  const orderOf = (recipient: string) => ({ name: recipient, sortOrder: recipientOrder.get(recipient) ?? null });
  rows.sort((a, b) => a.day.localeCompare(b.day) || compareAnimals(orderOf(a.recipient), orderOf(b.recipient)));

  // the eating pattern of the same filter: one row per animal, one cell per day. A day the animal lived without a
  // stored status is a fasting day when it was not on the day's list (DN-03, eating-pattern.ts), as in the Excel
  const animalIds = new Set<string>();
  const inFilter = (animalId: string, day: string) =>
    (!f.animalId || animalId === f.animalId) && (!f.poolId || poolOn(animalId, day)?.id === f.poolId);
  for (const s of statuses) {
    const day = dateToDay(s.feedingDay.businessDay);
    if (inFilter(s.animalId, day)) animalIds.add(s.animalId);
  }
  const life = new Map<string, { arrived?: Date; ended?: Date }>();
  for (const e of events) {
    const r = life.get(e.animalId) ?? {};
    if (e.type === "ARRIVAL") r.arrived = e.occurredAt;
    if (e.type === "DEATH" || e.type === "RELEASE") r.ended = e.occurredAt;
    life.set(e.animalId, r);
  }
  const lived = (animalId: string, day: string) => {
    const r = life.get(animalId);
    const b = dayBounds(day);
    return !!r?.arrived && r.arrived < b.end && (!r.ended || r.ended >= b.start);
  };
  const stored = new Set(statuses.map((s) => `${s.animalId}|${dateToDay(s.feedingDay.businessDay)}`));
  const today = businessDayOf(new Date());
  const derived = new Map<string, string[]>();
  for (const animalId of life.keys())
    for (const day of days)
      if (lived(animalId, day) && !stored.has(`${animalId}|${day}`) && isDerivedFasting(selected, animalId, day, today) && inFilter(animalId, day)) {
        animalIds.add(animalId);
        derived.set(animalId, [...(derived.get(animalId) ?? []), day]);
      }
  const names = await prisma.animalName.findMany({ where: { animalId: { in: [...animalIds] } } });
  const placedAt = new Map((await prisma.animal.findMany({ where: { id: { in: [...animalIds] } }, select: { id: true, sortOrder: true } })).map((a) => [a.id, a.sortOrder]));
  const end = dayBounds(f.to).end;
  const pattern = [...animalIds]
    .map((id) => {
      const own = names.filter((n) => n.animalId === id);
      const cells = Object.fromEntries([
        ...(derived.get(id) ?? []).map((day) => [day, { state: "FASTING", vitamin: false, medicine: false }] as const),
        ...statuses
          .filter((s) => s.animalId === id)
          .map((s) => [dateToDay(s.feedingDay.businessDay), { state: s.state as string, vitamin: s.vitamin, medicine: s.medicine }] as const),
      ]);
      return { id, name: pickValid(own, new Date(end.getTime() - 1))?.name ?? own.at(-1)?.name ?? "?", sortOrder: placedAt.get(id) ?? null, cells };
    })
    .sort(compareAnimals);

  return { days, rows, entries, totals, own, group, filtered: f.animalId !== null || f.poolId !== null, pattern, recipientOrder };
}
