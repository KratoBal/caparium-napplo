// The water measurement PDF (caparium-hibak-4): every Hungarian letter read back exactly, the ő and ű included
// (a built-in PDF font would give "P" and "p"), and a pool's daily and weekly values in their rows.
import { describe, expect, it } from "vitest";
import type { ReportValue } from "@/lib/water-report";
import { waterReportPdf } from "@/lib/water-report-pdf";
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
});
