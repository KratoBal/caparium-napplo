// The Takarmányhűtő report as a printable PDF (Lili 2026-10-30, acrobot 38557/38558): the period, the intake (a delivery sent
// back in red), the withdrawals per feed, the closing stock. DejaVuSans embedded (pdf-font.ts), the bands and the A4 page
// of the water report's PDF. The data is intakeReport's, as the Excel's is.
import PDFDocument from "pdfkit";
import { pdfFont } from "../pdf-font";
import { intakeReport, type IntakeReport } from "./intake-report";
import { huDay, huPeriod, reportTitle } from "./intake-report-text";

/** The red ink of a delivery that was sent back, as in the Excel. */
export const RETURNED_INK = "#c00000";
const BG_SECTION = "#C9DDE5";
const BG_HEADER = "#E6F0F3";
const LEFT = 48;
const WIDTH = 499;

/** The title of the document (kept under its earlier name for the callers): "Cápasuli takarmányegyenleg: 2026.10.01. – 2026.10.30.". */
export const intakeTitle = reportTitle;

export async function intakePdfFrom(report: IntakeReport): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: intakeTitle(report), Author: "Cápárium nAPPló" } });
  doc.registerFont("body", pdfFont());
  doc.font("body");
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  doc.fontSize(16).text(intakeTitle(report), { width: WIDTH });
  doc.fontSize(9).fillColor("#555").text(`Időszak: ${huPeriod(report)} A visszaküldött szállítmány pirossal szerepel, a készletbe nem számít.`, { width: WIDTH });
  doc.fillColor("#000").moveDown();

  const band = (text: string) => {
    if (doc.y + 24 > bottom()) doc.addPage();
    const y = doc.y;
    doc.save().rect(LEFT, y - 2, WIDTH, 18).fill(BG_SECTION).restore();
    doc.fontSize(11).fillColor("#000").text(text, LEFT + 4, y + 1, { width: WIDTH - 8 });
    doc.x = LEFT;
    doc.y = y + 22;
  };
  /**
   * A table: each column has a width, each cell WRAPS inside it, and a row is as tall as its tallest cell (a long type or note
   * made a second line that hung into the next band when the row was a fixed 14 pt, Lili's picture of 2026-10-30). The header
   * labels fit their columns, so none breaks in the middle of a word.
   */
  const table = (widths: number[], head: string[], rows: { cells: string[]; red?: boolean }[]) => {
    const xs = widths.map((_, i) => LEFT + widths.slice(0, i).reduce((a, b) => a + b, 0));
    const line = (cells: string[], opts: { header?: boolean; red?: boolean }) => {
      doc.fontSize(9);
      const h = Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: widths[i] - 6 }))) + 4;
      if (doc.y + h > bottom()) doc.addPage();
      const y = doc.y;
      if (opts.header) doc.save().rect(LEFT, y - 2, WIDTH, h).fill(BG_HEADER).restore();
      doc.fontSize(9).fillColor(opts.red ? RETURNED_INK : opts.header ? "#333" : "#000");
      cells.forEach((c, i) => doc.text(c, xs[i] + 2, y, { width: widths[i] - 6 }));
      doc.x = LEFT;
      doc.y = y + h;
    };
    line(head, { header: true });
    for (const r of rows) line(r.cells, { red: r.red });
    doc.fillColor("#000").moveDown(0.5);
  };

  band("Bevételek");
  if (report.intake.length === 0) doc.fontSize(9).text("Az időszakban nem érkezett takarmány.");
  else {
    table(
      [62, 82, 118, 62, 98, 77],
      ["Dátum", "Típus", "Takarmány", "Mennyiség", "Megjegyzés", "Visszaküldve"],
      report.intake.map((i) => ({ cells: [huDay(i.day), i.type, i.feed, `${i.quantity} ${i.unit}`, i.note, i.returned ? "igen" : ""], red: i.returned })),
    );
  }
  band("Kivételek takarmányonként");
  if (report.taken.length === 0) doc.fontSize(9).text("Az időszakban nem volt kivétel.");
  else table([282, 217], ["Takarmány", "Összesen"], report.taken.map((t) => ({ cells: [t.feed, `${t.quantity} ${t.unit}`] })));
  band(`Záró készlet (${huDay(report.to)} végén)`);
  if (report.closing.length === 0) doc.fontSize(9).text("Nincs követett készlet.");
  else
    table(
      [282, 100, 117],
      ["Takarmány", "Készlet", "Jelzés"],
      report.closing.map((k) => ({ cells: [k.feed, `${k.level} ${k.unit}`, k.negative ? "negatív készlet" : k.low ? "fogyóban" : ""] })),
    );

  doc.end();
  return done;
}

export async function buildIntakePdf(f: { from: string; to: string }): Promise<{ buffer: Buffer; rows: number }> {
  const report = await intakeReport(f);
  return { buffer: await intakePdfFrom(report), rows: report.intake.length + report.taken.length + report.closing.length };
}
