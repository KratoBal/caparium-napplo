// The text read back from our own PDF, line by line: the only check that measures the typeface (taken over from the
// Acropora OS, apps/api/src/documents/pdf/pdf-text-readback.ts). A built-in font turns "ő" into "P" and "ű" into "p"
// in a valid PDF with exit code 0; only reading the output back shows it. Pieces are grouped by their vertical place
// (a missing glyph splits a line into pieces), and system fonts are off, so nothing can stand in for a missing glyph.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function readPdfLines(bytes: Uint8Array): Promise<string[]> {
  const task = getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, useSystemFonts: false });
  const pdf = await task.promise;
  const lines: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const item of content.items) {
      if (!("str" in item) || !item.str) continue;
      const y = Math.round(item.transform[5]);
      const key = [...rows.keys()].find((k) => Math.abs(k - y) <= 1) ?? y;
      rows.set(key, [...(rows.get(key) ?? []), { x: item.transform[4], s: item.str }]);
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      lines.push(rows.get(y)!.sort((a, b) => a.x - b.x).map((p) => p.s).join(" ").replace(/\s+/g, " ").trim());
    }
  }
  await task.destroy();
  return lines;
}
