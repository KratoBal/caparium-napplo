// THE LONGEST PERIOD AN EXPORT TAKES IN ONE REQUEST (C12 of the old-date survey, 2026-11-02). The history is kept since
// 2018-12-07 and Lili keys it in back in time, so a year at a time meant eight requests for one table. The row exports
// (a row per day or item) take ten years: measured 2026-11-03 on synthetic rows, exceljs with 29 200 rows x 8 columns
// peaked at +183 MB heap, pdfkit with 29 200 table rows at +18 MB and 1.6 s (it streams). Two keep a year, for their
// layout, not their size: the eating pattern has a column per day, and the withdrawal summary a pie chart per week.

import { dayToDate } from "../time";

/** Ten years: the whole history since 2018-12-07 in one request, with room. */
export const ROW_EXPORT_MAX_DAYS = 3660;
/** A year: the exports whose layout grows with the days (a column or a chart per period). */
export const YEAR_EXPORT_MAX_DAYS = 366;

/** The days of a period, both ends counted. */
export function periodDays(from: string, to: string): number {
  return (dayToDate(to).getTime() - dayToDate(from).getTime()) / 86_400_000 + 1;
}

/** The refusal's sentence for a limit. */
export function periodTooLongText(maxDays: number): string {
  return maxDays === ROW_EXPORT_MAX_DAYS ? "Legfeljebb tíz év kérhető le egyszerre." : "Legfeljebb egy év kérhető le egyszerre.";
}
