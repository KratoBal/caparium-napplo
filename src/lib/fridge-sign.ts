// Lili 2026-11-05: the iPhone's decimal keypad has no minus sign, so a freezer reading (-23..-18 °C) could not be typed. The
// reading field gets a sign button; a FREEZER starts on minus (its range is negative), a fridge on plus. A "-" or "+" the typist
// writes still works (desktop, Android) and WINS over the button: a real warm reading in a freezer is typed with a "+" or by
// pressing the button.
const MINUS = /^[-−]/;
const PLUS = /^\+/;
// every sign character at the front (a typed "--5" or "-+5" is one sign, the FIRST one, and the digits)
const LEADING_SIGNS = /^[-+−\s]+/;

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
  const explicit = MINUS.test(t) || PLUS.test(t);
  const rest = t.replace(LEADING_SIGNS, "");
  // a sign with no digits after it yet ("-" typed on its own) is not a value: empty, so the save stays off
  if (explicit && rest === "") return "";
  if (explicit) return MINUS.test(t) ? `-${rest}` : rest;
  return negative ? `-${t}` : t;
}

/** Is there a digit to save: a lone sign, or letters, are not a reading (the save button stays off). */
export const hasDigit = (signed: string): boolean => /\d/.test(signed);

/** The sign button: flips the sign, keeps the digits, and leaves the sign in the button's state (the text holds no sign any more). */
export function toggleSign(text: string, negative: boolean): { text: string; negative: boolean } {
  const now = isNegative(text, negative);
  const magnitude = text.trim().replace(LEADING_SIGNS, "");
  return { text: magnitude, negative: !now };
}
