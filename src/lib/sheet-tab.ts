// TAB ON THE FEEDING SHEET GOES TO THE NEXT ANIMAL (Lili 2026-11-17 08:58 and 09:00 UTC, msgs 1572174069212643329 and
// 1572174532528308336): only the active row has fields, so a Tab from its last field found no other field and landed on
// "Takarmánylap mentése". She types the whole sheet from a numeric keypad, which has no Shift. Tab now makes the next
// animal the active row and puts the focus in its first field, ready to type; Enter still moves along the row
// (lib/enter-next.ts); after the last animal Tab goes on as the browser has it, to the save.

/** The row a Tab moves to from `current`, or null on the last row (or an unknown one): then Tab is left to the browser. */
export function nextRowKey(keys: readonly string[], current: string): string | null {
  const at = keys.indexOf(current);
  if (at < 0 || at === keys.length - 1) return null;
  return keys[at + 1]!;
}

/** The key event slice the rule reads: a plain Tab only, from a field the person types into or ticks. */
export function isPlainTab(e: { key: string; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; target: unknown }): boolean {
  if (e.key !== "Tab" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return false;
  return (e.target as { tagName?: string } | null)?.tagName?.toUpperCase() === "INPUT";
}
