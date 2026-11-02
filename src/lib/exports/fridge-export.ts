// The fridges' temperature book as an Excel and a PDF for a period (Lili 2026-11-02, task caparium-hutok: "Hűtők hőmérséklete",
// broken down by month). Excel: one sheet per month; PDF: one band per month. A row is one valid reading: date, time, fridge,
// kind, temperature, the range it was taken with, the defrost tick, the note and who recorded it; a temperature outside its
// range is red in both. Only the fridge tables are read: nothing here touches a water measurement, and the water exports do
// not read these tables.
import ExcelJS from "exceljs";
import { monogramResolver } from "../master";
import { FRIDGE_KIND_LABEL, fridgeReadings, huTemp, type ReadingView } from "../fridges";
import { formatDay, formatPeriod, localTimeOf } from "../time";
import { pdfPage } from "./pdf-layout";
import { WATER_HEAD_FILL } from "./excel";

export const FRIDGE_TITLE = "Hűtők hőmérséklete";
export const FRIDGE_HEADER = ["Dátum", "Idő", "Hűtő", "Fajta", "Hőmérséklet (°C)", "Minimum (°C)", "Maximum (°C)", "Leolvasztás", "Megjegyzés", "Rögzítette"];

const MONTHS = ["január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember", "október", "november", "december"];
const RED = "FFDF5B5B";
const PDF_RED = "#C0392B";

/** "2026-11" -> "2026. november" */
export function monthTitle(month: string): string {
  return `${month.slice(0, 4)}. ${MONTHS[Number(month.slice(5, 7)) - 1]}`;
}

/** The period's readings by month, in time order; a month without a reading is left out. */
export function byMonth(rows: ReadingView[]): [string, ReadingView[]][] {
  const months = new Map<string, ReadingView[]>();
  for (const r of rows) {
    const m = r.day.slice(0, 7);
    months.set(m, [...(months.get(m) ?? []), r]);
  }
  return [...months].sort((a, b) => a[0].localeCompare(b[0]));
}

async function rowsOf(from: string, to: string) {
  const rows = await fridgeReadings(from, to);
  const who = await monogramResolver(rows.map((r) => r.createdById));
  return rows.map((r) => ({ r, by: who.monogram(r.createdById, new Date(r.measuredAt)) }));
}

export async function buildFridgeWorkbook(from: string, to: string): Promise<{ buffer: Buffer; rows: number; sheets: string[] }> {
  const rows = await rowsOf(from, to);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Cápárium nAPPló";
  wb.created = new Date();
  const months = byMonth(rows.map((x) => x.r));
  const by = new Map(rows.map((x) => [x.r.id, x.by]));
  const sheet = (name: string) => {
    const ws = wb.addWorksheet(name);
    const head = ws.addRow(FRIDGE_HEADER);
    head.font = { bold: true };
    head.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WATER_HEAD_FILL } }));
    ws.columns = [12, 7, 20, 11, 16, 13, 13, 12, 36, 11].map((width) => ({ width }));
    ws.views = [{ state: "frozen", ySplit: 1 }];
    return ws;
  };
  if (months.length === 0) sheet(FRIDGE_TITLE).addRow([`Az időszakban (${formatPeriod(from, to)}) nem volt leolvasás.`]);
  for (const [month, list] of months) {
    const ws = sheet(monthTitle(month));
    for (const r of list) {
      const row = ws.addRow([
        formatDay(r.day),
        localTimeOf(new Date(r.measuredAt)),
        r.fridge,
        FRIDGE_KIND_LABEL[r.kind],
        Number(r.temperature),
        Number(r.min),
        Number(r.max),
        r.defrost ? "igen" : "",
        r.note ?? "",
        by.get(r.id) ?? "?",
      ]);
      for (const c of [5, 6, 7]) row.getCell(c).numFmt = "0.0";
      if (r.outOfRange) row.getCell(5).font = { color: { argb: RED }, bold: true };
    }
  }
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, rows: rows.length, sheets: wb.worksheets.map((w) => w.name) };
}

export async function buildFridgePdf(from: string, to: string): Promise<{ buffer: Buffer; rows: number }> {
  const rows = await rowsOf(from, to);
  const by = new Map(rows.map((x) => [x.r.id, x.by]));
  const page = pdfPage({ title: `${FRIDGE_TITLE}: ${formatPeriod(from, to)}`, subtitle: `Időszak: ${formatPeriod(from, to)}`, landscape: true });
  const months = byMonth(rows.map((x) => x.r));
  if (months.length === 0) page.note("Az időszakban nem volt leolvasás.");
  for (const [month, list] of months) {
    const out = list.filter((r) => r.outOfRange).length;
    page.band(`${monthTitle(month)} (${list.length} leolvasás${out ? `, ebből ${out} tartományon kívül` : ""})`);
    page.table(
      [66, 40, 120, 62, 62, 76, 60, 194, 82],
      ["Nap", "Idő", "Hűtő", "Fajta", "°C", "Tartomány (°C)", "Leolvasztás", "Megjegyzés", "Rögzítette"],
      list.map((r) => ({
        cells: [formatDay(r.day), localTimeOf(new Date(r.measuredAt)), r.fridge, FRIDGE_KIND_LABEL[r.kind], huTemp(r.temperature), `${huTemp(r.min)} – ${huTemp(r.max)}`, r.defrost ? "igen" : "", r.note ?? "", by.get(r.id) ?? "?"],
        colors: [null, null, null, null, r.outOfRange ? PDF_RED : null],
      })),
    );
  }
  return { buffer: await page.done(), rows: rows.length };
}
