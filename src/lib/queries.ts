// Read models for the pages: the measurement grid, the log and a measurement's history.

import type { Prisma, RecordStatus } from "@prisma/client";
import { prisma } from "./db";
import { canonicalDecimal } from "./decimal";
import { takesDilution } from "./dilution";
import { groupLayout, monogramResolver, pickValid } from "./master";
import { tickKindsOf, ticksOfDay } from "./pool-ticks";
import { evaluateReference, type ReferenceStatus } from "./reference";
import { businessDayOf, dateToDay, dayToDate, localDateTimeOf, localTimeOf } from "./time";

export type RangeView = { min: string | null; max: string | null; unitSymbol: string };

export type CellView = {
  id: string;
  value: string;
  version: number;
  measuredAt: string;
  localTime: string;
  createdById: string;
  responsibleMonogram: string;
  reference: ReferenceStatus;
  range: RangeView | null;
  dilution: number | null;
  diluentWater: "RO" | "SW" | null;
};

function rangeView(r: { min: Prisma.Decimal | null; max: Prisma.Decimal | null; unit: { symbol: string } } | null): RangeView | null {
  if (!r) return null;
  return {
    min: r.min === null ? null : canonicalDecimal(r.min),
    max: r.max === null ? null : canonicalDecimal(r.max),
    unitSymbol: r.unit.symbol,
  };
}

type MeasurementWithRefs = Prisma.MeasurementGetPayload<{
  include: { unit: true; referenceRange: { include: { unit: true } } };
}>;

export function referenceOf(m: MeasurementWithRefs): ReferenceStatus {
  const value = canonicalDecimal(m.value);
  const unit = { id: m.unit.id, dimension: m.unit.dimension, factorToBase: m.unit.factorToBase?.toString() ?? null };
  const r = m.referenceRange;
  return evaluateReference(
    value,
    unit,
    r
      ? {
          min: r.min === null ? null : canonicalDecimal(r.min),
          max: r.max === null ? null : canonicalDecimal(r.max),
          unit: { id: r.unit.id, dimension: r.unit.dimension, factorToBase: r.unit.factorToBase?.toString() ?? null },
        }
      : null,
  );
}

export async function listGroups() {
  return prisma.measurementGroup.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
}

/**
 * The grid of one round of a group on a day, plus the round list and the daily view
 * (latest valid measurement per cell across rounds, adatmodell 4. terület "Napi nézet").
 */
export async function getGrid(groupId: string, day: string, roundSeq?: number) {
  const group = await prisma.measurementGroup.findUnique({ where: { id: groupId } });
  if (!group) return null;
  // The layout of a day is taken at its noon: membership changes are rare and dated.
  const at = new Date(`${day}T12:00:00.000Z`);
  const layout = await groupLayout(prisma, groupId, at);
  const businessDay = dayToDate(day);
  const rounds = await prisma.measurementRound.findMany({ where: { groupId, businessDay }, orderBy: { seq: "asc" } });
  const selected = roundSeq ? rounds.find((r) => r.seq === roundSeq) : rounds[rounds.length - 1];

  const all = await prisma.measurement.findMany({
    where: { round: { groupId, businessDay }, status: "VALID" },
    include: { unit: true, referenceRange: { include: { unit: true } } },
    orderBy: [{ measuredAt: "asc" }, { createdAt: "asc" }],
  });
  const mono = await monogramResolver(all.map((m) => m.responsibleUserId));
  const toCell = (m: MeasurementWithRefs): CellView => ({
    id: m.id,
    value: canonicalDecimal(m.value),
    version: m.version,
    measuredAt: m.measuredAt.toISOString(),
    localTime: localTimeOf(m.measuredAt),
    createdById: m.createdById,
    responsibleMonogram: mono.monogram(m.responsibleUserId, m.measuredAt),
    reference: referenceOf(m),
    range: rangeView(m.referenceRange),
    dilution: m.dilution,
    diluentWater: m.diluentWater,
  });

  // an inactive pool (a renovation) stays on the earlier days it has a measurement, read only; on the others, and today
  // even if it was measured before it went off, it is off the grid (Lili 2026-10-29, acrobot 37943: it disappears from
  // the users' pages, its past stays in the earlier days and the exports)
  const measuredPools = new Set(all.map((m) => m.poolId));
  const isToday = day === businessDayOf(new Date());
  layout.pools = layout.pools.filter((p) => p.active || (!isToday && measuredPools.has(p.id)));

  const cells: Record<string, CellView> = {};
  const daily: Record<string, CellView> = {};
  for (const m of all) {
    const key = `${m.poolId}:${m.parameterId}`;
    if (selected && m.roundId === selected.id) cells[key] = toCell(m);
    // ascending order: the last one wins = latest measuredAt, ties by later creation
    daily[key] = toCell(m);
  }
  // Ranges valid now, to show next to empty cells as a hint: per pool, the pool's own or else the common one
  const now = new Date();
  const ranges = await prisma.referenceRange.findMany({
    where: {
      parameterId: { in: layout.parameters.map((p) => p.id) },
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
    },
    include: { unit: true },
  });
  const currentRanges: Record<string, RangeView | null> = {};
  for (const pool of layout.pools) {
    for (const p of layout.parameters) {
      const own = ranges.find((r) => r.parameterId === p.id && r.poolId === pool.id);
      currentRanges[`${pool.id}:${p.id}`] = rangeView(own ?? ranges.find((r) => r.parameterId === p.id && r.poolId === null) ?? null);
    }
  }

  return {
    group: { id: group.id, name: group.name, frequency: group.frequency },
    day,
    // the pool ticks of the day (item 8 of Lili's package): the kinds this group offers, and which are on
    tickKinds: tickKindsOf(group.code),
    ticks: await ticksOfDay(day),
    layout,
    rounds: rounds.map((r) => ({ id: r.id, seq: r.seq })),
    selectedRound: selected ? { id: selected.id, seq: selected.seq } : null,
    cells,
    daily,
    currentRanges,
  };
}

export type LogFilter = {
  from: string;
  to: string;
  poolId?: string;
  groupId?: string;
  status?: RecordStatus | "ALL";
  page?: number;
};

export const LOG_PAGE_SIZE = 100;

export async function searchLog(f: LogFilter) {
  const where: Prisma.MeasurementWhereInput = {
    businessDay: { gte: dayToDate(f.from), lte: dayToDate(f.to) },
    ...(f.poolId ? { poolId: f.poolId } : {}),
    ...(f.groupId ? { round: { groupId: f.groupId } } : {}),
    ...(f.status && f.status !== "ALL" ? { status: f.status } : {}),
  };
  const page = Math.max(1, f.page ?? 1);
  const [total, rows] = await Promise.all([
    prisma.measurement.count({ where }),
    prisma.measurement.findMany({
      where,
      include: {
        unit: true,
        referenceRange: { include: { unit: true } },
        round: { include: { group: true } },
        pool: { include: { names: true } },
        parameter: { include: { names: true } },
      },
      orderBy: [{ measuredAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * LOG_PAGE_SIZE,
      take: LOG_PAGE_SIZE,
    }),
  ]);
  const mono = await monogramResolver(rows.flatMap((m) => [m.responsibleUserId, m.createdById]));
  return {
    total,
    page,
    pageSize: LOG_PAGE_SIZE,
    rows: rows.map((m) => ({
      id: m.id,
      businessDay: dateToDay(m.businessDay),
      localTime: localTimeOf(m.measuredAt),
      poolName: pickValid(m.pool.names, m.measuredAt)?.displayName ?? m.pool.code,
      parameterName: pickValid(m.parameter.names, m.measuredAt)?.displayName ?? m.parameter.code,
      groupName: m.round.group.name,
      roundSeq: m.round.seq,
      value: canonicalDecimal(m.value),
      decimals: m.parameter.decimals,
      unitSymbol: m.unit.symbol,
      reference: referenceOf(m),
      range: rangeView(m.referenceRange),
      responsibleMonogram: mono.monogram(m.responsibleUserId, m.measuredAt),
      recordedByMonogram: mono.monogram(m.createdById, m.createdAt),
      traineePerformed: m.traineePerformed,
      dilution: m.dilution,
      diluentWater: m.diluentWater,
      status: m.status,
      invalidationReason: m.invalidationReason,
      version: m.version,
    })),
  };
}

const ACTION_LABEL: Record<string, string> = {
  CREATE: "Rögzítés",
  UPDATE: "Módosítás",
  INVALIDATE: "Érvénytelenítés",
  CONFLICT_REJECTED: "Ütközés: elutasított mentés",
  PENDING_CREATED: "Késve érkezett mentés (függő)",
  PENDING_APPROVED: "Függő mentés jóváhagyva",
  PENDING_REJECTED: "Függő mentés elutasítva",
};

export async function measurementHistory(id: string) {
  const m = await prisma.measurement.findUnique({
    where: { id },
    include: {
      unit: true,
      referenceRange: { include: { unit: true } },
      round: { include: { group: true } },
      pool: { include: { names: true } },
      parameter: { include: { names: true } },
    },
  });
  if (!m) return null;
  const entries = await prisma.auditEntry.findMany({
    where: { entityType: "Measurement", entityId: id },
    orderBy: { id: "asc" },
  });
  const responsibleIds = entries.flatMap((e) => {
    const c = (e.changes as Record<string, { before: unknown; after: unknown }>).responsibleUserId;
    return c ? [c.before, c.after].filter((v): v is string => typeof v === "string") : [];
  });
  const mono = await monogramResolver([...entries.map((e) => e.userId), m.responsibleUserId, m.createdById, ...responsibleIds]);
  return {
    measurement: {
      id: m.id,
      businessDay: dateToDay(m.businessDay),
      localTime: localTimeOf(m.measuredAt),
      poolName: pickValid(m.pool.names, m.measuredAt)?.displayName ?? m.pool.code,
      parameterName: pickValid(m.parameter.names, m.measuredAt)?.displayName ?? m.parameter.code,
      groupName: m.round.group.name,
      roundSeq: m.round.seq,
      value: canonicalDecimal(m.value),
      decimals: m.parameter.decimals,
      unitSymbol: m.unit.symbol,
      reference: referenceOf(m),
      range: rangeView(m.referenceRange),
      status: m.status,
      invalidationReason: m.invalidationReason,
      version: m.version,
      responsibleMonogram: mono.monogram(m.responsibleUserId, m.measuredAt),
      createdByName: mono.name(m.createdById),
      createdById: m.createdById,
      groupId: m.round.groupId,
      dilutable: m.round.group.frequency === "WEEKLY" && takesDilution(m.parameter.code),
      measuredAtLocal: localDateTimeOf(m.measuredAt),
      responsibleUserId: m.responsibleUserId,
      traineePerformed: m.traineePerformed,
      dilution: m.dilution,
      diluentWater: m.diluentWater,
    },
    entries: entries.map((e) => ({
      id: e.id.toString(),
      at: e.at.toISOString(),
      localDay: businessDayOf(e.at),
      localTime: localTimeOf(e.at),
      action: e.action,
      actionLabel: ACTION_LABEL[e.action] ?? e.action,
      userName: mono.name(e.userId),
      userMonogram: mono.monogram(e.userId, e.at),
      reason: e.reason,
      changes: Object.fromEntries(
        Object.entries(e.changes as Record<string, { before: unknown; after: unknown }>).map(([k, c]) =>
          k === "responsibleUserId"
            ? [k, { before: typeof c.before === "string" ? mono.name(c.before) : c.before, after: typeof c.after === "string" ? mono.name(c.after) : c.after }]
            : [k, c],
        ),
      ),
    })),
  };
}
