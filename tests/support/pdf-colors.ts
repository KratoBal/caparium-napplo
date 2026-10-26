// The colors of our own PDF, read back from the drawing operators: the fill color of every filled rectangle (the row
// bands) and the fill color each piece of text is shown with. Same idea as pdf-readback.ts: the only check that sees
// what the file really draws, not what the generator meant to draw.
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

export type PdfColors = {
  fills: string[];
  texts: { text: string; color: string }[];
  /** the same, with the page (1-based) each one is drawn on */
  fillPages: { color: string; page: number }[];
  textPages: { text: string; page: number }[];
};

export async function readPdfColors(bytes: Uint8Array): Promise<PdfColors> {
  const task = getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, useSystemFonts: false });
  const pdf = await task.promise;
  const out: PdfColors = { fills: [], texts: [], fillPages: [], textPages: [] };
  for (let n = 1; n <= pdf.numPages; n++) {
    const list = await (await pdf.getPage(n)).getOperatorList();
    let color = "#000000";
    const stack: string[] = [];
    list.fnArray.forEach((fn, i) => {
      const args = list.argsArray[i] as unknown[];
      if (fn === OPS.save) stack.push(color);
      else if (fn === OPS.restore) color = stack.pop() ?? color;
      // pdf.js hands the fill color over as one "#rrggbb" string, and a filled rectangle as a constructPath whose first
      // argument is the paint operator (fill)
      else if (fn === OPS.setFillRGBColor) color = String(args[0]).toLowerCase();
      else if (fn === OPS.constructPath && args[0] === OPS.fill) {
        out.fills.push(color);
        out.fillPages.push({ color, page: n });
      }
      else if (fn === OPS.showText) {
        const glyphs = args[0] as { unicode?: string }[];
        const text = glyphs.map((g) => g.unicode ?? "").join("");
        if (text.trim()) {
          out.texts.push({ text, color });
          out.textPages.push({ text, page: n });
        }
      }
    });
  }
  await task.destroy();
  return out;
}
