// The name given to an "Egyéb" feed ("Spirulina", " spirulina ") is ONE column in the reports and the Excel whatever its
// case or the spaces around and inside it (Lili's package, item 12 follow-up; acrobot 38155, nautilus 38181). The key is
// trimmed, single-spaced and lower case, as the withdrawal side compares names (toLowerCase); the column shows that
// key with a capital first letter. Pure, so a unit test holds it.

export const otherKey = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The form SHOWN for a name: the key with a capital first letter ("Spirulina" for "spirulina", " SPIRULINA "), the same
 * whatever form was met first, so the header does not change from one period to the next (acrobot 38234; the first-met form
 * of the first version depended on the query's order). The rest is the key's lower case.
 */
export function otherLabel(name: string): string {
  const key = otherKey(name);
  return key.charAt(0).toLocaleUpperCase("hu") + key.slice(1);
}
