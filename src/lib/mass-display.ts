// A quantity as the pages show it: at most four decimals, a Hungarian comma.
export const plainNumber = (v: number) => String(Math.round(v * 10000) / 10000).replace(".", ",");

const KG_FROM = 1000;

/**
 * Lili 2026-10-27 20:49 UTC (acrobot 37044), the "Kivett és kiosztott" table: a gram row in which any value (taken, given,
 * difference) reaches 1000 g is shown in kg as a WHOLE, two decimals ("7,67"), so one row never mixes g and kg. Rows under
 * 1000 g stay in grams, a piece row is untouched. Display only: the export and the stored data stay in grams.
 */
export function rowForDisplay(unit: string, values: readonly number[]): { unit: string; values: string[] } {
  if (unit === "g" && values.some((v) => Math.abs(v) >= KG_FROM))
    return { unit: "kg", values: values.map((v) => (v / 1000).toFixed(2).replace(".", ",")) };
  return { unit, values: values.map(plainNumber) };
}
