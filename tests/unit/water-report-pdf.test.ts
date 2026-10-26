// The water measurement PDF (caparium-hibak-4): every Hungarian letter read back exactly, the ő and ű included
// (a built-in PDF font would give "P" and "p"), and a pool's daily and weekly values in their rows.
import { describe, expect, it } from "vitest";
import type { ReportValue } from "@/lib/water-report";
import { rangeText, waterReportPdf } from "@/lib/water-report-pdf";
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
  range: null,
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
          daily: [
            v({ parameter: "Hőmérséklet", value: "24.5", unit: "°C", range: { min: "23", max: "26", unit: "°C" } }),
            v({ parameter: "Sűrűség", value: "35.1", unit: "ppt", reference: "HIGH", range: { min: "33", max: "36", unit: "ppt" } }),
          ],
          weekly: [v({ parameter: "NO3", value: "8.4", unit: "ppm", day: "2027-09-07", dilution: 10, diluentWater: "RO", range: { min: null, max: "10", unit: "ppm" } })],
        },
      ],
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const lines = await readPdfLines(pdf);
    expect(lines).toContain("Cápasuli vízmérés - 2027-09-08");
    expect(lines).toContain("Kismedence ŐŰőű áéíóúöü");
    // no date and no time column (Lili 2026-10-26); the same six columns in both tables (msg 1564363895722737696): parameter,
    // value, measurer, dilution, reference, deviation; an empty cell where there is none
    expect(lines).toContain("Hőmérséklet 24,5 °C TA 23 – 26 °C");
    expect(lines).toContain("Sűrűség 35,1 ppt TA 33 – 36 ppt magas");
    expect(lines).toContain("NO3 8,4 ppm TA 1:10 RO ≤ 10 ppm");
  });

  // Lili 2026-10-26 (msg 1564363895722737696): the measurer and the dilution are columns of their own, in the same place in both
  // tables, so a weekly row without a dilution has an EMPTY cell and the reference stays in its column
  it("keeps every cell in its column: the dilution cell is empty where there is none, and the measurer is in both tables", async () => {
    const lines = await readPdfLines(
      await waterReportPdf({
        day: "2027-09-08",
        weekFrom: "2027-09-06",
        pools: [
          {
            pool: "Korallos",
            daily: [v({ parameter: "pH", value: "8.3", by: "LI", range: { min: "8", max: "8.4", unit: "pH" } })],
            weekly: [
              v({ parameter: "Mg", value: "1345", unit: "ppm", by: "LI", range: { min: "1250", max: "1400", unit: "ppm" } }),
              v({ parameter: "PO4", value: "0.98", unit: "ppm", by: "LI", reference: "HIGH", dilution: 10, diluentWater: "SW", range: { min: null, max: "0.1", unit: "ppm" } }),
            ],
          },
        ],
      }),
    );
    expect(lines).toContain("pH 8,3 LI 8 – 8,4");
    expect(lines).toContain("Mg 1345 ppm LI 1250 – 1400 ppm");
    expect(lines).toContain("PO4 0,98 ppm LI 1:10 SW ≤ 0,1 ppm magas");
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

describe("the reference text", () => {
  const r = (parameter: string, range: ReportValue["range"]) => rangeText(v({ parameter, unit: parameter, range }));
  it("is 'min – max unit', '≤ max unit' or '≥ min unit', with the Hungarian comma", () => {
    expect(rangeText(v({ parameter: "Sűrűség", range: { min: "33", max: "36", unit: "ppt" } }))).toBe("33 – 36 ppt");
    expect(rangeText(v({ parameter: "PO4", range: { min: null, max: "0.1", unit: "ppm" } }))).toBe("≤ 0,1 ppm");
    expect(rangeText(v({ parameter: "KH", range: { min: "7", max: null, unit: "dKH" } }))).toBe("≥ 7 dKH");
  });
  it("leaves the unit out where it is the parameter's own name (pH), as the value does, and is empty without a range", () => {
    expect(r("pH", { min: "8", max: "8.4", unit: "pH" })).toBe("8 – 8,4");
    expect(r("pH", null)).toBe("");
    expect(r("pH", { min: null, max: null, unit: "pH" })).toBe("");
  });
});
