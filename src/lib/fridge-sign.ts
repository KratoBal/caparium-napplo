// Lili 2026-11-05: the iPhone's decimal keypad has no minus sign, so a freezer reading (-23..-18 °C) could not be typed. The
// reading field gets a sign button; a FREEZER starts on minus (its range is negative), a fridge on plus. A "-" or "+" the typist
// writes still works (desktop, Android) and WINS over the button: a real warm reading in a freezer is typed with a "+" or by
// pressing the button.
const MINUS = /^[-−]/;
const PLUS = /^\+/;

/** The sign the button starts on for a kind of fridge. */
export const startsNegative = (kind: "FRIDGE" | "FREEZER"): boolean => kind === "FREEZER";

/** Is the reading negative as it stands: an explicit sign in the text wins, else the button's state. */
export function isNegative(text: string, negative: boolean): boolean {
  const t = text.trim();
  if (MINUS.test(t)) return true;
  if (PLUS.test(t)) return false;
  return negative;
}

/** The text as it is saved and checked against the range: the sign applied once, never doubled; an empty field stays empty. */
export function signedTemperature(text: string, negative: boolean): string {
  const t = text.trim();
  if (t === "") return "";
  if (MINUS.test(t)) return `-${t.slice(1).trim()}`;
  if (PLUS.test(t)) return t.slice(1).trim();
  return negative ? `-${t}` : t;
}

/** The sign button: flips the sign, keeps the digits, and leaves the sign in the button's state (the text holds no sign any more). */
export function toggleSign(text: string, negative: boolean): { text: string; negative: boolean } {
  const now = isNegative(text, negative);
  const magnitude = text.trim().replace(/^[-+−]\s*/, "");
  return { text: magnitude, negative: !now };
}
