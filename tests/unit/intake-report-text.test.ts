import { describe, expect, it } from "vitest";
import { huDay, huPeriod, REPORT_FILE_BASE, reportTitle } from "@/lib/exports/intake-report-text";

// Lili 2026-10-30 (acrobot 38714): the document's title and the date shape, in the PDF, the Excel and the file name.
describe("the report's words", () => {
  it("a date has dots and a closing dot, not hyphens", () => {
    expect(huDay("2026-10-30")).toBe("2026.10.30.");
    expect(huDay("2026-01-05")).toBe("2026.01.05.");
  });

  it("the period and the title: one day or a range, one dot after each date", () => {
    expect(huPeriod({ from: "2026-10-01", to: "2026-10-30" })).toBe("2026.10.01. – 2026.10.30.");
    expect(huPeriod({ from: "2026-10-01", to: "2026-10-01" })).toBe("2026.10.01.");
    expect(reportTitle({ from: "2026-10-01", to: "2026-10-30" })).toBe("Cápasuli takarmányegyenleg: 2026.10.01. – 2026.10.30.");
  });

  it("the file name's base is the title without accents or spaces", () => {
    expect(REPORT_FILE_BASE).toBe("Capasuli_takarmanyegyenleg");
  });
});
