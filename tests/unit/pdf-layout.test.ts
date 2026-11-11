// The server PDFs' tables (Lili 2026-11-11, task caparium-kimutatas-pdf-formazas): pale lines between the rows, a stronger
// line over a total row, and the pale band a table asks for. Measured on the drawing calls, as a PDF's pixels are not here.
import { describe, expect, it, vi } from "vitest";
import { pdfPage } from "@/lib/exports/pdf-layout";

describe("pdfPage().table", () => {
  it("ends every row in a pale line, puts a stronger one over the total, and fills a band row", async () => {
    const page = pdfPage({ title: "Teszt", subtitle: "teszt" });
    const strokes = vi.spyOn(page.doc, "strokeColor");
    const fills = vi.spyOn(page.doc, "fill");
    page.table(
      [100, 100],
      ["Nap", "g"],
      [
        { cells: ["2029.01.10.", "40"] },
        { cells: ["2029.01.11.", "60"], band: true },
        { cells: ["Összesen", "100"], total: true },
      ],
    );
    const colours = strokes.mock.calls.map((c) => c[0]);
    expect(colours.filter((c) => c === "#D9D9D9")).toHaveLength(3); // under each of the three rows, not under the header
    expect(colours.filter((c) => c === "#7F7F7F")).toHaveLength(1); // over the total only
    const filled = fills.mock.calls.map((c) => String(c[0]));
    expect(filled).toContain("#EEF4FA"); // the band
    expect(filled).toContain("#FFF2CC"); // the total, as before
    expect(filled.filter((c) => c === "#EEF4FA")).toHaveLength(1);
    await page.done();
  });
});
