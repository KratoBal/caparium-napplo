// Lili 2026-11-01 (point 13): a tester's reading converted to the value. Pure (the grid converts in the browser, the
// server converts again and stores its own result), exact decimal strings, never floating point (K8).
import { multiplyDecimal, parseDecimalInput } from "./decimal";

/** Rounds a decimal string half away from zero to `decimals`, canonical ("0.7", not "0.70"). */
export function roundDecimal(value: string, decimals: number): string {
  const neg = value.startsWith("-");
  const body = neg ? value.slice(1) : value;
  const [int, frac = ""] = body.split(".");
  const scaled = (BigInt(int + frac.padEnd(decimals + 1, "0").slice(0, decimals + 1)) + 5n) / 10n;
  const digits = scaled.toString().padStart(decimals + 1, "0");
  const i = digits.slice(0, digits.length - decimals) || "0";
  const f = decimals > 0 ? digits.slice(digits.length - decimals).replace(/0+$/, "") : "";
  const out = f ? `${i}.${f}` : i;
  return neg && scaled !== 0n ? `-${out}` : out;
}

export type ReadingConversion = { id: string; label: string; factor: string; decimals: number };

/** The value of a typed reading (comma or point), or null when it is not a number. */
export function convertReading(raw: string, conv: Pick<ReadingConversion, "factor" | "decimals">): string | null {
  const r = parseDecimalInput(raw);
  if (r === null) return null;
  return roundDecimal(multiplyDecimal(r, conv.factor), conv.decimals);
}
