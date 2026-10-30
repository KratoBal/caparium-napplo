// The Takarmányhűtő report as a printable PDF (Lili 2026-10-30, acrobot 38557/38558): the period, the intake (a delivery sent
// back in red), the withdrawals per feed, the closing stock. DejaVuSans embedded (pdf-font.ts), the bands and the A4 page
// of the water report's PDF. The data is intakeReport's, as the Excel's is.
import PDFDocument from "pdfkit";
import { pdfFont } from "../pdf-font";
import { formatDayLong } from "../time";
import { intakeReport, type IntakeReport } from "./intake-report";

/** The red ink of a delivery that was sent back, as in the Excel. */
export const RETURNED_INK = "#c00000";
const BG_SECTION = "#C9DDE5";
const BG_HEADER = "#E6F0F3";
const LEFT = 48;
const WIDTH = 499;

export function intakeTitle(r: Pick<IntakeReport, "from" | "to">): string {
  return r.from === r.to ? `Takarmányhűtő: ${r.from}` : `Takarmányhűtő: ${r.from} – ${r.to}`;
}

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

  doc.fontSize(16).text(intakeTitle(report));
  doc.fontSize(9).fillColor("#555").text(`Időszak: ${formatDayLong(report.from)} – ${formatDayLong(report.to)}. A visszaküldött szállítmány pirossal szerepel, a készletbe nem számít.`);
  doc.fillColor("#000").moveDown();

  const band = (text: string) => {
    if (doc.y > 740) doc.addPage();
    const y = doc.y;
    doc.save().rect(LEFT, y - 2, WIDTH, 18).fill(BG_SECTION).restore();
    doc.fontSize(11).fillColor("#000").text(text, LEFT + 4, y + 1, { width: WIDTH - 8 });
    doc.x = LEFT;
    doc.y = y + 22;
  };
  const table = (cols: number[], head: string[], rows: { cells: string[]; red?: boolean }[]) => {
    const line = (cells: string[], opts: { header?: boolean; red?: boolean }) => {
      if (doc.y > 770) doc.addPage();
      const y = doc.y;
      if (opts.header) doc.save().rect(LEFT, y - 2, WIDTH, 14).fill(BG_HEADER).restore();
      doc.fontSize(9).fillColor(opts.red ? RETURNED_INK : opts.header ? "#333" : "#000");
      cells.forEach((c, i) => doc.text(c, cols[i], y, { width: (cols[i + 1] ?? LEFT + WIDTH) - cols[i] - 4, lineBreak: false, ellipsis: true }));
      doc.x = LEFT;
      doc.y = y + 14;
    };
    line(head, { header: true });
    for (const r of rows) line(r.cells, { red: r.red });
    doc.fillColor("#000").moveDown(0.5);
  };

  band("Bevételek");
  if (report.intake.length === 0) doc.fontSize(9).text("Az időszakban nem érkezett takarmány.");
  else {
    table(
      [48, 110, 172, 302, 357, 487],
      ["Dátum", "Típus", "Takarmány", "Mennyiség", "Megjegyzés", "Visszaküldve"],
      report.intake.map((i) => ({ cells: [i.day, i.type, i.feed, `${i.quantity} ${i.unit}`, i.note, i.returned ? "igen" : ""], red: i.returned })),
    );
  }
  band("Kivételek takarmányonként");
  if (report.taken.length === 0) doc.fontSize(9).text("Az időszakban nem volt kivétel.");
  else table([48, 330], ["Takarmány", "Összesen"], report.taken.map((t) => ({ cells: [t.feed, `${t.quantity} ${t.unit}`] })));
  band(`Záró készlet (${report.to} végén)`);
  if (report.closing.length === 0) doc.fontSize(9).text("Nincs követett készlet.");
  else
    table(
      [48, 330, 430],
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
