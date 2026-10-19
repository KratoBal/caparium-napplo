// The calculator's arithmetic and the deviation rule (KALK-01, EGY-08), pure: the server stores what it
// computes here, and the pages show the same numbers live. NY-15 / D-16 defaults are temporary.

import { AppError } from "./errors";

export const FR_STEP = 0.5; // NY-15 default
export const DEVIATION = 0.2; // NY-15 default: ±20 %

const round4 = (v: number) => Math.round(v * 10000) / 10000;

export type CalcResult = { frDayPct: number; fKg: number; fG: number; fwG: number };

/** KALK-01, pure: the outputs from BW, FR a week and N. Refuses inputs outside the description's lists. */
export function calculate(bwKg: number, frWeekPct: number, nWeek: number): CalcResult {
  if (!(bwKg > 0) || !Number.isFinite(bwKg)) throw new AppError(422, "BW", "A testtömeg pozitív szám legyen (kg).");
  if (frWeekPct < 1 || frWeekPct > 8 || Math.abs(frWeekPct / FR_STEP - Math.round(frWeekPct / FR_STEP)) > 1e-9) {
    throw new AppError(422, "FR", `A heti FR 1 és 8 között, ${String(FR_STEP).replace(".", ",")} lépésközzel választható.`);
  }
  if (!Number.isInteger(nWeek) || nWeek < 1 || nWeek > 7) throw new AppError(422, "N", "A heti etetésszám 1 és 7 között legyen.");
  const fKg = (frWeekPct * bwKg) / 100 / nWeek;
  return { frDayPct: round4(frWeekPct / 7), fKg: round4(fKg), fG: round4(fKg * 1000), fwG: round4(fKg * 1000 * nWeek) };
}

/** EGY-08: does a day's amount deviate roughly from the reference? */
export function deviates(givenG: number, referenceG: number, threshold = DEVIATION): boolean {
  if (!(referenceG > 0)) return false;
  return Math.abs(givenG - referenceG) / referenceG > threshold + 1e-9;
}

