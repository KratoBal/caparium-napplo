// The words and the date shape of the Takarmányhűtő report, apart from the data and the files so both files (and the file
// name) say the same and a unit test reaches them without a database. Lili 2026-10-30 (acrobot 38714, msg 1565707638761725974):
// the document is called "Cápasuli takarmányegyenleg", and a date has dots, not hyphens: 2026.10.30.
export const REPORT_TITLE = "Cápasuli takarmányegyenleg";
/** The file name's base: the title without accents and spaces (the other exports' names are ASCII too). */
export const REPORT_FILE_BASE = "Capasuli_takarmanyegyenleg";

/** "2026-10-30" -> "2026.10.30." */
export const huDay = (day: string): string => `${day.slice(0, 4)}.${day.slice(5, 7)}.${day.slice(8, 10)}.`;

/** The period as the title and the period line show it; one day when the period is one day. */
export const huPeriod = (r: { from: string; to: string }): string => (r.from === r.to ? huDay(r.from) : `${huDay(r.from)} – ${huDay(r.to)}`);

export const reportTitle = (r: { from: string; to: string }): string => `${REPORT_TITLE}: ${huPeriod(r)}`;

/** The Excel number format of a date cell: 2026.10.30. */
export const EXCEL_DATE_FORMAT = 'yyyy"."mm"."dd"."';
