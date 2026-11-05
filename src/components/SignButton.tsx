"use client";

// The big, finger-sized sign button beside a number field (Lili 2026-11-05): the phone's decimal keypad has no minus sign. It shows the
// current sign as a character (not only a colour) and flips it; the sign logic is in src/lib/fridge-sign.ts.
import { isNegative, toggleSign } from "@/lib/fridge-sign";

export function SignButton({
  name,
  text,
  negative,
  onToggle,
  label = "előjel váltása",
}: {
  name: string;
  text: string;
  negative: boolean;
  onToggle: (next: { text: string; negative: boolean }) => void;
  label?: string;
}) {
  const minus = isNegative(text, negative);
  return (
    <button
      className="btn btn-soft sign-btn"
      type="button"
      aria-label={`${name}: ${label}`}
      aria-pressed={minus}
      data-testid="sign-toggle"
      onClick={() => onToggle(toggleSign(text, negative))}
    >
      {minus ? "\u2212" : "+"}
    </button>
  );
}
