// A row export written row by row into the answer (task caparium-streamelo-excel, after #198): the ten-year exports held the
// whole workbook in memory before the first byte went out (measured on #198: exceljs, 29 200 rows x 8 columns, +183 MB heap).
// ExcelJS's streaming writer commits each row as it is done, so what stays in memory is the row being written and the zip's
// window, whatever the period. What it cannot do is reach back: a committed row is gone, so the column widths and the frozen
// panes go in before the first row, and a total under the rows is summed while they are written.
//
// The work splits in two: the data is read and checked first (a refusal is still a 422, before any byte of a file), then
// `write` produces the file. The route streams it; the tests take it as a buffer.
import { PassThrough, Readable, type Writable } from "node:stream";
import ExcelJS from "exceljs";

export type StreamedWorkbook = { rows: number; write: (out: Writable) => Promise<void> };

/** The writer, with the creator the other exports carry. */
export function workbookWriter(out: Writable): ExcelJS.stream.xlsx.WorkbookWriter {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: true });
  wb.creator = "Cápárium nAPPló";
  wb.created = new Date();
  return wb;
}

/** How many rows go out between two looks at the reader (pace). */
export const PACE_ROWS = 500;

/**
 * The streamed sheet keeps every formula cell it wrote, by address, in case a later cell shares its formula (ExcelJS 4.4.0,
 * WorksheetWriter._formulae, read by the cell's prepare). These exports share none, so the written ones are let go: measured
 * 2026-11-06 (heap snapshot), a year of the feeding log kept its 31 500 SUM cells with their styles, and memory grew with the rows.
 */
function forgetFormulae(ws: ExcelJS.Worksheet) {
  const w = ws as unknown as { _formulae?: Record<string, unknown> };
  if (w._formulae) w._formulae = {};
}

/**
 * Between two batches of rows: lets the written formulae go, gives the zip its turn, and waits while the reader is behind (a slow
 * download stops the rows being made, rather than piling the file up in memory). A reader that went away stops the writing.
 */
export async function pace(out: Writable, ws: ExcelJS.Worksheet): Promise<void> {
  forgetFormulae(ws);
  await new Promise((resolve) => setImmediate(resolve));
  while (out.writableNeedDrain && !out.destroyed) {
    await new Promise<void>((resolve) => {
      const done = () => {
        out.off("drain", done);
        out.off("close", done);
        resolve();
      };
      out.on("drain", done);
      out.on("close", done);
    });
  }
  if (out.destroyed) throw new Error("the export's reader went away");
}

/** The whole file in a buffer: the tests read it back with ExcelJS. */
export async function workbookBuffer(w: StreamedWorkbook): Promise<{ buffer: Buffer; rows: number }> {
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on("data", (c: Buffer) => chunks.push(c));
  await w.write(out);
  return { buffer: Buffer.concat(chunks), rows: w.rows };
}

/** The file as a response body, written while it is read. A failure half way breaks the download; it is not a short file. */
export function workbookBody(w: StreamedWorkbook): ReadableStream<Uint8Array> {
  const out = new PassThrough();
  w.write(out).catch((e: unknown) => {
    console.error("streamed Excel export failed", e);
    out.destroy(e instanceof Error ? e : new Error(String(e)));
  });
  return Readable.toWeb(out) as ReadableStream<Uint8Array>;
}
