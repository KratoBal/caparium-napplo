// The water measurement PDF (caparium-hibak-4): every Hungarian letter read back exactly, the ő and ű included
// (a built-in PDF font would give "P" and "p"), and a pool's daily and weekly values in their rows.
import { describe, expect, it } from "vitest";
import type { ReportValue } from "@/lib/water-report";
import { waterReportPdf } from "@/lib/water-report-pdf";
import { readPdfColors } from "../support/pdf-colors";
import { readPdfLines } from "../support/pdf-readback";

const v = (over: Partial<ReportValue>): ReportValue => ({
  parameter: "pH",
  value: "8.12",
  unit: "pH",
  day: "2027-09-08",
  time: "08:06",
  by: "TA",
  reference: "IN_RANGE",
  dilution: null,
  diluentWater: null,
  ...over,
});

describe("water report PDF", () => {
  it("reads back letter by letter, ő and ű included, with each pool's daily and weekly rows", async () => {
    const pdf = await waterReportPdf({
      day: "2027-09-08",
      weekFrom: "2027-09-06",
      pools: [
        {
          pool: "Kismedence ŐŰőű áéíóúöü",
          daily: [v({ parameter: "Hőmérséklet", value: "24.5", unit: "°C" }), v({ parameter: "Sűrűség", value: "35.1", unit: "ppt", reference: "HIGH" })],
          weekly: [v({ parameter: "NO3", value: "8.4", unit: "ppm", day: "2027-09-07", dilution: 10, diluentWater: "RO" })],
        },
      ],
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const lines = await readPdfLines(pdf);
    expect(lines).toContain("Cápasuli vízmérés - 2027-09-08");
    expect(lines).toContain("Kismedence ŐŰőű áéíóúöü");
    // no date and no time column (Lili 2026-10-26): the daily row is parameter, value, measurer; the weekly one
    // parameter, value, dilution
    expect(lines).toContain("Hőmérséklet 24,5 °C TA");
    expect(lines).toContain("Sűrűség 35,1 ppt TA magas");
    expect(lines).toContain("NO3 8,4 ppm 1:10 RO");
  });

  // Lili 2026-10-26 (Caparium channel msg 1564350735267921991, point 1): the date and the time are not columns any more.
  // The control: the same report with the old columns would carry "08:06" and "2027-09-07" in a row; the only place
  // the day may stand is the title and the line under it.
  it("has no date or time column, and the column header rows say so", async () => {
    const lines = await readPdfLines(
      await waterReportPdf({
        day: "2027-09-08",
        weekFrom: "2027-09-06",
        pools: [{ pool: "Nagymedence", daily: [v({ parameter: "pH" })], weekly: [v({ parameter: "NO3", day: "2027-09-07", dilution: 10, diluentWater: "RO" })] }],
      }),
    );
    expect(lines.filter((l) => l.includes("08:06"))).toEqual([]);
    expect(lines.filter((l) => l.includes("2027-09-07"))).toEqual([]);
    expect(lines).toContain("Paraméter Érték Mérte Eltérés");
    expect(lines).toContain("Paraméter Érték Hígítás Eltérés");
    expect(lines.some((l) => l.split(" ").some((w) => w === "Idő" || w === "Nap"))).toBe(false);
  });

  it("an empty week says so instead of an empty page", async () => {
    const lines = await readPdfLines(await waterReportPdf({ day: "2027-09-08", weekFrom: "2027-09-06", pools: [] }));
    expect(lines).toContain("Ezen a héten még nincs rögzített vízmérés.");
  });

  // Lili 2026-10-26 (Caparium channel msg 1564304366884626515 and 1564305747733651507, Balázs 1564306307174109245):
  // the pool line, the "Napi mérés" / "Heti mérés" line and the column header row each on their own band, the value
  // rows white, and an out-of-range row in blue (low) or red (high). Read back from the drawing operators.
  describe("colors", () => {
    const report = {
      day: "2027-09-08",
      weekFrom: "2027-09-06",
      pools: [
        {
          pool: "Nagymedence",
          daily: [
            v({ parameter: "Alacsonyparam", value: "1.5", reference: "LOW" }),
            v({ parameter: "Normalparam", value: "8.1", reference: "IN_RANGE" }),
            v({ parameter: "Magasparam", value: "9.9", reference: "HIGH" }),
            v({ parameter: "Nincstartomany", value: "5.0", reference: "NO_RANGE" }),
          ],
          weekly: [v({ parameter: "Hetimagas", value: "14.2", unit: "ppm", day: "2027-09-07", reference: "HIGH" })],
        },
      ],
    };
    const inkOf = (texts: { text: string; color: string }[], word: string) => texts.filter((t) => t.text.includes(word)).map((t) => t.color);

    it("draws the three bands, one per pool line, section line and column header row, and nothing on the value rows", async () => {
      const { fills } = await readPdfColors(await waterReportPdf(report));
      // 1 pool line + 2 section lines (Napi, Heti) + 2 column header rows
      expect(fills.filter((c) => c === "#a9cbd6")).toHaveLength(1);
      expect(fills.filter((c) => c === "#c9dde5")).toHaveLength(2);
      expect(fills.filter((c) => c === "#e6f0f3")).toHaveLength(2);
      // the control: no other filled rectangle, so the value rows (five of them) have no band at all
      expect(fills).toHaveLength(5);
    });

    it("shows a low row in blue, a high row in red, any other row in black, and the header rows keep their ink", async () => {
      const { texts } = await readPdfColors(await waterReportPdf(report));
      expect(new Set(inkOf(texts, "Alacsonyparam"))).toEqual(new Set(["#161dd6"]));
      expect(new Set(inkOf(texts, "Magasparam"))).toEqual(new Set(["#a81715"]));
      expect(new Set(inkOf(texts, "Hetimagas"))).toEqual(new Set(["#a81715"]));
      expect(new Set(inkOf(texts, "Normalparam"))).toEqual(new Set(["#000000"]));
      expect(new Set(inkOf(texts, "Nincstartomany"))).toEqual(new Set(["#000000"]));
      // the column header row keeps its dark gray, the pool name its black
      expect(new Set(inkOf(texts, "Paraméter"))).toEqual(new Set(["#333333"]));
      expect(new Set(inkOf(texts, "Nagymedence"))).toEqual(new Set(["#000000"]));
    });

    // NOT a mutation test: with the guard in band() removed this walk is still green (measured over 480 combinations
    // of row counts), because row() already breaks the page at y > 760 and the last band needs only y <= 777.9; the
    // guard is a safety net with 0.7 pt to spare, and this walk holds the invariant if row heights or margins change.
    // barracuda's review remark (#62): a band is drawn first and its text after; where a section line falls at the
    // foot of a page, the rectangle must not stay on the old page while the text goes to the next. The daily row count
    // is walked through a range that puts the "Heti mérés" line (and the next pool line) at every height near the foot.
    it("keeps every band and its text on the same page, wherever a section line falls", async () => {
      for (let daily = 38; daily <= 56; daily++) {
        const rows = Array.from({ length: daily }, (_, i) => v({ parameter: `P${i}` }));
        const pdf = await waterReportPdf({
          day: "2027-09-08",
          weekFrom: "2027-09-06",
          pools: [
            { pool: "Nagymedence", daily: rows, weekly: [v({ parameter: "W", day: "2027-09-07" })] },
            { pool: "Korallos", daily: [v({ parameter: "K" })], weekly: [] },
          ],
        });
        const { fillPages, textPages } = await readPdfColors(pdf);
        const pageOf = (text: string) => textPages.filter((t) => t.text.includes(text)).map((t) => t.page);
        const bandPages = (color: string) => fillPages.filter((f) => f.color === color).map((f) => f.page);
        expect(bandPages("#a9cbd6"), `pool bands, ${daily} rows`).toEqual([...pageOf("Nagymedence"), ...pageOf("Korallos")]);
        const sections = textPages.filter((t) => t.text === "Napi mérés" || t.text === "Heti mérés").map((t) => t.page);
        expect(bandPages("#c9dde5"), `section bands, ${daily} rows`).toEqual(sections);
      }
    });
  });
});
