// The water measurement PDF (caparium-hibak-4, item 13): one section per pool, today's daily values and this week's
// weekly values, with the measurer's monogram and the out-of-range mark. Embedded DejaVuSans (src/lib/pdf-font.ts).
import PDFDocument from "pdfkit";
import { pdfFont } from "./pdf-font";
import type { ReportValue, WaterReport } from "./water-report";

const hu = (v: string) => v.replace(".", ",");
const MARK: Record<string, string> = { LOW: "alacsony", HIGH: "magas" };

function valueText(v: ReportValue): string {
  return `${hu(v.value)}${v.unit === v.parameter ? "" : ` ${v.unit}`}`;
}

export async function waterReportPdf(report: WaterReport): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Vízmérés ${report.day}`, Author: "Cápárium nAPPló" } });
  doc.registerFont("body", pdfFont());
  doc.font("body");
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.fontSize(16).text(`Vízmérés – ${report.day}`);
  doc.fontSize(9).fillColor("#555").text(`Napi értékek: ${report.day}. Heti értékek: ${report.weekFrom} – ${report.day}.`);
  doc.fillColor("#000").moveDown();

  if (report.pools.length === 0) {
    doc.fontSize(11).text("Ezen a héten még nincs rögzített vízmérés.");
  }
  const cols = [48, 200, 300, 360, 420];
  const row = (cells: string[], bold = false) => {
    if (doc.y > 760) doc.addPage();
    const y = doc.y;
    doc.fontSize(9).fillColor(bold ? "#333" : "#000");
    cells.forEach((c, i) => doc.text(c, cols[i], y, { width: (cols[i + 1] ?? 547) - cols[i] - 6, lineBreak: false }));
    doc.y = y + 14;
    doc.x = 48;
  };
  for (const p of report.pools) {
    if (doc.y > 700) doc.addPage();
    doc.moveDown(0.5).fontSize(13).fillColor("#000").text(p.pool, 48);
    if (p.daily.length) {
      doc.fontSize(10).fillColor("#333").text("Napi mérés", 48);
      row(["Paraméter", "Érték", "Idő", "Mérte", "Eltérés"], true);
      for (const v of p.daily) row([v.parameter, valueText(v), v.time, v.by, MARK[v.reference] ?? ""]);
    }
    if (p.weekly.length) {
      doc.moveDown(0.3).fontSize(10).fillColor("#333").text("Heti mérés", 48);
      row(["Paraméter", "Érték", "Nap", "Hígítás", "Eltérés"], true);
      for (const v of p.weekly) {
        const dil = [v.dilution ? `1:${v.dilution}` : "", v.diluentWater ?? ""].filter(Boolean).join(" ");
        row([v.parameter, valueText(v), v.day, dil, MARK[v.reference] ?? ""]);
      }
    }
  }
  doc.end();
  return done;
}
