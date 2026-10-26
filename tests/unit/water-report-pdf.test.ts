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
    expect(lines).toContain("Vízmérés – 2027-09-08");
    expect(lines).toContain("Kismedence ŐŰőű áéíóúöü");
    expect(lines).toContain("Hőmérséklet 24,5 °C 08:06 TA");
    expect(lines).toContain("Sűrűség 35,1 ppt 08:06 TA magas");
    expect(lines).toContain("NO3 8,4 ppm 2027-09-07 1:10 RO");
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
  });
});
