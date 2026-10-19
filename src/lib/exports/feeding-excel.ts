// Feeding and eating Excel exports (EGY-10, EGY-11, EGY-12, EVE-05..EVE-07, EVE-09, EVE-10, D-30).
// The layout follows the customer's two templates (forras-kivonat/takarmany-egyedi-template-
// szerkezet.json and takarmany-evesi-minta-template-szerkezet.json): the header rows, their fills and
// the merged label cells. Where the template is wrong it is not copied (D-30): a SUM never adds pieces
// to grams, so there is one "SUM/Állat" column per unit. Names are the ones valid on the day of the
// row (K3, K4); feed and animal lists come from the data, so a new feed or animal does not break the
// layout (D-22).

import type { Dimension } from "@prisma/client";
import ExcelJS from "exceljs";
import { prisma } from "../db";
import { AppError } from "../errors";
import { dayBounds } from "../feeding";
import { pickValid } from "../master";
import { feedingLog } from "../feeding-log";
import { breakdown, type ReportLine } from "../reports";
import { addDays, dateToDay, dayToDate, resolveLocalDateTime } from "../time";

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

/** EVE-08: the fill of a day's header cell, alternating by calendar week (Monday to Sunday). */
export const WEEK_FILLS = ["FFDCEAF7", "FFEDEDED"] as const;
export function weekShade(first: string, day: string): string {
  const monday = (d: string) => {
    const t = dayToDate(d);
    return Math.floor((t.getTime() / 86_400_000 + 3) / 7); // weeks since 1970-01-05, a Monday
  };
  return WEEK_FILLS[(monday(day) - monday(first)) % 2];
}

const OTHER_SLOTS = 5; // the template's "Egyéb 1..5" (setting egyéb_takarmány_max)
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
    prisma.feedType.findMany({ orderBy: { sortOrder: "asc" }, include: { feeds: { orderBy: { sortOrder: "asc" }, include: { names: true } } } }),
    prisma.unit.findMany({ where: { isBase: true } }),
  ]);
  const baseOf = new Map(baseUnits.map((u) => [u.dimension, u.symbol]));

  // feed columns: every active feed and every feed that occurs in the period, one per dimension
  const used = new Map<string, Set<Dimension>>();
  for (const it of items) for (const q of it.quantities) used.set(it.feedId, (used.get(it.feedId) ?? new Set()).add(q.unit.dimension));
  type Col = { feedId: string; dimension: Dimension; name: string; unit: string };
  const cols: Col[] = [];
  for (const t of types.filter((x) => x.code !== "EGYEB")) {
    for (const feed of t.feeds.filter((x) => x.active || used.has(x.id))) {
      const dims = new Set([...feed.allowedDimensions, ...(used.get(feed.id) ?? [])]);
      for (const dimension of DIM_ORDER.filter((d) => dims.has(d))) {
        cols.push({ feedId: feed.id, dimension, name: pickValid(feed.names, endOfPeriod)?.name ?? feed.names.at(-1)?.name ?? "?", unit: baseOf.get(dimension) ?? "?" });
      }
    }
  }
  const otherUnit = baseOf.get("MASS") ?? "g";
  const sumUnits = [...new Set([...cols.map((c) => c.unit), otherUnit])];

  // rows: one per day and recipient (an animal, or a group with its group item)
  type Row = { day: string; species: string; name: string; values: Map<number, number>; other: { qty: number | string; name: string }[] };
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
      row = { day, species, name, values: new Map(), other: [] };
      rows.set(key, row);
    }
    if (it.feed.type.code === "EGYEB") {
      // EGY-12: the name of the other feed goes to its own note column, nothing else
      const mass = it.quantities.find((q) => q.unit.dimension === "MASS");
      const qty = mass ? Number(mass.quantity) * Number(mass.unit.factorToBase ?? 1) : it.quantities.map((q) => `${Number(q.quantity)} ${q.unit.symbol}`).join(" + ");
      row.other.push({ qty, name: it.otherName ?? "" });
      if (row.other.length > OTHER_SLOTS) {
        throw new AppError(422, "TOO_MANY_OTHER", `${day}: ${row.name} több mint ${OTHER_SLOTS} egyéb takarmányt kapott; az Excel-sablon ennyit tud.`);
      }
      continue;
    }
    for (const q of it.quantities) {
      const i = cols.findIndex((c) => c.feedId === it.feedId && c.dimension === q.unit.dimension);
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
      rows.set(`${d}|${a.id}`, { day: d, species: a.species.scientificName, name, values: new Map(), other: [] });
    }
  }
  const sorted = [...rows.values()].sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name, "hu"));

  // column layout: A date, B species, C name, D label column, feeds, Egyéb 1..5, SUM/Állat per unit, notes
  const FIRST = 5;
  const otherCol = (k: number) => FIRST + cols.length + k;
  const sumCol = (k: number) => FIRST + cols.length + OTHER_SLOTS + k;
  const noteCol = (k: number) => FIRST + cols.length + OTHER_SLOTS + sumUnits.length + k;
  const last = noteCol(OTHER_SLOTS - 1);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Cápárium nAPPló";
  wb.created = new Date();
  const ws = wb.addWorksheet("Egyedi takarmánynapló");
  const r1 = ws.getRow(1);
  const r2 = ws.getRow(2);
  const r3 = ws.getRow(3);
  r1.getCell(4).value = "Takarmány";
  r2.getCell(4).value = "Mértékegység";
  cols.forEach((c, i) => {
    r1.getCell(FIRST + i).value = c.name;
    r2.getCell(FIRST + i).value = c.unit;
  });
  // a feed with two units: its name over both columns (the template's J1:K1)
  for (let i = 0; i < cols.length; ) {
    let j = i;
    while (j + 1 < cols.length && cols[j + 1].feedId === cols[i].feedId) j++;
    if (j > i) ws.mergeCells(1, FIRST + i, 1, FIRST + j);
    i = j + 1;
  }
  for (let k = 0; k < OTHER_SLOTS; k++) {
    r1.getCell(otherCol(k)).value = `Egyéb ${k + 1}`;
    r2.getCell(otherCol(k)).value = otherUnit;
    r1.getCell(noteCol(k)).value = `Egyéb ${k + 1} megjegyzés`;
  }
  sumUnits.forEach((u, k) => {
    r1.getCell(sumCol(k)).value = "SUM/Állat";
    r2.getCell(sumCol(k)).value = u;
  });
  r3.getCell(1).value = "Dátum";
  r3.getCell(2).value = "Állatfaj";
  r3.getCell(3).value = "Név";
  for (let c = 1; c <= last; c++) {
    fill(r1.getCell(c), c <= 3 ? FILL.grey : FILL.head);
    fill(r2.getCell(c), c <= 3 ? FILL.grey : FILL.unit);
    fill(r3.getCell(c), c <= 3 ? FILL.head : FILL.dark);
  }
  r1.font = { bold: true };
  r3.font = { bold: true };

  const firstData = 4;
  sorted.forEach((row, n) => {
    const r = ws.getRow(firstData + n);
    r.getCell(1).value = dayToDate(row.day);
    r.getCell(1).numFmt = "yyyy.mm.dd";
    r.getCell(2).value = row.species;
    r.getCell(3).value = row.name;
    for (const [i, v] of row.values) r.getCell(FIRST + i).value = v;
    // EGY-05: what the animal did not get that day stays empty and coloured
    for (let c = FIRST; c < otherCol(OTHER_SLOTS); c++) {
      const cell = r.getCell(c);
      if (cell.value === null || cell.value === undefined) fill(cell, EMPTY);
    }
    row.other.forEach((o, k) => {
      r.getCell(otherCol(k)).value = o.qty;
      r.getCell(noteCol(k)).value = o.name;
    });
    sumUnits.forEach((u, k) => {
      const members = [...cols.map((c, i) => (c.unit === u ? FIRST + i : 0)), ...(u === otherUnit ? [...Array(OTHER_SLOTS).keys()].map(otherCol) : [])].filter(Boolean);
      const result = members.reduce((s, c) => s + (typeof r.getCell(c).value === "number" ? (r.getCell(c).value as number) : 0), 0);
      r.getCell(sumCol(k)).value = { formula: `SUM(${members.map((c) => `${colLetter(c)}${r.number}`).join(",")})`, result };
    });
  });

  // EGY-11: the SUM row is always the last, under every recipient
  const sumRow = ws.getRow(firstData + sorted.length);
  sumRow.getCell(1).value = "SUM/Takarmány";
  ws.mergeCells(sumRow.number, 1, sumRow.number, 3);
  for (let c = 1; c <= 3; c++) fill(sumRow.getCell(c), FILL.head);
  sumRow.font = { bold: true };
  for (let c = FIRST; c < noteCol(0); c++) {
    let result = 0;
    for (let n = firstData; n < sumRow.number; n++) {
      const v = ws.getRow(n).getCell(c).value;
      result += typeof v === "number" ? v : v && typeof v === "object" && "result" in v ? Number(v.result) || 0 : 0;
    }
    sumRow.getCell(c).value = sorted.length ? { formula: `SUM(${colLetter(c)}${firstData}:${colLetter(c)}${sumRow.number - 1})`, result } : 0;
  }
  ws.columns.forEach((c, i) => (c.width = i < 3 ? [12, 22, 22][i] : 14));
  ws.views = [{ state: "frozen", xSplit: 3, ySplit: 3 }];
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), rows: sorted.length };
}

/** EVE-07: species, name, group; the days run across; one coloured cell per animal and day. */
export async function buildEatingWorkbook(f: FeedingExcelFilter): Promise<{ buffer: Buffer; rows: number }> {
  const days = daysOf(f.from, f.to);
  const start = dayBounds(f.from).start;
  const end = dayBounds(f.to).end;
  const [events, statuses] = await Promise.all([
    prisma.lifecycleEvent.findMany({ where: { status: "VALID" }, select: { animalId: true, type: true, occurredAt: true } }),
    prisma.eatingStatus.findMany({
      where: { status: "VALID", feedingDay: { businessDay: { gte: dayToDate(f.from), lte: dayToDate(f.to) } } },
      include: { feedingDay: true },
    }),
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
        name: pickValid(a.names, at)?.name ?? a.names.at(-1)?.name ?? "?",
        group: m ? pickValid(m.group.names, at)?.name ?? "" : "",
        arrived: r.arrived!,
        ended: r.ended ?? null,
      };
    })
    .sort((a, b) => a.species.localeCompare(b.species, "hu") || a.name.localeCompare(b.name, "hu"));

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
    r1.getCell(FIRST + i).numFmt = "mm.dd";
    // EVE-08: the weeks in two alternating colours (Monday starts a week)
    fill(r1.getCell(FIRST + i), weekShade(f.from, d));
  });
  r2.getCell(1).value = "Állatfaj";
  r2.getCell(2).value = "Név";
  r2.getCell(3).value = "Csoport";
  for (let c = 1; c <= Math.max(4, last); c++) {
    if (c <= 4) fill(r1.getCell(c), c <= 3 ? FILL.grey : FILL.head);
    fill(r2.getCell(c), c <= 3 ? FILL.head : FILL.grey);
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
    days.forEach((d, i) => {
      const cell = r.getCell(FIRST + i);
      const b = dayBounds(d);
      if (a.arrived >= b.end) return fill(cell, NOT_YET);
      if (a.ended && a.ended < b.start) return fill(cell, GONE);
      const s = byCell.get(`${a.id}|${d}`);
      if (!s) return;
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
  ws.columns.forEach((c, i) => (c.width = i < 4 ? [22, 18, 16, 8][i] : 7));
  ws.views = [{ state: "frozen", xSplit: 4, ySplit: 2 }];
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), rows: list.length };
}

/**
 * KIV-05: the withdrawal log after the customer's template (forras-kivonat/takarmany-kivetel-template-
 * szerkezet.json: one header row A1:E1, Dátum, Takarmány típusa, Takarmány, Mennyiség, Mértékegység).
 * One row per item and dimension; the use day as a sixth column, because the two days are separate
 * (T-10). An "Egyéb" item shows its own name in the feed column (KIV-04).
 */
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
  for (const it of items) {
    const day = dateToDay(it.withdrawalDay.businessDay);
    const name = it.otherName ?? pickValid(it.feed.names, dayBounds(day).start)?.name ?? it.feed.names.at(-1)?.name ?? "?";
    for (const q of it.quantities) {
      const r = ws.addRow([dayToDate(day), it.feed.type.name, name, Number(q.quantity), q.unit.symbol, dayToDate(dateToDay(it.useDay))]);
      r.getCell(1).numFmt = "yyyy.mm.dd";
      r.getCell(6).numFmt = "yyyy.mm.dd";
      rows += 1;
    }
  }
  ws.columns.forEach((c, i) => (c.width = [10.8, 22, 16.7, 15, 17.3, 16][i] ?? 10.8));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), rows };
}

/** EGY-13: the report as Excel: one sheet by day, one by recipient, per feed and base unit. */
export async function buildReportWorkbook(f: { from: string; to: string; poolId: string | null; animalId: string | null }): Promise<{ buffer: Buffer; rows: number }> {
  const log = await feedingLog(f);
  const r = breakdown(log.entries, log.days);
  const units = [...new Set(r.columns.map((c) => c.unit))];
  const wb = new ExcelJS.Workbook();
  wb.creator = "Cápárium nAPPló";
  wb.created = new Date();
  const sheet = (name: string, first: string, lines: ReportLine[]) => {
    const ws = wb.addWorksheet(name);
    const header = ws.addRow([first, ...r.columns.map((c) => `${c.feed} (${c.unit})`), ...units.map((u) => `Összesen (${u})`)]);
    header.font = { bold: true };
    header.eachCell((c) => fill(c, FILL.head));
    for (const l of [...lines, r.total]) {
      ws.addRow([l.label, ...r.columns.map((c) => l.cells[c.key] ?? null), ...units.map((u) => l.totals[u] ?? null)]);
    }
    ws.getRow(ws.rowCount).font = { bold: true };
    ws.columns.forEach((c, i) => (c.width = i === 0 ? 24 : 16));
    ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
  };
  sheet("Napokra bontva", "Nap", r.byDay);
  sheet("Kinek", "Állat vagy csoport", r.byRecipient);
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), rows: r.byDay.length };
}
