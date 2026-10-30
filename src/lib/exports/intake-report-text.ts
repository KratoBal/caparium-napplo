// The words and the date shape of the Takarmányhűtő report, apart from the data and the files so both files (and the file
// name) say the same and a unit test reaches them without a database. Lili 2026-10-30 (acrobot 38714, msg 1565707638761725974):
// the document is called "Cápasuli takarmányegyenleg", and a date has dots, not hyphens: 2026.10.30.
export const REPORT_TITLE = "Cápasuli takarmányegyenleg";
/** The file name's base: the title without accents and spaces (the other exports' names are ASCII too). */
export const REPORT_FILE_BASE = "Capasuli_takarmanyegyenleg";

import { EXCEL_DATE_FORMAT as DOTTED_EXCEL_DATE_FORMAT, formatDay, formatPeriod } from "../time";

/** "2026-10-30" -> "2026.10.30." (the one formatter of src/lib/time.ts) */
export const huDay = formatDay;

/** The period as the title and the period line show it; one day when the period is one day. */
export const huPeriod = (r: { from: string; to: string }): string => formatPeriod(r.from, r.to);

export const reportTitle = (r: { from: string; to: string }): string => `${REPORT_TITLE}: ${huPeriod(r)}`;

/** The Excel number format of a date cell: 2026.10.30. */
export const EXCEL_DATE_FORMAT = DOTTED_EXCEL_DATE_FORMAT;
