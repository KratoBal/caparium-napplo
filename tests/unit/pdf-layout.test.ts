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

  // Lili 2026-11-17: the columns ran into each other (numbers right, headers left)
  it("draws a pale line between every two columns on every row, the header included, and aligns each header like its column", async () => {
    const page = pdfPage({ title: "Teszt", subtitle: "teszt", landscape: true });
    const strokes = vi.spyOn(page.doc, "strokeColor");
    const texts = vi.spyOn(page.doc, "text");
    page.table(
      [120, 80, 80],
      ["Állat vagy csoport", "Scomber scombrus (g)", "Összesen (g)"],
      [
        { cells: ["Philleas", "709", "2,67 kg"], align: ["left", "right", "right"] },
        { cells: ["Összesen", "8,04 kg", "29,91 kg"], total: true, align: ["left", "right", "right"] },
      ],
    );
    // two inner borders a row, three rows (header, a line, the total); none on the outer edges
    expect(strokes.mock.calls.filter((c) => c[0] === "#DDDDDD")).toHaveLength(6);
    // text(string, x, y, options): the spy is typed on the two-argument overload, so the call is read as a plain list
    const alignOf = (text: string) => ((texts.mock.calls as unknown[][]).find((c) => c[0] === text)?.[3] as { align?: string } | undefined)?.align;
    expect([alignOf("Állat vagy csoport"), alignOf("Scomber scombrus (g)"), alignOf("Összesen (g)")]).toEqual(["left", "right", "right"]);
    await page.done();
  });

  it("a table whose rows say nothing about alignment keeps its headers to the left", async () => {
    const page = pdfPage({ title: "Teszt", subtitle: "teszt" });
    const texts = vi.spyOn(page.doc, "text");
    page.table([100, 100], ["Nap", "Megjegyzés"], [{ cells: ["2029.01.10.", "rendben"] }]);
    const header = (texts.mock.calls as unknown[][]).find((c) => c[0] === "Megjegyzés")?.[3] as { align?: string } | undefined;
    expect(header?.align).toBe("left");
    await page.done();
  });
});
