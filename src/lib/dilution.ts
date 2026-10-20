// Which parameters take a dilution and a diluent water (RO/SW) in the weekly measurement: only the nitrate and
// the phosphate, in every pool (Balázs 2026-10-20 07:50 UTC, msg 1562010119061901334; task caparium-hibak-1).
// The other weekly values (KH, Mg, Ca) are measured undiluted. Keyed by the parameter code, which an admin's
// rename does not change. Shared by the server check (src/lib/measurements.ts) and the grid.
export const DILUTION_PARAMETER_CODES: readonly string[] = ["NO3", "PO4"];

export function takesDilution(parameterCode: string): boolean {
  return DILUTION_PARAMETER_CODES.includes(parameterCode);
}
