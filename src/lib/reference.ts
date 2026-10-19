// Reference-range evaluation (VIZ-02, DN-08, T-03).
// The range is per parameter; a value outside it is shown red with the range next to it.

import { compareDecimal, multiplyDecimal } from "./decimal";

export type UnitInfo = { id: string; dimension: string; factorToBase: string | null };
export type RangeInfo = { min: string | null; max: string | null; unit: UnitInfo };

export type ReferenceStatus = "IN_RANGE" | "LOW" | "HIGH" | "NO_RANGE" | "INCOMPARABLE";

function toBase(value: string, unit: UnitInfo): string | null {
  if (unit.factorToBase === null) return null;
  return multiplyDecimal(value, unit.factorToBase);
}

/**
 * Compares a value (in its own snapshot unit) to a range (in the range's unit).
 * Same unit: compared directly. Same dimension with factors: compared in the base unit.
 * Anything else is INCOMPARABLE: the UI must not colour it either way.
 */
export function evaluateReference(value: string, valueUnit: UnitInfo, range: RangeInfo | null): ReferenceStatus {
  if (!range || (range.min === null && range.max === null)) return "NO_RANGE";
  let v = value;
  let min = range.min;
  let max = range.max;
  if (range.unit.id !== valueUnit.id) {
    if (range.unit.dimension !== valueUnit.dimension) return "INCOMPARABLE";
    const vb = toBase(value, valueUnit);
    const minB = min === null ? null : toBase(min, range.unit);
    const maxB = max === null ? null : toBase(max, range.unit);
    if (vb === null || (min !== null && minB === null) || (max !== null && maxB === null)) return "INCOMPARABLE";
    v = vb;
    min = minB;
    max = maxB;
  }
  if (min !== null && compareDecimal(v, min) < 0) return "LOW";
  if (max !== null && compareDecimal(v, max) > 0) return "HIGH";
  return "IN_RANGE";
}

export function isOutOfRange(status: ReferenceStatus): boolean {
  return status === "LOW" || status === "HIGH";
}
