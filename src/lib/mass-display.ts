// A quantity as the pages show it: at most four decimals, a Hungarian comma.
export const plainNumber = (v: number) => String(Math.round(v * 10000) / 10000).replace(".", ",");

const KG_FROM = 1000;

// barracuda on #79, acrobot 37061: a small negative difference rounds to zero, and zero has no sign ("0,00", never "-0,00").
const kilograms = (grams: number) => {
  const text = (grams / 1000).toFixed(2);
  return (Number(text) === 0 ? "0.00" : text).replace(".", ",");
};

/**
 * Lili 2026-10-27 20:49 UTC (acrobot 37044), the "Kivett és kiosztott" table: a gram row in which any value (taken, given,
 * difference) reaches 1000 g is shown in kg as a WHOLE, two decimals ("7,67"), so one row never mixes g and kg. Rows under
 * 1000 g stay in grams, a piece row is untouched. Display only: the export and the stored data stay in grams.
 */
export function rowForDisplay(unit: string, values: readonly number[]): { unit: string; values: string[] } {
  if (unit === "g" && values.some((v) => Math.abs(v) >= KG_FROM))
    return { unit: "kg", values: values.map(kilograms) };
  return { unit, values: values.map(plainNumber) };
}

/**
 * Lili via acrobot 58211 (2026-11-20), the "Kivett és kiosztott" table: the difference as a share of what was taken,
 * (taken - given) / taken * 100, one decimal, a Hungarian comma and a percent sign ("12,5%"). A negative value (more given than taken)
 * stays negative. Where nothing was taken (taken is 0) there is nothing to divide by: `null`, the page shows "nincs kivett"
 * with the reason in the tooltip. A value rounding to zero has no sign ("0,0%", never "-0,0%"), as in `kilograms`.
 * Display only: the export and the stored data are untouched.
 */
export function differencePercent(taken: number, given: number): string | null {
  if (!(taken > 0)) return null;
  const text = (((taken - given) / taken) * 100).toFixed(1);
  return `${(Number(text) === 0 ? "0.0" : text).replace(".", ",")}%`;
}

/**
 * A summary cell of the reports (Lili, package item 12 follow-up, msg 1565472118970257490: "az összesítő sorokban az értékek
 * kg-ba váltva, ahogy máshol"): a gram value from 1000 g up reads in kg, two decimals, with its unit ("7,67 kg"); anything
 * else stays as the column's header says ("850" under "(g)"). Display only: the Excel stays in grams.
 */
export function summaryCell(unit: string, value: number): string {
  return unit === "g" && Math.abs(value) >= KG_FROM ? `${kilograms(value)} kg` : plainNumber(value);
}
