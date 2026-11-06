// The streamed Excel (task caparium-streamelo-excel, src/lib/exports/xlsx-stream.ts). WHAT TURNS RED: the writer keeps every formula
// cell it wrote again (a later ExcelJS renames the store pace empties, and ten years of the feeding log grow with their SUM cells);
// a slow reader no longer holds the rows back; a reader that went away does not stop the writing, or (barracuda on #206) one that
// goes after the last pace leaves the write pending for good; the file read back is not the one written.
import { PassThrough, Writable } from "node:stream";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { finish, pace, PACE_ROWS, workbookBody, workbookBuffer, workbookWriter, type StreamedWorkbook } from "@/lib/exports/xlsx-stream";

/** n rows of a value and a SUM over it, paced as the exports pace; `seen` gets the formula store's size at each pace. */
function book(n: number, seen: number[] = []): StreamedWorkbook {
  return {
    rows: n,
    write: async (out) => {
      const wb = workbookWriter(out);
      const ws = wb.addWorksheet("Lap");
      for (let i = 1; i <= n; i++) {
        const r = ws.getRow(i);
        r.getCell(1).value = i;
        r.getCell(2).value = { formula: `SUM(A${i})`, result: i };
        r.commit();
        if (i % PACE_ROWS === 0) {
          await pace(out, ws);
          seen.push(Object.keys((ws as unknown as { _formulae: Record<string, unknown> })._formulae).length);
        }
      }
      ws.commit();
      await finish(wb, out);
    },
  };
}

describe("the streamed Excel", () => {
  it("the file read back is the one written, the formulas with their results", async () => {
    const { buffer, rows } = await workbookBuffer(book(1201));
    expect(rows).toBe(1201);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Lap")!;
    expect(ws.rowCount).toBe(1201);
    expect(ws.getRow(1201).getCell(1).value).toBe(1201);
    expect(ws.getRow(1201).getCell(2).value).toEqual({ formula: "SUM(A1201)", result: 1201 });
    expect(wb.creator).toBe("Cápárium nAPPló");
  });

  it("the written formulae are let go at every pace: the store never holds more than a batch", async () => {
    const seen: number[] = [];
    await workbookBuffer(book(3 * PACE_ROWS, seen));
    // emptied before the zip's turn; the rows of a batch are the most it can hold
    expect(seen).toEqual([0, 0, 0]);
  });

  it("pace waits while the reader is behind, and goes on when it has drained", async () => {
    let release = () => {};
    const out = new Writable({ highWaterMark: 4, write: (_c, _e, cb) => (release = () => cb()) });
    out.write(Buffer.alloc(16));
    expect(out.writableNeedDrain).toBe(true);
    let done = false;
    const paced = pace(out, {} as ExcelJS.Worksheet).then(() => (done = true));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(done).toBe(false);
    release();
    await paced;
    expect(done).toBe(true);
  });

  it.each(["before the sheet's commit", "before the book's commit", "while the zip is closing"] as const)(
    "a reader gone after the last pace, %s: the write fails, it does not hang",
    async (when) => {
      const out = new PassThrough();
      out.on("data", () => {});
      const write = (async () => {
        const wb = workbookWriter(out);
        const ws = wb.addWorksheet("Lap");
        for (let i = 1; i <= 2 * PACE_ROWS + 200; i++) {
          ws.getRow(i).getCell(1).value = i;
          ws.getRow(i).commit();
          if (i % PACE_ROWS === 0) await pace(out, ws);
        }
        if (when === "before the sheet's commit") out.destroy();
        ws.commit();
        if (when === "before the book's commit") out.destroy();
        if (when === "while the zip is closing") setImmediate(() => out.destroy());
        await finish(wb, out);
      })();
      const settled = await Promise.race([
        write.then(
          () => "resolved",
          (e: Error) => e.message,
        ),
        new Promise((resolve) => setTimeout(() => resolve("pending"), 3000)),
      ]);
      expect(settled).toBe("the export's reader went away");
    },
  );

  it("a reader that went away stops the writing, and the body ends in an error, not a short file", async () => {
    const out = new PassThrough();
    out.destroy();
    await expect(pace(out, {} as ExcelJS.Worksheet)).rejects.toThrow("went away");

    const body = workbookBody({ rows: 1, write: async () => Promise.reject(new Error("half way")) });
    const reader = body.getReader();
    await expect(reader.read()).rejects.toThrow("half way");
  });
});
