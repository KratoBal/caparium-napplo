// Exact decimal handling for measured values (adatmodell K8: no floating point in storage).
// Values travel as strings; comparison uses scaled BigInt, never Number.

export type ParsedDecimal = { text: string };

const DECIMAL_RE = /^[+-]?\d+(\.\d+)?$/;

/**
 * Parses user input: accepts "," or "." as the decimal separator and surrounding spaces (JAV-02).
 * Returns the canonical string ("8.12") or null if the input is not a plain decimal number.
 */
export function parseDecimalInput(raw: string, maxDecimals = 4): string | null {
  const s = raw.trim().replace(/\s+/g, "").replace(",", ".");
  if (!DECIMAL_RE.test(s)) return null;
  const [, frac = ""] = s.split(".");
  if (frac.length > maxDecimals) return null;
  if (s.replace(/^[+-]/, "").split(".")[0].length > 10) return null;
  return s.startsWith("+") ? s.slice(1) : s;
}

const SCALE = 10;

function toScaled(value: string): bigint {
  const neg = value.startsWith("-");
  const body = neg ? value.slice(1) : value;
  const [int, frac = ""] = body.split(".");
  const scaled = BigInt(int + frac.padEnd(SCALE, "0").slice(0, SCALE));
  return neg ? -scaled : scaled;
}

export function compareDecimal(a: string, b: string): number {
  const x = toScaled(a);
  const y = toScaled(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Multiplies a decimal string by a decimal factor string, exactly, returning a decimal string. */
export function multiplyDecimal(a: string, factor: string): string {
  const product = toScaled(a) * toScaled(factor);
  const neg = product < 0n;
  const abs = neg ? -product : product;
  const digits = abs.toString().padStart(2 * SCALE + 1, "0");
  const int = digits.slice(0, digits.length - 2 * SCALE);
  const frac = digits.slice(digits.length - 2 * SCALE).replace(/0+$/, "");
  return `${neg ? "-" : ""}${int}${frac ? "." + frac : ""}`;
}

/** Display with a fixed number of decimals and a Hungarian decimal comma. Rounds half away from zero. */
export function formatDecimalHu(value: string, decimals: number): string {
  const neg = value.startsWith("-");
  const body = neg ? value.slice(1) : value;
  const [int, frac = ""] = body.split(".");
  let scaled = BigInt(int + frac.padEnd(decimals + 1, "0").slice(0, decimals + 1));
  // round on the extra digit
  scaled = (scaled + 5n) / 10n;
  let digits = scaled.toString().padStart(decimals + 1, "0");
  const i = digits.slice(0, digits.length - decimals) || "0";
  const f = decimals > 0 ? digits.slice(digits.length - decimals) : "";
  digits = f ? `${i},${f}` : i;
  return neg && scaled !== 0n ? `-${digits}` : digits;
}

/** Canonical string of a Prisma Decimal (or anything with toString) without trailing zeros. */
export function canonicalDecimal(v: { toString(): string } | string): string {
  const s = typeof v === "string" ? v : v.toString();
  if (!s.includes(".")) return s;
  return s.replace(/0+$/, "").replace(/\.$/, "");
}
