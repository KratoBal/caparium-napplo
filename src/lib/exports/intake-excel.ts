// The Takarmányhűtő report as Excel (Lili 2026-10-30, acrobot 38557/38558): three sheets after the other exports' style
// (a blue header row, a frozen first row): the intake with the delivery sent back in red, the withdrawals per feed, and the
// closing stock. The numbers are numbers; the data comes from intakeReport (intake-report.ts), as the PDF's does.
import ExcelJS from "exceljs";
import { intakeReport, type IntakeReport } from "./intake-report";

const HEAD = "FFA6CAEC"; // the same header blue as the other exports
/** The red ink of a delivery that was sent back (Lili: "piros betűszínnel", PDF and Excel). */
export const RETURNED_ARGB = "FFC00000";

const asNumber = (shown: string) => Number(shown.replace(/\s/g, "").replace(",", "."));

function header(ws: ExcelJS.Worksheet, labels: string[], widths: number[]) {
  const r = ws.getRow(1);
  labels.forEach((l, i) => {
    r.getCell(i + 1).value = l;
    r.getCell(i + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } };
  });
  r.font = { bold: true };
  ws.columns.forEach((c, i) => (c.width = widths[i] ?? 12));
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

export function intakeWorkbook(report: IntakeReport): { buffer: Promise<ExcelJS.Buffer>; rows: number } {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Cápárium nAPPló";
  wb.created = new Date();

  const a = wb.addWorksheet("Bevételek");
  header(a, ["Dátum", "Takarmány típusa", "Takarmány", "Mennyiség", "Mértékegység", "Megjegyzés", "Visszaküldve"], [12, 22, 24, 12, 14, 30, 14]);
  for (const i of report.intake) {
    const r = a.addRow([new Date(`${i.day}T00:00:00Z`), i.type, i.feed, asNumber(i.quantity), i.unit, i.note, i.returned ? "igen" : ""]);
    r.getCell(1).numFmt = "yyyy.mm.dd";
    if (i.returned) r.font = { color: { argb: RETURNED_ARGB } };
  }

  const b = wb.addWorksheet("Kivételek");
  header(b, ["Takarmány", "Mennyiség", "Mértékegység"], [28, 12, 14]);
  for (const t of report.taken) b.addRow([t.feed, asNumber(t.quantity), t.unit]);

  const c = wb.addWorksheet("Záró készlet");
  header(c, ["Takarmány", "Készlet", "Mértékegység", "Jelzés"], [28, 12, 14, 18]);
  for (const k of report.closing) c.addRow([k.feed, asNumber(k.level), k.unit, k.negative ? "negatív készlet" : k.low ? "fogyóban" : ""]);

  return { buffer: wb.xlsx.writeBuffer(), rows: report.intake.length + report.taken.length + report.closing.length };
}

export async function buildIntakeWorkbook(f: { from: string; to: string }): Promise<{ buffer: Buffer; rows: number }> {
  const built = intakeWorkbook(await intakeReport(f));
  return { buffer: Buffer.from(await built.buffer), rows: built.rows };
}
