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
  // Lili 2026-11-18 10:11 UTC (acrobot 55638): seven more, her names and shades; the Hungarian labels are the names she gave
  // (Light Gray, Dusty Teal, Ochre Cream, Stone, Olive Beige, Mushroom, Clay Pink), said in Hungarian
  { key: "LIGHT_GRAY", label: "Világosszürke", bg: "#f6f5f4" },
  { key: "DUSTY_TEAL", label: "Teal", bg: "#cfe4e1" },
  { key: "OCHRE_CREAM", label: "Okker", bg: "#f4e6c8" },
  { key: "STONE", label: "Kőszürke", bg: "#e7e2dd" },
  { key: "OLIVE_BEIGE", label: "Olívabézs", bg: "#dcd6c8" },
  { key: "MUSHROOM", label: "Gomba", bg: "#d7ccc5" },
  { key: "CLAY_PINK", label: "Agyagrózsa", bg: "#e7d4cf" },
] as const;

export type SheetColor = (typeof SHEET_COLORS)[number]["key"];
export const SHEET_COLOR_KEYS = SHEET_COLORS.map((c) => c.key) as [SheetColor, ...SheetColor[]];

/** The row's background, or none for no colour or a key no longer on the palette. */
export function sheetColorBg(key: string | null | undefined): string | null {
  return SHEET_COLORS.find((c) => c.key === key)?.bg ?? null;
}
