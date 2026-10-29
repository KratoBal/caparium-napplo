// The chemical calculator's daily raise limit (Lili 2026-10-29, package item 5b: "how many days to raise it in, not 4 kg
// of calcium at once into a small system, as the aquacalculator did"). The limits are Balázs's professional decision
// (2026-10-29 18:59 UTC, msg 1565439979168071692), per parameter and per system; the pool's system is set in
// Beállítások. Pure: the client-side calculator uses it, and a unit test pins the numbers.

export type SystemType = "CORAL" | "FISH";
export type LimitCode = "CA" | "MG" | "KH";

/** At most this much raise a day, in the parameter's own unit (mg/l for Ca and Mg, dKH for KH). */
export const DAILY_MAX: Record<LimitCode, Record<SystemType, number>> = {
  CA: { CORAL: 10, FISH: 20 },
  KH: { CORAL: 0.5, FISH: 1 },
  MG: { CORAL: 20, FISH: 40 },
};

export const SYSTEM_LABEL: Record<SystemType, string> = { CORAL: "korallos", FISH: "halas" };

/**
 * The raise split into days: as few days as the limit allows, the same amount each day. `totalGrams` is the
 * calculator's whole dose for the raise; null when there is nothing to raise.
 */
export function dailyPlan(code: LimitCode, system: SystemType, current: number, target: number, totalGrams: number): { days: number; perDayGrams: number; perDayRaise: number; max: number } | null {
  const raise = target - current;
  if (!(raise > 0) || !(totalGrams > 0)) return null;
  const max = DAILY_MAX[code][system];
  // a raise exactly at the limit is one day, not two: the epsilon keeps 0.5/0.5 from becoming 1.0000000000000002
  const days = Math.max(1, Math.ceil(raise / max - 1e-9));
  return { days, perDayGrams: totalGrams / days, perDayRaise: raise / days, max };
}
