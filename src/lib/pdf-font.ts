// The PDF typeface: DejaVuSans, embedded, never the PDF's built-in (base-14) fonts. Taken over from the Acropora OS
// (apps/api/src/documents/pdf/pdf-font.ts, measured there 2026-09-16 with pdfkit 0.20.2): the built-in fonts use
// WinAnsi, which has no "ő" and "ű", and the failure is SILENT: "ő Ő" is read back as "P", "ű Ű" as "p" (the low
// byte of U+0150 and U+0170), a valid PDF with exit code 0, which looks like a typo, not like an error. Every pool
// name and every parameter with an "ő" (Hőmérséklet, Sűrűség) would be hit. The licence travels with the file
// (assets/fonts/DejaVuSans.LICENSE.txt). The image copies assets/ next to the server (Dockerfile).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const PDF_FONT_PATH = join(process.cwd(), "assets", "fonts", "DejaVuSans.ttf");

let cached: Buffer | null = null;

/** The font's bytes; stops loudly with the path it tried when the file is missing (no fallback to a built-in font). */
export function pdfFont(): Buffer {
  if (cached) return cached;
  if (!existsSync(PDF_FONT_PATH)) {
    throw new Error(`the PDF font is missing: ${PDF_FONT_PATH} (assets/fonts/DejaVuSans.ttf must be next to the server)`);
  }
  cached = readFileSync(PDF_FONT_PATH);
  return cached;
}
