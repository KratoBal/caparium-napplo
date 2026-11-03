// C12 of the old-date survey (2026-11-02): the export periods. WHAT TURNS RED: a limit off by one day (the both-ends
// count); the ten years not covering the history since 2018-12-07; the refusal naming the wrong limit.
import { describe, expect, it } from "vitest";
import { periodDays, periodTooLongText, ROW_EXPORT_MAX_DAYS, YEAR_EXPORT_MAX_DAYS } from "@/lib/exports/period-limit";

describe("the export period limits", () => {
  it("counts both ends, so a leap year is 366 days and a year limit takes it", () => {
    expect(periodDays("2024-01-01", "2024-12-31")).toBe(366);
    expect(periodDays("2026-11-03", "2026-11-03")).toBe(1);
    expect(periodDays("2024-01-01", "2024-12-31")).toBeLessThanOrEqual(YEAR_EXPORT_MAX_DAYS);
  });

  it("ten years cover the history since 2018-12-07 with room", () => {
    expect(periodDays("2018-12-07", "2028-12-06")).toBeLessThanOrEqual(ROW_EXPORT_MAX_DAYS);
  });

  it("the refusal names its own limit", () => {
    expect(periodTooLongText(ROW_EXPORT_MAX_DAYS)).toBe("Legfeljebb tíz év kérhető le egyszerre.");
    expect(periodTooLongText(YEAR_EXPORT_MAX_DAYS)).toBe("Legfeljebb egy év kérhető le egyszerre.");
  });
});
