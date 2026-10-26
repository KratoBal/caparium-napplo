// The animals of a feeding day: their order and their lines in the "Ki eszik ma" chooser. Pure, so the
// order and the grouping are tested without a page.
export type ChooserAnimal = { id: string; name: string; poolName: string | null };

/** Lili 2026-10-26 (card f67b1a06, item 2): by pool, the pool-less last, then by name. */
export function sortDayAnimals<T extends ChooserAnimal>(animals: T[]): T[] {
  // an explicit "no pool" step: a "~" sentinel sorts FIRST under the Hungarian collation (punctuation before letters)
  return [...animals].sort(
    (x, y) =>
      Number(x.poolName === null) - Number(y.poolName === null) ||
      (x.poolName ?? "").localeCompare(y.poolName ?? "", "hu") ||
      x.name.localeCompare(y.name, "hu"),
  );
}

export const NO_POOL = "Medence nélkül";

/** One line per pool, in the order the animals arrive (sorted by `sortDayAnimals`). */
export function chooserPools<T extends ChooserAnimal>(animals: T[]): { key: string; name: string; animals: T[] }[] {
  const lines: { key: string; name: string; animals: T[] }[] = [];
  for (const a of animals) {
    const last = lines.at(-1);
    if (last && last.name === (a.poolName ?? NO_POOL)) last.animals.push(a);
    else lines.push({ key: a.poolName ?? "nincs", name: a.poolName ?? NO_POOL, animals: [a] });
  }
  return lines;
}
