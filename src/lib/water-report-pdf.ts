// The water measurement PDF (caparium-hibak-4, item 13): one section per pool, today's daily values and this week's
// weekly values, with the measurer's monogram and the out-of-range mark. Embedded DejaVuSans (src/lib/pdf-font.ts).
import PDFDocument from "pdfkit";
import { pdfFont } from "./pdf-font";
import { waterReportTitle } from "./water-report-text";
import type { ReportValue, WaterReport } from "./water-report";

const hu = (v: string) => v.replace(".", ",");
const MARK: Record<string, string> = { LOW: "alacsony", HIGH: "magas" };

// Lili 2026-10-26 (Caparium channel msg 1564304366884626515): row backgrounds and the ink of an out-of-range row.
// The column header row (Paraméter, Érték, ...) keeps its ink and size and gets the palest background; the value
// rows stay white (Lili's answer to the first sample, msg 1564305747733651507).
const BG_POOL = "#A9CBD6"; // the pool (aquarium) name line
const BG_SECTION = "#C9DDE5"; // the "Napi mérés" / "Heti mérés" line
const BG_HEADER = "#E6F0F3"; // the column header row under "Napi mérés" / "Heti mérés"
const INK_LOW = "#161dd6"; // a row whose value is below the reference range
const INK_HIGH = "#a81715"; // a row whose value is above it
const LEFT = 48;
const WIDTH = 499; // 547 - 48, the printable width of the A4 page with the 48 pt margin

function valueText(v: ReportValue): string {
  return `${hu(v.value)}${v.unit === v.parameter ? "" : ` ${v.unit}`}`;
}

export async function waterReportPdf(report: WaterReport): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: waterReportTitle(report.day), Author: "Cápárium nAPPló" } });
  doc.registerFont("body", pdfFont());
  doc.font("body");
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.fontSize(16).text(waterReportTitle(report.day));
  doc.fontSize(9).fillColor("#555").text(`Napi értékek: ${report.day}. Heti értékek: ${report.weekFrom} – ${report.day}.`);
  doc.fillColor("#000").moveDown();

  if (report.pools.length === 0) {
    doc.fontSize(11).text("Ezen a héten még nincs rögzített vízmérés.");
  }
  // no date and time columns (Lili 2026-10-26): the day is in the title, the week in the line under it
  const cols = [48, 220, 340, 440];
  /** A text line on a colored band: the band is drawn first, then the text on it, 4 pt from the left edge. */
  const band = (text: string, size: number, color: string, ink: string) => {
    const h = doc.fontSize(size).heightOfString(text, { width: WIDTH - 8 });
    // a band is a rectangle plus text: both on the same page, or the rectangle stays behind on the old one
    if (doc.y + h + 4 > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const y = doc.y;
    doc.save().rect(LEFT, y - 2, WIDTH, h + 4).fill(color).restore();
    doc.fontSize(size).fillColor(ink).text(text, LEFT + 4, y, { width: WIDTH - 8 });
    doc.x = LEFT;
    doc.y = y + h + 4;
  };
  const row = (cells: string[], opts: { header?: boolean; reference?: string } = {}) => {
    if (doc.y > 760) doc.addPage();
    const y = doc.y;
    if (opts.header) doc.save().rect(LEFT, y - 2, WIDTH, 14).fill(BG_HEADER).restore();
    const ink = opts.header ? "#333" : opts.reference === "LOW" ? INK_LOW : opts.reference === "HIGH" ? INK_HIGH : "#000";
    doc.fontSize(9).fillColor(ink);
    cells.forEach((c, i) => doc.text(c, cols[i], y, { width: (cols[i + 1] ?? 547) - cols[i] - 6, lineBreak: false }));
    doc.y = y + 14;
    doc.x = 48;
  };
  for (const p of report.pools) {
    if (doc.y > 700) doc.addPage();
    doc.moveDown(0.5);
    band(p.pool, 13, BG_POOL, "#000");
    if (p.daily.length) {
      band("Napi mérés", 10, BG_SECTION, "#333");
      row(["Paraméter", "Érték", "Mérte", "Eltérés"], { header: true });
      for (const v of p.daily) row([v.parameter, valueText(v), v.by, MARK[v.reference] ?? ""], { reference: v.reference });
    }
    if (p.weekly.length) {
      doc.moveDown(0.3);
      band("Heti mérés", 10, BG_SECTION, "#333");
      row(["Paraméter", "Érték", "Hígítás", "Eltérés"], { header: true });
      for (const v of p.weekly) {
        const dil = [v.dilution ? `1:${v.dilution}` : "", v.diluentWater ?? ""].filter(Boolean).join(" ");
        row([v.parameter, valueText(v), dil, MARK[v.reference] ?? ""], { reference: v.reference });
      }
    }
  }
  doc.end();
  return done;
}
