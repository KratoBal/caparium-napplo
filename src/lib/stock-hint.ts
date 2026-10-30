// The withdrawal form's stock line (Lili 2026-10-29, package item 9: "a takarmánykivétel ebből a készletből von le"):
// under the chosen feed, what is in the freezer now, and a warning when the typed amount is more than that. Only a feed
// with an intake has a stock (feed-intake.ts, "tracked"). A warning, never a refusal: a negative stock is allowed and
// flagged, as the chemicals' (R-16). Pure, so the page's server part and the form share the numbers and a test reaches it.
import { plainNumber, rowForDisplay } from "./mass-display";
import { otherKey } from "./other-name";

export type StockInfo = { feedId: string; /** the other name as a key (otherKey), null for a plain feed */ otherName: string | null; dimension: string; unit: string; level: number };

export type TypedAmount = { dimension: string; /** the typed number in the chosen unit, null when it is not a number yet */ value: number | null; /** the chosen unit's factor to the base unit */ factor: number };

/** The stock lines of one feed (and other name) with a warning for each dimension whose typed amount exceeds it. */
export function stockHint(stock: readonly StockInfo[], feedId: string, otherName: string | null, typed: readonly TypedAmount[]): { text: string; over: boolean }[] {
  const name = otherName?.trim() ? otherKey(otherName) : null;
  return stock
    .filter((s) => s.feedId === feedId && s.otherName === name)
    .map((s) => {
      const shown = rowForDisplay(s.unit, [s.level]);
      const t = typed.find((x) => x.dimension === s.dimension);
      const asked = t?.value != null ? t.value * t.factor : 0;
      const over = asked > 0 && asked > s.level;
      return {
        text: `Készlet: ${shown.values[0]} ${shown.unit}${over ? `. A kivétel (${plainNumber(asked)} ${s.unit}) meghaladja a készletet, negatív készlet lesz.` : ""}`,
        over,
      };
    });
}
