// "Vízmérés kiküldése" (caparium-hibak-4, item 13; Balázs 2026-10-20 09:45 UTC, msg 1562038983637209189): today's and
// this week's water measurement results, by pool, as a PDF in an e-mail to the address set in Beállítások.
// This file reads the data; the PDF is src/lib/water-report-pdf.ts, the sending src/lib/mail.ts.
//
// What goes in, per pool:
// - today's DAILY values: every valid measurement of today in a daily group, the latest per parameter (a later
//   round of the day wins, as in the grid);
// - this week's WEEKLY values: the latest valid measurement per parameter in a weekly group from Monday to today
//   (the weekly measurement may be done on any day of the week), with its day, dilution and RO/SW.
import type { PoolTickKind } from "@prisma/client";
import { prisma } from "./db";
import { canonicalDecimal } from "./decimal";
import { dayBounds } from "./feeding";
import { monogramResolver, pickValid } from "./master";
import { TICK_ORDER } from "./pool-ticks";
import { referenceOf } from "./queries";
import type { ReferenceStatus } from "./reference";
import { addDays, dateToDay, dayToDate, localTimeOf } from "./time";

export type ReportValue = {
  parameter: string;
  value: string;
  unit: string;
  day: string;
  time: string;
  by: string;
  reference: ReferenceStatus;
  /**
   * The range the value was judged against (Lili 2026-10-26, msg 1564363895722737696): the one stored with the measurement,
   * which referenceAt picked as the POOL's own range if it has one, else the common one. null = no range.
   */
  range: { min: string | null; max: string | null; unit: string } | null;
  dilution: number | null;
  diluentWater: string | null;
};
/** `ticks`: the pool ticks of the report's day, in the fixed order (Lili 2026-10-29, item 8; PoolTickKind values). */
export type PoolReport = { pool: string; daily: ReportValue[]; weekly: ReportValue[]; ticks: PoolTickKind[] };
export type WaterReport = { day: string; weekFrom: string; pools: PoolReport[] };

/** Monday of the week of a business day ("YYYY-MM-DD"). */
export function weekStart(day: string): string {
  const dow = dayToDate(day).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

export async function waterReport(day: string): Promise<WaterReport> {
  const weekFrom = weekStart(day);
  const rows = await prisma.measurement.findMany({
    where: {
      status: "VALID",
      businessDay: { gte: dayToDate(weekFrom), lte: dayToDate(day) },
    },
    include: {
      unit: true,
      referenceRange: { include: { unit: true } },
      pool: { include: { names: true } },
      parameter: { include: { names: true } },
      round: { include: { group: true } },
    },
    orderBy: [{ measuredAt: "asc" }, { createdAt: "asc" }],
  });
  const mono = await monogramResolver(rows.map((m) => m.responsibleUserId));
  const at = dayBounds(day).end;
  type Key = string;
  const daily = new Map<Key, (typeof rows)[number]>();
  const weekly = new Map<Key, (typeof rows)[number]>();
  for (const m of rows) {
    const key = `${m.poolId}:${m.parameterId}`;
    // ascending: the last one wins = the latest of the day (daily) or of the week (weekly)
    if (m.round.group.frequency === "WEEKLY") weekly.set(key, m);
    else if (dateToDay(m.businessDay) === day) daily.set(key, m);
  }
  const view = (m: (typeof rows)[number]): ReportValue => ({
    parameter: pickValid(m.parameter.names, at)?.displayName ?? m.parameter.code,
    value: canonicalDecimal(m.value),
    unit: m.unit.symbol,
    day: dateToDay(m.businessDay),
    time: localTimeOf(m.measuredAt),
    by: mono.monogram(m.responsibleUserId, m.measuredAt),
    reference: referenceOf(m),
    range: m.referenceRange
      ? {
          min: m.referenceRange.min === null ? null : canonicalDecimal(m.referenceRange.min),
          max: m.referenceRange.max === null ? null : canonicalDecimal(m.referenceRange.max),
          unit: m.referenceRange.unit.symbol,
        }
      : null,
    dilution: m.dilution,
    diluentWater: m.diluentWater,
  });
  // the pools in their fixed order (Lili 2026-10-26, msg 1564418747047874581); one without a number (made before the order existed, or
  // by hand) comes after the numbered ones, in the order it was created (acrobot 2026-10-27 01:41), not by its code
  // an inactive pool (a renovation) is in the report of the days it was measured on, and only those
  const measured = new Set(rows.map((m) => m.poolId));
  const pools = (await prisma.pool.findMany({
    include: { names: true },
    orderBy: [{ sortOrder: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { code: "asc" }],
  })).filter((p) => p.active || measured.has(p.id));
  const tickRows = await prisma.poolTick.findMany({ where: { businessDay: dayToDate(day) } });
  const sortOf = new Map(rows.map((m) => [m.parameterId, m.parameter.sortOrder]));
  const ordered = (list: (typeof rows)[number][]) => list.sort((a, b) => (sortOf.get(a.parameterId) ?? 0) - (sortOf.get(b.parameterId) ?? 0)).map(view);
  return {
    day,
    weekFrom,
    pools: pools
      .map((p) => ({
        pool: pickValid(p.names, at)?.displayName ?? p.code,
        daily: ordered([...daily.values()].filter((m) => m.poolId === p.id)),
        weekly: ordered([...weekly.values()].filter((m) => m.poolId === p.id)),
        ticks: TICK_ORDER.filter((kind) => tickRows.some((t) => t.poolId === p.id && t.kind === kind)),
      }))
      // a pool with nothing measured this week is left out: the report is about results
      .filter((p) => p.daily.length > 0 || p.weekly.length > 0),
  };
}
