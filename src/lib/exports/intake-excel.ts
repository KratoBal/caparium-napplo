// The Takarmányhűtő report as Excel (Lili 2026-10-30, acrobot 38557/38558): sheets after the other exports' style (a blue
// header row): the intake with the delivery sent back in red, and the balance, a block a feed (Lili 2026-11-01, point 7).
// The numbers are numbers; the data comes from intakeReport (intake-report.ts), as the PDF's does.
import type { Writable } from "node:stream";
import ExcelJS from "exceljs";
import { intakeReport, type IntakeReport } from "./intake-report";
import { EXCEL_DATE_FORMAT, reportTitle } from "./intake-report-text";
import { finish, pace, PACE_ROWS, workbookBuffer, workbookWriter, type StreamedWorkbook } from "./xlsx-stream";

const HEAD = "FFA6CAEC"; // the same header blue as the other exports
/** The red ink of a delivery that was sent back (Lili: "piros betűszínnel", PDF and Excel). */
export const RETURNED_ARGB = "FFC00000";

const asNumber = (shown: string) => Number(shown.replace(/\s/g, "").replace(",", "."));

/** The title row (row 1), an empty row 2, the header row 3, the first row of data under it (Lili 2026-10-30: the document has a title). */
const HEADER_ROW = 3;

/** A sheet of the streamed book: its widths and its frozen panes go in before its first row (xlsx-stream.ts). */
function sheet(wb: ExcelJS.stream.xlsx.WorkbookWriter, name: string, widths: number[], ySplit?: number) {
  const ws = wb.addWorksheet(name, ySplit ? { views: [{ state: "frozen", ySplit }] } : {});
  ws.columns = widths.map((width) => ({ width }));
  return ws;
}

function header(ws: ExcelJS.Worksheet, title: string, labels: string[]) {
  const t = ws.getRow(1);
  t.getCell(1).value = title;
  t.font = { bold: true, size: 14 };
  const r = ws.getRow(HEADER_ROW);
  labels.forEach((l, i) => {
    r.getCell(i + 1).value = l;
    r.getCell(i + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } };
  });
  r.font = { bold: true };
  r.commit();
}

/** The report's two sheets, written row by row (ten years in one request, #198). */
export function intakeWorkbook(report: IntakeReport): StreamedWorkbook {
  const title = reportTitle(report);
  const lines = report.balance.reduce((n, t) => n + t.lines.length, 0);
  const write = async (out: Writable) => {
    const wb = workbookWriter(out);
    (wb as unknown as { title: string }).title = title; // the writer has no typed title, its core properties read it all the same

    const a = sheet(wb, "Bevételek", [12, 22, 24, 12, 14, 30, 14], HEADER_ROW);
    header(a, title, ["Dátum", "Takarmány típusa", "Takarmány", "Mennyiség", "Mértékegység", "Megjegyzés", "Visszaküldve"]);
    for (const [n, i] of report.intake.entries()) {
      const r = a.addRow([new Date(`${i.day}T00:00:00Z`), i.type, i.feed, asNumber(i.quantity), i.unit, i.note, i.returned ? "igen" : ""]);
      r.getCell(1).numFmt = EXCEL_DATE_FORMAT;
      if (i.returned) r.font = { color: { argb: RETURNED_ARGB } };
      r.commit();
      if ((n + 1) % PACE_ROWS === 0) await pace(out, a);
    }
    a.commit();

    // Lili 2026-11-01 (point 7): the balance, a block a feed: its name, the header, a line a unit
    // only column A has a width, as before this file streamed: the seven widths once listed here reached A alone (they were set
    // before the other columns existed)
    const b = sheet(wb, "Egyenleg", [16]);
    b.getRow(1).getCell(1).value = title;
    b.getRow(1).font = { bold: true, size: 14 };
    let at = 3;
    if (report.balance.length === 0) b.getRow(at).getCell(1).value = "Az időszakban nem volt készletmozgás.";
    for (const t of report.balance) {
      const before = t.lines.some((l) => l.beforeStock !== null);
      const name = b.getRow(at);
      name.getCell(1).value = t.feed;
      name.font = { bold: true };
      const labels = ["Mértékegység", "Nyitó", "Bevétel", "Kivétel", ...(before ? ["Készlet előtti kivétel"] : []), "Záró", "Jelzés"];
      const head = b.getRow(at + 1);
      labels.forEach((l, i) => {
        head.getCell(i + 1).value = l;
        head.getCell(i + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } };
      });
      head.font = { bold: true };
      t.lines.forEach((l, i) => {
        b.getRow(at + 2 + i).values = [
          l.unit,
          asNumber(l.opening),
          asNumber(l.received),
          asNumber(l.taken),
          ...(before ? [l.beforeStock === null ? null : asNumber(l.beforeStock)] : []),
          asNumber(l.closing),
          l.negative ? "negatív készlet" : l.low ? "fogyóban" : "",
        ];
      });
      b.getRow(at + 1 + t.lines.length).commit(); // the block's last row, and with it the rows above
      at += t.lines.length + 3;
      await pace(out, b);
    }
    b.commit();
    await finish(wb, out);
  };
  return { rows: report.intake.length + lines, write };
}

/** The report read and checked (a refusal before any byte); the route streams the answer. */
export async function intakeWorkbookOf(f: { from: string; to: string }): Promise<StreamedWorkbook> {
  return intakeWorkbook(await intakeReport(f));
}

/** The report in a buffer (the tests). */
export async function buildIntakeWorkbook(f: { from: string; to: string }): Promise<{ buffer: Buffer; rows: number }> {
  return workbookBuffer(await intakeWorkbookOf(f));
}
