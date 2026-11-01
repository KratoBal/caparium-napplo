// Feeding and eating Excel exports (EGY-10, EGY-11, EGY-12, EVE-05..EVE-07, EVE-09, EVE-10, D-30).
// The layout follows the customer's two templates (forras-kivonat/takarmany-egyedi-template-
// szerkezet.json and takarmany-evesi-minta-template-szerkezet.json): the header rows, their fills and
// the merged label cells. Where the template is wrong it is not copied (D-30): a SUM never adds pieces
// to grams, so there is one "SUM/Állat" column per unit. Names are the ones valid on the day of the
// row (K3, K4); feed and animal lists come from the data, so a new feed or animal does not break the
// layout (D-22).

import { otherKey, otherLabel } from "../other-name";
import type { Dimension } from "@prisma/client";
import ExcelJS from "exceljs";
import { prisma } from "../db";
import { byAnimalOrder, compareAnimals } from "../animal-order";
import { AppError } from "../errors";
import { GIVEN } from "../eating-labels";
import { dayBounds } from "../feeding";
import { isDerivedFasting, listFacts } from "../eating-pattern";
import { pickValid } from "../master";
import { feedingLog } from "../feeding-log";
import { breakdown, type ReportLine } from "../reports";
import { addDays, businessDayOf, dateToDay, dayToDate, EXCEL_DATE_FORMAT, formatDay, resolveLocalDateTime, weekdayLetter, weekdayName } from "../time";
import { addPies, type Pie } from "./xlsx-pie";

// the template's theme fills, resolved (theme_note of the extracts): Excel tints in HSL lightness
const FILL = {
  grey: "FF595959", // theme 1 (dk1) tint 0.35: the unused corner cells
  dark: "FF262626", // theme 1 tint 0.15: the band under the header
  head: "FFA6CAEC", // theme 3 (dk2 0E2841) tint 0.75: labels
  unit: "FFDCEAF7", // theme 3 tint 0.90: the unit row
};
// EVE-02, DN-03: the colour is display, not data. Before arrival light grey, after death or release
// dark (EVE-10).
const STATE_FILL: Record<string, string> = { EATEN: "FF00B050", PARTIAL: "FFFFFF00", NOT_EATEN: "FFFF0000", FASTING: "FFBDD7EE" };
const NOT_YET = "FFD9D9D9";
const EMPTY = "FFF2F2F2"; // EGY-05: a feed the animal did not get that day
const GONE = FILL.dark;
// Lili 2026-11-01 (point 2): the feeding log's rows change colour day by day, and its totals (the SUM row and the SUM/Állat
// columns) stand out
export const DAY_BAND = "FFE9F2FB";
export const TOTAL_FILL = "FFFFE699";

/**
 * EVE-08: the fill of a day's header cell, alternating by calendar week (Monday to Sunday). Lili 2026-11-01 (point 3): the two
 * weeks were too alike (pale blue, pale grey); now a clear blue and a clear peach, and the day-letter row under them the same
 * two, paler.
 */
export const WEEK_FILLS = ["FF9DC3E6", "FFF4B183"] as const;
export const DAY_ROW_FILLS = ["FFDDEBF7", "FFFCE4D6"] as const;
function weekIndex(first: string, day: string): 0 | 1 {
  const monday = (d: string) => {
    const t = dayToDate(d);
    return Math.floor((t.getTime() / 86_400_000 + 3) / 7); // weeks since 1970-01-05, a Monday
  };
  return ((monday(day) - monday(first)) % 2) as 0 | 1;
}
export function weekShade(first: string, day: string): string {
  return WEEK_FILLS[weekIndex(first, day)];
}
export function dayRowShade(first: string, day: string): string {
  return DAY_ROW_FILLS[weekIndex(first, day)];
}

// point 3: a thin border around every animal's row, and a dashed line between the day columns
const THIN = { style: "thin" as const, color: { argb: "FF7F7F7F" } };
const DASHED = { style: "dashed" as const, color: { argb: "FFA6A6A6" } };

const DIM_ORDER: Dimension[] = ["COUNT", "MASS", "VOLUME"]; // the template: Litopenaeus db, then g

function fill(cell: ExcelJS.Cell, argb: string) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function colLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

const MAX_DAYS = 366; // the eating sheet has a column per day, and Excel stops at 16384

function daysOf(from: string, to: string): string[] {
  // checked before any work (review of #10): a century would otherwise be built first
  if ((dayToDate(to).getTime() - dayToDate(from).getTime()) / 86_400_000 + 1 > MAX_DAYS) {
    throw new AppError(422, "PERIOD_TOO_LONG", "Legfeljebb egy év kérhető le egyszerre.");
  }
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export type FeedingExcelFilter = { from: string; to: string };

/** EGY-10: one row per day and recipient, one column per feed and unit, SUM per unit (D-30). */
export async function buildFeedingWorkbook(f: FeedingExcelFilter): Promise<{ buffer: Buffer; rows: number }> {
  const days = daysOf(f.from, f.to);
  const endOfPeriod = resolveLocalDateTime(`${f.to}T23:59`)!.instant;
  const [items, types, baseUnits] = await Promise.all([
    prisma.feedingItem.findMany({
      where: { status: "VALID", feedingDay: { businessDay: { gte: dayToDate(f.from), lte: dayToDate(f.to) } } },
      include: {
        feedingDay: true,
        quantities: { include: { unit: true } },
        feed: { include: { type: true } },
        animal: { include: { names: true, species: true } },
        group: { include: { names: true } },
        participants: { include: { animal: { include: { species: true } } } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.feedType.findMany({ orderBy: { sortOrder: "asc" }, include: { feeds: { orderBy: { sortOrder: "asc" }, include: { names: true, periods: true } } } }),
    prisma.unit.findMany({ where: { isBase: true } }),
  ]);
  const baseOf = new Map(baseUnits.map((u) => [u.dimension, u.symbol]));

  // feed columns: every active feed and every feed that occurs in the period, one per dimension, in the types' and the
  // admin's order. An "Egyéb" feed has no fixed column: every other name given in the period gets its own, in the
  // Egyéb type's place, by name (Lili 2026-10-29, package item 13: the template's "Egyéb 1..5" and its note columns go,
  // and with them the limit of five a row)
  // The name is ONE column whatever its case or the spaces in it (acrobot 38155, nautilus 38181): the key is trimmed,
  // single-spaced, lower case (other-name.ts), the header shows it with a capital first letter, the same in every period.
  const usedKey = (feedId: string, other: string | null) => `${feedId}|${other === null ? "" : otherKey(other)}`;
  const used = new Map<string, Set<Dimension>>();
  for (const it of items) {
    const isOther = it.feed.type.code === "EGYEB";
    const k = usedKey(it.feedId, isOther ? it.otherName ?? "" : null);
    if (!used.has(k)) used.set(k, new Set());
    for (const q of it.quantities) used.get(k)!.add(q.unit.dimension);
  }
  type Col = { feedId: string; other: string | null; dimension: Dimension; name: string; unit: string };
  const cols: Col[] = [];
  const push = (feedId: string, other: string | null, name: string, dims: Set<Dimension>) => {
    for (const dimension of DIM_ORDER.filter((d) => dims.has(d))) cols.push({ feedId, other, dimension, name, unit: baseOf.get(dimension) ?? "?" });
  };
  for (const t of types) {
    if (t.code === "EGYEB") {
      const named = t.feeds.flatMap((feed) =>
        [...used.entries()].filter(([k]) => k.startsWith(`${feed.id}|`)).map(([k, dims]) => ({ feedId: feed.id, other: k.slice(feed.id.length + 1), shown: otherLabel(k.slice(feed.id.length + 1)), dims, allowed: feed.allowedDimensions })),
      );
      for (const n of named.sort((a, b) => a.other.localeCompare(b.other, "hu"))) {
        push(n.feedId, n.other, n.shown || "Egyéb", n.dims.size ? n.dims : new Set(n.allowed));
      }
      continue;
    }
    // point 14: a feed fed on some day of the period (its period overlaps it), or given in it
    const fedIn = (x: (typeof t.feeds)[number]) => x.periods.some((p) => dateToDay(p.firstDay) <= f.to && (p.lastDay === null || dateToDay(p.lastDay) >= f.from));
    for (const feed of t.feeds.filter((x) => fedIn(x) || used.has(usedKey(x.id, null)))) {
      push(feed.id, null, pickValid(feed.names, endOfPeriod)?.name ?? feed.names.at(-1)?.name ?? "?", new Set([...feed.allowedDimensions, ...(used.get(usedKey(feed.id, null)) ?? [])]));
    }
  }
  const sumUnits = [...new Set(cols.map((c) => c.unit))];
  const colOf = (feedId: string, other: string | null, dimension?: Dimension) =>
    cols.findIndex((c) => c.feedId === feedId && c.other === other && (dimension === undefined || c.dimension === dimension));

  // rows: one per day and recipient (an animal, or a group with its group item)
  // ticks: the feed columns of an item without a quantity (a coral feed ticked on the sheet): "adva", not a number
  type Row = { day: string; species: string; name: string; sortOrder: number | null; values: Map<number, number>; ticks: Set<number> };
  const rows = new Map<string, Row>();
  for (const it of items) {
    const day = dateToDay(it.feedingDay.businessDay);
    const at = dayBounds(day).start;
    const key = `${day}|${it.animalId ?? `g:${it.groupId}`}`;
    let row = rows.get(key);
    if (!row) {
      const species = it.animal
        ? it.animal.species.scientificName
        : [...new Set(it.participants.map((p) => p.animal.species.scientificName))].sort().join(", ");
      const name = it.animal
        ? pickValid(it.animal.names, at)?.name ?? it.animal.names.at(-1)?.name ?? "?"
        : `${pickValid(it.group!.names, at)?.name ?? it.group!.names.at(-1)?.name ?? "?"} (csoport)`;
      row = { day, species, name, sortOrder: it.animal?.sortOrder ?? null, values: new Map(), ticks: new Set() };
      rows.set(key, row);
    }
    // EGY-12: an "Egyéb" item in the column of its own name (package item 13)
    const other = it.feed.type.code === "EGYEB" ? otherKey(it.otherName ?? "") : null;
    if (it.quantities.length === 0) {
      const i = colOf(it.feedId, other);
      if (i >= 0) row.ticks.add(i);
      continue;
    }
    for (const q of it.quantities) {
      const i = colOf(it.feedId, other, q.unit.dimension);
      row.values.set(i, (row.values.get(i) ?? 0) + Number(q.quantity) * Number(q.unit.factorToBase ?? 1));
    }
  }
  // EGY-05: an animal alive on a day but not fed has its row too, with empty, coloured cells
  const events = await prisma.lifecycleEvent.findMany({ where: { status: "VALID" }, select: { animalId: true, type: true, occurredAt: true } });
  const life = new Map<string, { arrived?: Date; ended?: Date }>();
  for (const e of events) {
    const r = life.get(e.animalId) ?? {};
    if (e.type === "ARRIVAL") r.arrived = e.occurredAt;
    if (e.type === "DEATH" || e.type === "RELEASE") r.ended = e.occurredAt;
    life.set(e.animalId, r);
  }
  const animals = await prisma.animal.findMany({ where: { id: { in: [...life.keys()] } }, include: { names: true, species: true } });
  for (const d of days) {
    const { start, end } = dayBounds(d);
    for (const a of animals) {
      const r = life.get(a.id)!;
      if (!r.arrived || r.arrived >= end || (r.ended && r.ended < start) || rows.has(`${d}|${a.id}`)) continue;
      const name = pickValid(a.names, start)?.name ?? a.names.at(-1)?.name ?? "?";
      rows.set(`${d}|${a.id}`, { day: d, species: a.species.scientificName, name, sortOrder: a.sortOrder, values: new Map(), ticks: new Set() });
    }
  }
  // per day: the admin's order (card f67b1a06, item 4); a group row has no position of its own and, like the
  // never-placed animals, follows by name
  const sorted = [...rows.values()].sort((a, b) => a.day.localeCompare(b.day) || compareAnimals(a, b));

  // column layout: A date, B the day's name (point 2), C species, D name, E label column, feeds (the other names among them),
  // SUM/Állat per unit
  const FIRST = 6;
  const sumCol = (k: number) => FIRST + cols.length + k;
  const last = sumCol(sumUnits.length - 1);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Cápárium nAPPló";
  wb.created = new Date();
  const ws = wb.addWorksheet("Egyedi takarmánynapló");
  const r1 = ws.getRow(1);
  const r2 = ws.getRow(2);
  const r3 = ws.getRow(3);
  r1.getCell(5).value = "Takarmány";
  r2.getCell(5).value = "Mértékegység";
  cols.forEach((c, i) => {
    r1.getCell(FIRST + i).value = c.name;
    r2.getCell(FIRST + i).value = c.unit;
  });
  // a feed with two units: its name over both columns (the template's J1:K1)
  for (let i = 0; i < cols.length; ) {
    let j = i;
    // the same feed AND the same other name: two "Egyéb" names share their feed and must not merge
    while (j + 1 < cols.length && cols[j + 1].feedId === cols[i].feedId && cols[j + 1].other === cols[i].other) j++;
    if (j > i) ws.mergeCells(1, FIRST + i, 1, FIRST + j);
    i = j + 1;
  }
  sumUnits.forEach((u, k) => {
    r1.getCell(sumCol(k)).value = "SUM/Állat";
    r2.getCell(sumCol(k)).value = u;
  });
  r3.getCell(1).value = "Dátum";
  r3.getCell(2).value = "Nap";
  r3.getCell(3).value = "Állatfaj";
  r3.getCell(4).value = "Név";
  for (let c = 1; c <= last; c++) {
    fill(r1.getCell(c), c <= 4 ? FILL.grey : FILL.head);
    fill(r2.getCell(c), c <= 4 ? FILL.grey : FILL.unit);
    fill(r3.getCell(c), c <= 4 ? FILL.head : FILL.dark);
  }
  // the totals' heads stand out like their cells
  sumUnits.forEach((_, k) => [r1, r2].forEach((r) => fill(r.getCell(sumCol(k)), TOTAL_FILL)));
  r1.font = { bold: true };
  r3.font = { bold: true };

  const firstData = 4;
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  sorted.forEach((row, n) => {
    const r = ws.getRow(firstData + n);
    r.getCell(1).value = dayToDate(row.day);
    r.getCell(1).numFmt = EXCEL_DATE_FORMAT;
    r.getCell(2).value = weekdayName(row.day);
    r.getCell(3).value = row.species;
    r.getCell(4).value = row.name;
    for (const [i, v] of row.values) r.getCell(FIRST + i).value = v;
    for (const i of row.ticks) if (!row.values.has(i)) r.getCell(FIRST + i).value = GIVEN;
    // EGY-05: what the animal did not get that day stays empty and coloured
    for (let c = FIRST; c < FIRST + cols.length; c++) {
      const cell = r.getCell(c);
      if (cell.value === null || cell.value === undefined) fill(cell, EMPTY);
    }
    sumUnits.forEach((u, k) => {
      const members = cols.map((c, i) => (c.unit === u ? FIRST + i : 0)).filter(Boolean);
      const result = members.reduce((s, c) => s + (typeof r.getCell(c).value === "number" ? (r.getCell(c).value as number) : 0), 0);
      r.getCell(sumCol(k)).value = { formula: `SUM(${members.map((c) => `${colLetter(c)}${r.number}`).join(",")})`, result };
      fill(r.getCell(sumCol(k)), TOTAL_FILL);
      r.getCell(sumCol(k)).font = { bold: true };
    });
    // point 2: every other day's rows in a pale band (an empty feed cell keeps its own grey, EGY-05)
    if ((dayIndex.get(row.day) ?? 0) % 2 === 1) {
      for (let c = 1; c < FIRST + cols.length; c++) if (!r.getCell(c).fill || c < FIRST) fill(r.getCell(c), DAY_BAND);
    }
  });

  // EGY-11: the SUM row is always the last, under every recipient
  const sumRow = ws.getRow(firstData + sorted.length);
  sumRow.getCell(1).value = "SUM/Takarmány";
  ws.mergeCells(sumRow.number, 1, sumRow.number, 4);
  for (let c = 1; c <= last; c++) fill(sumRow.getCell(c), TOTAL_FILL);
  sumRow.font = { bold: true };
  for (let c = FIRST; c <= last; c++) {
    let result = 0;
    for (let n = firstData; n < sumRow.number; n++) {
      const v = ws.getRow(n).getCell(c).value;
      result += typeof v === "number" ? v : v && typeof v === "object" && "result" in v ? Number(v.result) || 0 : 0;
    }
    sumRow.getCell(c).value = sorted.length ? { formula: `SUM(${colLetter(c)}${firstData}:${colLetter(c)}${sumRow.number - 1})`, result } : 0;
  }
  ws.columns.forEach((c, i) => (c.width = i < 4 ? [12, 11, 22, 22][i] : 14));
  ws.views = [{ state: "frozen", xSplit: 4, ySplit: 3 }];
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), rows: sorted.length };
}

/** EVE-07: species, name, group; the days run across; one coloured cell per animal and day. */
export async function buildEatingWorkbook(f: FeedingExcelFilter): Promise<{ buffer: Buffer; rows: number }> {
  const days = daysOf(f.from, f.to);
  const start = dayBounds(f.from).start;
  const end = dayBounds(f.to).end;
  const today = businessDayOf(new Date());
  const [events, statuses, selected] = await Promise.all([
    prisma.lifecycleEvent.findMany({ where: { status: "VALID" }, select: { animalId: true, type: true, occurredAt: true } }),
    prisma.eatingStatus.findMany({
      where: { status: "VALID", feedingDay: { businessDay: { gte: dayToDate(f.from), lte: dayToDate(f.to) } } },
      include: { feedingDay: true },
    }),
    listFacts(f.from, f.to),
  ]);
  const life = new Map<string, { arrived?: Date; ended?: Date }>();
  for (const e of events) {
    const r = life.get(e.animalId) ?? {};
    if (e.type === "ARRIVAL") r.arrived = e.occurredAt;
    if (e.type === "DEATH" || e.type === "RELEASE") r.ended = e.occurredAt;
    life.set(e.animalId, r);
  }
  // EVE-10: an animal that lived at some point of the period is listed; one gone before it is not
  const ids = [...life].filter(([, r]) => r.arrived && r.arrived < end && (!r.ended || r.ended >= start)).map(([id]) => id);
  const animals = await prisma.animal.findMany({
    where: { id: { in: ids } },
    include: { species: true, names: true, memberships: { include: { group: { include: { names: true } } } } },
  });
  const byCell = new Map(statuses.map((s) => [`${s.animalId}|${dateToDay(s.feedingDay.businessDay)}`, s]));
  const list = animals
    .map((a) => {
      const r = life.get(a.id)!;
      const at = new Date(Math.min(end.getTime() - 1, (r.ended ?? end).getTime()));
      const m = pickValid(a.memberships, at);
      return {
        id: a.id,
        species: a.species.scientificName,
        sortOrder: a.sortOrder,
        name: pickValid(a.names, at)?.name ?? a.names.at(-1)?.name ?? "?",
        group: m ? pickValid(m.group.names, at)?.name ?? "" : "",
        arrived: r.arrived!,
        ended: r.ended ?? null,
      };
    })
    // the admin's order (card f67b1a06, item 4); the never-placed keep the old order, by species then name
    .sort(byAnimalOrder((a, b) => a.species.localeCompare(b.species, "hu") || a.name.localeCompare(b.name, "hu")));

  const wb = new ExcelJS.Workbook();
  wb.creator = "Cápárium nAPPló";
  wb.created = new Date();
  const ws = wb.addWorksheet("Teljes evési minta");
  const FIRST = 5;
  const last = FIRST + days.length - 1;
  const r1 = ws.getRow(1);
  const r2 = ws.getRow(2);
  r1.getCell(4).value = "Dátum";
  days.forEach((d, i) => {
    r1.getCell(FIRST + i).value = dayToDate(d);
    r1.getCell(FIRST + i).numFmt = EXCEL_DATE_FORMAT;
    // EVE-08: the weeks in two alternating colours (Monday starts a week)
    fill(r1.getCell(FIRST + i), weekShade(f.from, d));
    // Lili 2026-10-29 (package item 7): the day's letter under the date
    r2.getCell(FIRST + i).value = weekdayLetter(d);
    r2.getCell(FIRST + i).alignment = { horizontal: "center" };
  });
  const dayRow = (i: number) => dayRowShade(f.from, days[i]);
  r2.getCell(1).value = "Állatfaj";
  r2.getCell(2).value = "Név";
  r2.getCell(3).value = "Csoport";
  for (let c = 1; c <= Math.max(4, last); c++) {
    if (c <= 4) fill(r1.getCell(c), c <= 3 ? FILL.grey : FILL.head);
    fill(r2.getCell(c), c <= 3 ? FILL.head : c === 4 ? FILL.grey : dayRow(c - FIRST));
  }
  r1.font = { bold: true };
  r2.font = { bold: true };

  const notes = new Map<number, string[]>();
  list.forEach((a, n) => {
    const r = ws.getRow(3 + n);
    r.getCell(1).value = a.species;
    r.getCell(2).value = a.name;
    r.getCell(3).value = a.group;
    // EVE-10: died or released inside the period: struck through
    if (a.ended && a.ended < end) r.getCell(2).font = { strike: true };
    for (let c = 1; c <= 4; c++) r.getCell(c).border = { top: THIN, bottom: THIN, left: c === 1 ? THIN : undefined, right: c === 4 ? THIN : undefined };
    days.forEach((d, i) => {
      const cell = r.getCell(FIRST + i);
      cell.border = { top: THIN, bottom: THIN, left: i === 0 ? THIN : DASHED, right: i === days.length - 1 ? THIN : DASHED };
      const b = dayBounds(d);
      if (a.arrived >= b.end) return fill(cell, NOT_YET);
      if (a.ended && a.ended < b.start) return fill(cell, GONE);
      const s = byCell.get(`${a.id}|${d}`);
      // no stored status: a fasting day when the animal was not on the day's list (DN-03, eating-pattern.ts)
      if (!s) return isDerivedFasting(selected, a.id, d, today) ? fill(cell, STATE_FILL.FASTING) : undefined;
      fill(cell, STATE_FILL[s.state]);
      cell.value = [s.vitamin ? "V" : "", s.medicine ? "Gy" : ""].filter(Boolean).join(" ") || null;
      cell.alignment = { horizontal: "center" };
      // EVE-05: the medicine note at the bottom of the day's column
      if (s.medicine && s.medicineNote) notes.set(FIRST + i, [...(notes.get(FIRST + i) ?? []), `${a.name}: ${s.medicineNote}`]);
    });
  });

  // EVE-09: the note row stays at the bottom (the template's A14:D14)
  const noteRow = ws.getRow(3 + list.length);
  noteRow.getCell(1).value = "Megjegyzés";
  ws.mergeCells(noteRow.number, 1, noteRow.number, 4);
  for (let c = 1; c <= 4; c++) fill(noteRow.getCell(c), FILL.head);
  noteRow.font = { bold: true };
  for (const [c, lines] of notes) {
    noteRow.getCell(c).value = lines.join("\n");
    noteRow.getCell(c).alignment = { wrapText: true, vertical: "top" };
    noteRow.getCell(c).font = { bold: false };
  }
  ws.columns.forEach((c, i) => (c.width = i < 4 ? [22, 18, 16, 8][i] : 11.5));
  ws.views = [{ state: "frozen", xSplit: 4, ySplit: 2 }];
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), rows: list.length };
}

/**
 * KIV-05: the withdrawal log after the customer's template (forras-kivonat/takarmany-kivetel-template-
 * szerkezet.json: one header row A1:E1, Dátum, Takarmány típusa, Takarmány, Mennyiség, Mértékegység).
 * One row per item and dimension; the use day as a sixth column, because the two days are separate
 * (T-10). An "Egyéb" item shows its own name in the feed column (KIV-04).
 * Lili 2026-11-01 (point 4): the rows change colour day by day, and a second sheet sums each calendar week per feed (g and kg,
 * pieces apart), with the week's pie of the grams beside it.
 */
export const WITHDRAWAL_SUMMARY_SHEET = "Heti összesítő";
const PIE_ROWS = 16;

export async function buildWithdrawalWorkbook(f: FeedingExcelFilter): Promise<{ buffer: Buffer; rows: number }> {
  daysOf(f.from, f.to);
  const items = await prisma.withdrawalItem.findMany({
    where: { status: "VALID", withdrawalDay: { businessDay: { gte: dayToDate(f.from), lte: dayToDate(f.to) } } },
    include: { withdrawalDay: true, quantities: { include: { unit: true } }, feed: { include: { names: true, type: true } } },
    orderBy: [{ withdrawalDay: { businessDay: "asc" } }, { createdAt: "asc" }],
  });
  const wb = new ExcelJS.Workbook();
  wb.creator = "Cápárium nAPPló";
  wb.created = new Date();
  const ws = wb.addWorksheet("Munka1");
  const header = ws.getRow(1);
  ["Dátum", "Takarmány típusa", "Takarmány", "Mennyiség", "Mértékegység", "Felhasználás napja"].forEach((h, i) => {
    header.getCell(i + 1).value = h;
    fill(header.getCell(i + 1), FILL.head);
  });
  header.font = { bold: true };
  let rows = 0;
  // the week's sums per feed: grams (any mass, in its base unit) and pieces
  type Sum = { g: number; db: number };
  const weeks = new Map<string, Map<string, Sum>>();
  let anyPieces = false;
  const days: string[] = [];
  for (const it of items) {
    const day = dateToDay(it.withdrawalDay.businessDay);
    if (days.at(-1) !== day) days.push(day);
    const name = it.otherName ?? pickValid(it.feed.names, dayBounds(day).start)?.name ?? it.feed.names.at(-1)?.name ?? "?";
    const week = mondayOf(day);
    if (!weeks.has(week)) weeks.set(week, new Map());
    const sums = weeks.get(week)!;
    const sum = sums.get(name) ?? { g: 0, db: 0 };
    for (const q of it.quantities) {
      const r = ws.addRow([dayToDate(day), it.feed.type.name, name, Number(q.quantity), q.unit.symbol, dayToDate(dateToDay(it.useDay))]);
      r.getCell(1).numFmt = EXCEL_DATE_FORMAT;
      r.getCell(6).numFmt = EXCEL_DATE_FORMAT;
      if ((days.length - 1) % 2 === 1) for (let c = 1; c <= 6; c++) fill(r.getCell(c), DAY_BAND);
      rows += 1;
      if (q.unit.dimension === "MASS") sum.g += Number(q.quantity) * Number(q.unit.factorToBase ?? 1);
      else if (q.unit.dimension === "COUNT") {
        sum.db += Number(q.quantity);
        anyPieces = true;
      }
    }
    sums.set(name, sum);
  }
  ws.columns.forEach((c, i) => (c.width = [11.6, 22, 16.7, 15, 17.3, 16][i] ?? 10.8));
  ws.views = [{ state: "frozen", ySplit: 1 }];

  // the weekly summary: a block per week, the pie beside it
  const sw = wb.addWorksheet(WITHDRAWAL_SUMMARY_SHEET);
  const heads = ["Takarmány", "Mennyiség (g)", "Mennyiség (kg)", ...(anyPieces ? ["Darab (db)"] : [])];
  const pies: Pie[] = [];
  let at = 1;
  for (const [week, sums] of [...weeks].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sunday = addDays(week, 6);
    const title = `Hét: ${formatDay(week < f.from ? f.from : week)}–${formatDay(sunday > f.to ? f.to : sunday)}`;
    const t = sw.getRow(at);
    t.getCell(1).value = title;
    t.font = { bold: true };
    sw.mergeCells(at, 1, at, heads.length);
    fill(t.getCell(1), FILL.head);
    const h = sw.getRow(at + 1);
    heads.forEach((x, i) => {
      h.getCell(i + 1).value = x;
      fill(h.getCell(i + 1), FILL.unit);
    });
    h.font = { bold: true };
    const feeds = [...sums].sort((a, b) => a[0].localeCompare(b[0], "hu"));
    feeds.forEach(([name, s], i) => {
      const r = sw.getRow(at + 2 + i);
      r.getCell(1).value = name;
      r.getCell(2).value = round3(s.g);
      // ExcelJS drops a formula's 0 result from the file, and a viewer that does not recalculate shows an empty cell: a plain 0 then
      r.getCell(3).value = s.g ? { formula: `B${r.number}/1000`, result: round3(s.g / 1000) } : 0;
      r.getCell(3).numFmt = "0.000";
      if (anyPieces) r.getCell(4).value = s.db || null;
    });
    const first = at + 2;
    const lastFeed = first + feeds.length - 1;
    const total = sw.getRow(lastFeed + 1);
    const g = feeds.reduce((a, [, s]) => a + s.g, 0);
    total.getCell(1).value = "Összesen";
    total.getCell(2).value = g ? { formula: `SUM(B${first}:B${lastFeed})`, result: round3(g) } : 0;
    total.getCell(3).value = g ? { formula: `SUM(C${first}:C${lastFeed})`, result: round3(g / 1000) } : 0;
    total.getCell(3).numFmt = "0.000";
    const pieces = feeds.reduce((a, [, s]) => a + s.db, 0);
    if (anyPieces) total.getCell(4).value = pieces ? { formula: `SUM(D${first}:D${lastFeed})`, result: pieces } : 0;
    for (let c = 1; c <= heads.length; c++) fill(total.getCell(c), TOTAL_FILL);
    total.font = { bold: true };
    if (g > 0) {
      pies.push({
        title,
        labelCol: 1,
        valueCol: 2,
        firstRow: first,
        lastRow: lastFeed,
        labels: feeds.map(([name]) => name),
        values: feeds.map(([, s]) => round3(s.g)),
        at: { col: heads.length + 2, row: at, cols: 7, rows: PIE_ROWS },
      });
    }
    at = Math.max(total.number + 3, at + PIE_ROWS + 2);
  }
  if (weeks.size === 0) sw.getCell("A1").value = "Ebben az időszakban nem volt takarmánykivétel.";
  sw.columns.forEach((c, i) => (c.width = [26, 15, 15, 12][i] ?? 10.8));
  const buffer = await addPies(Buffer.from(await wb.xlsx.writeBuffer()), 2, WITHDRAWAL_SUMMARY_SHEET, pies);
  return { buffer, rows };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The Monday of a day's calendar week. */
function mondayOf(day: string): string {
  const dow = (dayToDate(day).getUTCDay() + 6) % 7; // Monday 0
  return addDays(day, -dow);
}

/** EGY-13: the report as Excel: one sheet by day, one by recipient, per feed and base unit. */
export async function buildReportWorkbook(f: { from: string; to: string; poolId: string | null; animalId: string | null }): Promise<{ buffer: Buffer; rows: number }> {
  const log = await feedingLog(f);
  const r = breakdown(log.entries, log.days, log.filtered, log.recipientOrder, log.feedOrder);
  const units = [...new Set(r.columns.filter((c) => !c.group).map((c) => c.unit))];
  const groupUnits = [...new Set(r.columns.filter((c) => c.group).map((c) => c.unit))];
  const wb = new ExcelJS.Workbook();
  wb.creator = "Cápárium nAPPló";
  wb.created = new Date();
  const sheet = (name: string, first: string, lines: ReportLine[]) => {
    const ws = wb.addWorksheet(name);
    const header = ws.addRow([
      first,
      ...r.columns.map((c) => `${c.feed} (${c.unit})`),
      ...units.map((u) => `${groupUnits.length ? "Egyedi összesen" : "Összesen"} (${u})`),
      ...groupUnits.map((u) => `Csoportos tételekben, a csoport teljes mennyisége (${u})`),
    ]);
    header.font = { bold: true };
    header.eachCell((c) => fill(c, FILL.head));
    for (const l of [...lines, r.total]) {
      ws.addRow([l.label, ...r.columns.map((c) => l.cells[c.key] ?? null), ...units.map((u) => l.totals[u] ?? null), ...groupUnits.map((u) => l.groupTotals[u] ?? null)]);
    }
    ws.getRow(ws.rowCount).font = { bold: true };
    ws.columns.forEach((c, i) => (c.width = i === 0 ? 24 : 16));
    ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
  };
  sheet("Napokra bontva", "Nap", r.byDay);
  sheet("Kinek", "Állat vagy csoport", r.byRecipient);
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), rows: r.byDay.length };
}
