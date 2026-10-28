// Lili 2026-10-28 13:49 UTC (acrobot 37542): an animal or a group may have a background colour, set in Beállítások,
// that colours its row on the feeding sheet and nowhere else. Display only, like the icons (DAT-03): no export
// carries it, and none is the default. A narrow palette, every shade light enough that the ink stays readable
// (at least 7:1 against --c-ink, sheet-color-palette.test.ts), and none the highlighted row's ink or the header's tint.
// Kept apart from sheet-colors.ts so the sheet (a client component) can read it without the database.

export const SHEET_COLORS = [
  { key: "GREEN", label: "Zöld", bg: "#d9ecd9" },
  { key: "BLUE", label: "Kék", bg: "#d5e5f5" },
  { key: "YELLOW", label: "Sárga", bg: "#f7edbf" },
  { key: "ORANGE", label: "Narancs", bg: "#f9dcc3" },
  { key: "PINK", label: "Rózsaszín", bg: "#f6d7e2" },
  { key: "PURPLE", label: "Lila", bg: "#e4dbf2" },
] as const;

export type SheetColor = (typeof SHEET_COLORS)[number]["key"];
export const SHEET_COLOR_KEYS = SHEET_COLORS.map((c) => c.key) as [SheetColor, ...SheetColor[]];

/** The row's background, or none for no colour or a key no longer on the palette. */
export function sheetColorBg(key: string | null | undefined): string | null {
  return SHEET_COLORS.find((c) => c.key === key)?.bg ?? null;
}
