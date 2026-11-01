// The Takarmányhűtő report as Excel (Lili 2026-10-30, acrobot 38557/38558): sheets after the other exports' style (a blue
// header row): the intake with the delivery sent back in red, and the balance, a block a feed (Lili 2026-11-01, point 7).
// The numbers are numbers; the data comes from intakeReport (intake-report.ts), as the PDF's does.
import ExcelJS from "exceljs";
import { intakeReport, type IntakeReport } from "./intake-report";
import { EXCEL_DATE_FORMAT, reportTitle } from "./intake-report-text";

const HEAD = "FFA6CAEC"; // the same header blue as the other exports
/** The red ink of a delivery that was sent back (Lili: "piros betűszínnel", PDF and Excel). */
export const RETURNED_ARGB = "FFC00000";

const asNumber = (shown: string) => Number(shown.replace(/\s/g, "").replace(",", "."));

/** The title row (row 1), an empty row 2, the header row 3, the first row of data under it (Lili 2026-10-30: the document has a title). */
const HEADER_ROW = 3;

function header(ws: ExcelJS.Worksheet, title: string, labels: string[], widths: number[]) {
  const t = ws.getRow(1);
  t.getCell(1).value = title;
  t.font = { bold: true, size: 14 };
  const r = ws.getRow(HEADER_ROW);
  labels.forEach((l, i) => {
    r.getCell(i + 1).value = l;
    r.getCell(i + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } };
  });
  r.font = { bold: true };
  ws.columns.forEach((c, i) => (c.width = widths[i] ?? 12));
  ws.views = [{ state: "frozen", ySplit: HEADER_ROW }];
}

export function intakeWorkbook(report: IntakeReport): { buffer: Promise<ExcelJS.Buffer>; rows: number } {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Cápárium nAPPló";
  wb.created = new Date();
  wb.title = reportTitle(report);
  const title = reportTitle(report);

  const a = wb.addWorksheet("Bevételek");
  header(a, title, ["Dátum", "Takarmány típusa", "Takarmány", "Mennyiség", "Mértékegység", "Megjegyzés", "Visszaküldve"], [12, 22, 24, 12, 14, 30, 14]);
  for (const i of report.intake) {
    const r = a.addRow([new Date(`${i.day}T00:00:00Z`), i.type, i.feed, asNumber(i.quantity), i.unit, i.note, i.returned ? "igen" : ""]);
    r.getCell(1).numFmt = EXCEL_DATE_FORMAT;
    if (i.returned) r.font = { color: { argb: RETURNED_ARGB } };
  }

  // Lili 2026-11-01 (point 7): the balance, a block a feed: its name, the header, a line a unit
  const b = wb.addWorksheet("Egyenleg");
  b.getRow(1).getCell(1).value = title;
  b.getRow(1).font = { bold: true, size: 14 };
  b.columns.forEach((c, i) => (c.width = [16, 14, 14, 14, 26, 14, 18][i] ?? 12));
  let at = 3;
  let lines = 0;
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
    lines += t.lines.length;
    at += t.lines.length + 3;
  }

  return { buffer: wb.xlsx.writeBuffer(), rows: report.intake.length + lines };
}

export async function buildIntakeWorkbook(f: { from: string; to: string }): Promise<{ buffer: Buffer; rows: number }> {
  const built = intakeWorkbook(await intakeReport(f));
  return { buffer: Buffer.from(await built.buffer), rows: built.rows };
}
