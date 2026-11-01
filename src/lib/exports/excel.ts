// Water measurement Excel export (VIZ-10, VIZ-11, VIZ-21, ÁLT-10, T-05).
// The customer's template "Vizmeres_template_napplo.xlsx": a summary sheet "Vízmérés teljes" and one
// sheet per system, each with the same header row. T-05: the template's 8 columns plus "Hígítás" and
// "RO/SW". Every valid measurement is a row (repeated measurements included, VIZ-23); names,
// monograms and units are the ones valid at the measurement time (K3, K4), so an old period
// exports its old state.

import ExcelJS from "exceljs";
import { prisma } from "../db";
import { canonicalDecimal } from "../decimal";
import { nameAt, pickValid } from "../master";
import { TICK_LABEL, TICK_ORDER } from "../pool-ticks";
import { evaluateReference } from "../reference";
import { BUSINESS_TZ, dateToDay, dayToDate, formatDay, resolveLocalDateTime, wallClock } from "../time";

// letter by letter from the template's header row (forras-kivonat/vizmeres-template-fejlecek.json)
export const TEMPLATE_HEADER = ["Dátum", "Idő", "Akvárium", "Vízparaméter", "Mérés", "Mértékegység", "Mérést végezte", "Gyakornok"];
// Lili 2026-11-01 22:35 UTC: the dilution is a factor now; the value before it stands beside it (the ZIMS takes the result only)
export const EXTRA_HEADER = ["Hígítás", "RO/SW", "Hígítás előtti érték"];
// Lili 2026-10-29 (task caparium-lili-nagyobb-m, item 8): after the last column, one column per pool tick; "volt" where it
// was ticked. A plain Excel fact, not part of the ZIMS export. On the FIRST row of the pool and the day, once.
export const TICK_HEADER = TICK_ORDER.map((k) => TICK_LABEL[k]);
export const SUMMARY_SHEET = "Vízmérés teljes";

const RED = "FFDF5B5B";
// Lili 2026-11-01 (point 1): a coloured header on every sheet, and the rows' colour changing week by week (Monday starts a week)
export const WATER_HEAD_FILL = "FFA6CAEC";
export const WATER_WEEK_FILLS = [null, "FFE3EEF8"] as const;

/** The week band of a measurement day: the period's first week has none, the next one the pale blue, and so on. */
export function waterWeekFill(first: string, day: string): string | null {
  const monday = (d: string) => Math.floor((dayToDate(d).getTime() / 86_400_000 + 3) / 7); // weeks since 1970-01-05, a Monday
  return WATER_WEEK_FILLS[(((monday(day) - monday(first)) % 2) + 2) % 2];
}

/** Excel sheet names: at most 31 characters, none of : \ / ? * [ ], unique (case-insensitive). */
export function sheetName(name: string, taken: Set<string>): string {
  const base = name.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || "Medence";
  let candidate = base;
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${base.slice(0, 28)} ${i}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

function localDate(at: Date): string {
  const w = wallClock(at, BUSINESS_TZ);
  return formatDay(`${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`);
}

function localTime(at: Date): string {
  const w = wallClock(at, BUSINESS_TZ);
  return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
}

export type ExcelFilter = { from: string; to: string; poolIds: string[] | null };

export async function buildWaterWorkbook(f: ExcelFilter): Promise<{ buffer: Buffer; rows: number; sheets: string[] }> {
  const rows = await prisma.measurement.findMany({
    where: {
      status: "VALID",
      businessDay: { gte: dayToDate(f.from), lte: dayToDate(f.to) },
      ...(f.poolIds ? { poolId: { in: f.poolIds } } : {}),
    },
    include: {
      unit: true,
      pool: { include: { names: true } },
      parameter: { include: { names: true } },
      referenceRange: { include: { unit: true } },
    },
    orderBy: [{ measuredAt: "asc" }, { createdAt: "asc" }],
  });
  const people = await prisma.userMonogram.findMany({ where: { userId: { in: [...new Set(rows.map((r) => r.responsibleUserId))] } } });
  // a measurement recorded back in time, before the worker's first monogram began (point 1: the "?" rows were the old
  // measurements Lili loaded, dated before her account; prisma/zims-name-lili-fix.mjs measured the same gap for the ZIMS
  // name): the first monogram is the one the worker is known by; a later change still leaves the older ones their own
  const monoOf = (userId: string, at: Date) => nameAt(people.filter((p) => p.userId === userId), at)?.monogram ?? "?";
  const endOfPeriod = resolveLocalDateTime(`${f.to}T23:59`)!.instant;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Cápárium nAPPló";
  wb.created = new Date();
  const taken = new Set<string>();
  const summary = wb.addWorksheet(sheetName(SUMMARY_SHEET, taken));
  const perPool = new Map<string, ExcelJS.Worksheet>();
  // sheet order: the order of the pools' first appearance is not stable, so sort by name
  const poolNames = new Map<string, string>();
  for (const m of rows) poolNames.set(m.poolId, pickValid(m.pool.names, endOfPeriod)?.displayName ?? m.pool.code);
  for (const [poolId, name] of [...poolNames].sort((a, b) => a[1].localeCompare(b[1], "hu"))) {
    perPool.set(poolId, wb.addWorksheet(sheetName(name, taken)));
  }
  const header = [...TEMPLATE_HEADER, ...EXTRA_HEADER, ...TICK_HEADER];
  for (const ws of [summary, ...perPool.values()]) {
    const head = ws.addRow(header);
    head.font = { bold: true };
    head.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WATER_HEAD_FILL } }));
    ws.columns = [12, 8, 16, 16, 10, 13, 15, 11, 9, 8, 14, 12, 10, 10].map((width) => ({ width }));
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  const ticked = await prisma.poolTick.findMany({
    where: { businessDay: { gte: dayToDate(f.from), lte: dayToDate(f.to) }, ...(f.poolIds ? { poolId: { in: f.poolIds } } : {}) },
  });
  const tickAt = new Set(ticked.map((t) => `${t.poolId}:${dateToDay(t.businessDay)}:${t.kind}`));
  const tickShown = new Set<string>();
  for (const m of rows) {
    const value = canonicalDecimal(m.value);
    const r = m.referenceRange;
    const status = evaluateReference(
      value,
      { id: m.unit.id, dimension: m.unit.dimension, factorToBase: m.unit.factorToBase?.toString() ?? null },
      r
        ? {
            min: r.min === null ? null : canonicalDecimal(r.min),
            max: r.max === null ? null : canonicalDecimal(r.max),
            unit: { id: r.unit.id, dimension: r.unit.dimension, factorToBase: r.unit.factorToBase?.toString() ?? null },
          }
        : null,
    );
    const cells = [
      localDate(m.measuredAt),
      localTime(m.measuredAt),
      pickValid(m.pool.names, m.measuredAt)?.displayName ?? m.pool.code,
      pickValid(m.parameter.names, m.measuredAt)?.displayName ?? m.parameter.code,
      // a number cell; the exact decimal fits a double for these magnitudes, the text stays in the DB
      Number(value),
      m.unit.symbol,
      monoOf(m.responsibleUserId, m.measuredAt),
      m.traineePerformed ? "igen" : "",
      m.dilution ?? "",
      m.diluentWater ?? "",
      m.baseValue === null ? "" : Number(canonicalDecimal(m.baseValue)),
      ...TICK_ORDER.map((kind) => {
        const key = `${m.poolId}:${dateToDay(m.businessDay)}:${kind}`;
        if (!tickAt.has(key) || tickShown.has(key)) return "";
        tickShown.add(key);
        return "volt";
      }),
    ];
    const band = waterWeekFill(f.from, dateToDay(m.businessDay));
    for (const ws of [summary, perPool.get(m.poolId)!]) {
      const row = ws.addRow(cells);
      if (band) for (let c = 1; c <= header.length; c++) row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: band } };
      row.getCell(5).numFmt = m.parameter.decimals > 0 ? `0.${"0".repeat(m.parameter.decimals)}` : "0";
      if (status === "LOW" || status === "HIGH") row.getCell(5).font = { color: { argb: RED }, bold: true };
    }
  }
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, rows: rows.length, sheets: wb.worksheets.map((w) => w.name) };
}
