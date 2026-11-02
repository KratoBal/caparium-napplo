// The look of the server-made PDFs (Lili 2026-11-01, points 5 and 8: "in the style of the other PDFs"): the takarmányegyenleg's
// A4 page, DejaVuSans embedded (pdf-font.ts), a title, a grey period line, blue section bands, tables whose header row has a pale
// band and whose cells wrap inside their column (a row is as tall as its tallest cell). Portrait or landscape.
import PDFDocument from "pdfkit";
import { pdfFont } from "../pdf-font";

const BG_SECTION = "#C9DDE5";
const BG_HEADER = "#E6F0F3";
const BG_TOTAL = "#FFF2CC";

export type PdfPage = {
  doc: PDFKit.PDFDocument;
  /** the usable width between the margins */
  width: number;
  left: number;
  band(text: string): void;
  /** a table: the widths add up to at most `width`; `total` rows stand out like the exports' total rows */
  table(widths: number[], head: string[], rows: { cells: string[]; total?: boolean; align?: ("left" | "right")[]; colors?: (string | null)[] }[]): void;
  note(text: string): void;
  done(): Promise<Buffer>;
};

export function pdfPage(opts: { title: string; subtitle: string; landscape?: boolean }): PdfPage {
  const doc = new PDFDocument({ size: "A4", layout: opts.landscape ? "landscape" : "portrait", margin: 40, info: { Title: opts.title, Author: "Cápárium nAPPló" } });
  doc.registerFont("body", pdfFont());
  doc.font("body");
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  doc.fontSize(16).text(opts.title, { width });
  doc.fontSize(9).fillColor("#555").text(opts.subtitle, { width });
  doc.fillColor("#000").moveDown();

  return {
    doc,
    width,
    left,
    band(text) {
      if (doc.y + 40 > bottom()) doc.addPage();
      const y = doc.y;
      doc.save().rect(left, y - 2, width, 18).fill(BG_SECTION).restore();
      doc.fontSize(11).fillColor("#000").text(text, left + 4, y + 1, { width: width - 8 });
      doc.x = left;
      doc.y = y + 22;
    },
    table(widths, head, rows) {
      const xs = widths.map((_, i) => left + widths.slice(0, i).reduce((a, b) => a + b, 0));
      const total = widths.reduce((a, b) => a + b, 0);
      const line = (cells: string[], o: { header?: boolean; total?: boolean; align?: ("left" | "right")[]; colors?: (string | null)[] }) => {
        doc.fontSize(8.5);
        const h = Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: widths[i] - 6 }))) + 4;
        if (doc.y + h > bottom()) {
          doc.addPage();
          if (!o.header) line(head, { header: true }); // the header again on a new page
        }
        const y = doc.y;
        if (o.header || o.total) doc.save().rect(left, y - 2, total, h).fill(o.header ? BG_HEADER : BG_TOTAL).restore();
        doc.fontSize(8.5).fillColor(o.header ? "#333" : "#000");
        // a cell's own colour (an out-of-range reading in red), back to the row's colour after it
        cells.forEach((c, i) => {
          const own = o.colors?.[i];
          if (own) doc.fillColor(own);
          doc.text(c, xs[i] + 2, y, { width: widths[i] - 6, align: o.align?.[i] ?? "left" });
          if (own) doc.fillColor(o.header ? "#333" : "#000");
        });
        doc.x = left;
        doc.y = y + h;
      };
      line(head, { header: true });
      for (const r of rows) line(r.cells, { total: r.total, align: r.align, colors: r.colors });
      doc.fillColor("#000").moveDown(0.6);
    },
    note(text) {
      doc.fontSize(9).fillColor("#000").text(text, left, doc.y, { width });
      doc.moveDown(0.5);
    },
    done() {
      doc.end();
      return finished;
    },
  };
}
