/**
 * The corner mark of the "Fagyasztók hőmérséklete" tile (Lili 2026-11-03, task caparium-fagyaszto-csempe): on the shown day an
 * active fridge has no reading yet, or a reading is out of its range. Pure, so the page and the tests share one rule.
 * A closed fridge never counts as missing; its old readings still count when out of range (the day's book shows them).
 */
import { translate, type TrVars } from "./i18n/translate";

export type FridgeAlert = { missing: number; out: number };

export function fridgeAlert(
  fridges: { id: string; active: boolean }[],
  readings: { fridgeId: string; outOfRange: boolean }[],
): FridgeAlert | null {
  const read = new Set(readings.map((r) => r.fridgeId));
  const missing = fridges.filter((f) => f.active && !read.has(f.id)).length;
  const out = readings.filter((r) => r.outOfRange).length;
  return missing || out ? { missing, out } : null;
}

/** The mark's text for a screen reader and the tooltip: what is wrong, in one line, in the page's language. */
export function fridgeAlertText(alert: FridgeAlert, tr: (text: string, vars?: TrVars) => string = (t, v) => translate("hu", t, v)): string {
  const parts: string[] = [];
  if (alert.out) parts.push(tr("{n} tartományon kívüli érték", { n: alert.out }));
  if (alert.missing) parts.push(tr("{n} még nincs beírva", { n: alert.missing }));
  return parts.join(", ");
}
