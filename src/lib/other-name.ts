// The name given to an "Egyéb" feed ("Spirulina", " spirulina ") is ONE column in the reports and the Excel whatever its
// case or the spaces around and inside it (Lili's package, item 12 follow-up; acrobot 38155, nautilus 38181). The key is
// trimmed, single-spaced and lower case, as the withdrawal side compares names (toLowerCase); the column shows the form
// first met. Pure, so a unit test holds it.

export const otherKey = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();

/** The form shown for each key: the first one met, in the order given. */
export function firstForms(names: Iterable<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const n of names) {
    const k = otherKey(n);
    if (!out.has(k)) out.set(k, n.trim().replace(/\s+/g, " "));
  }
  return out;
}
