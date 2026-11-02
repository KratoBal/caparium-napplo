// The export files' names (Lili 2026-11-01, points 1-4): "capasuli_" and what the file is, then the period. Ascii only, so the
// name survives every browser and mail client the same; a pool's name loses its accents (Kismedence, Karanten).

/** A name as a file name part: no accents, letters and digits, the rest one hyphen. */
export function asciiPart(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** `<base>_<from>` or `<base>_<from>_<to>`, with the extension. */
export function periodFileName(base: string, from: string, to: string, ext: "xlsx" | "pdf"): string {
  return `${base}_${from}${from === to ? "" : `_${to}`}.${ext}`;
}

export const FILE_BASE = {
  feeding: "capasuli_takarmanynaplo",
  eating: "capasuli_evesimintazat",
  withdrawal: "capasuli_takarmanykivetel",
  // Lili 2026-11-02 (task caparium-hutok): the fridges' temperature book
  fridges: "capasuli_hutok_homerseklete",
} as const;

/**
 * The water Excel's base (point 1): `capasuli_teljes_vizmeres` for every pool, else the chosen pools' names, joined by "_",
 * then `_vizmeres`.
 */
export function waterFileBase(poolNames: string[] | null): string {
  if (!poolNames || poolNames.length === 0) return "capasuli_teljes_vizmeres";
  const parts = poolNames.map((n) => asciiPart(n) || "medence");
  return `${parts.join("_")}_vizmeres`;
}
