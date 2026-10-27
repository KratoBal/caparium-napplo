// The animals of a feeding day: their order and their lines in the "Ki eszik ma" chooser. Pure, so the
// order and the grouping are tested without a page.
import { compareAnimals } from "./animal-order";

export type ChooserAnimal = {
  id: string;
  name: string;
  poolName: string | null;
  poolEmoji?: string | null;
  /** the pool's place (Pool.sortOrder): the pool lines' order; null = after the ordered pools, by name */
  poolSortOrder?: number | null;
  sortOrder?: number | null;
};

/**
 * Lili 2026-10-26 (card f67b1a06, items 2 and 4): by pool, the pool-less last, then the admin's order, then by name.
 * Lili 2026-10-27 22:15 UTC (acrobot 37086): the pools in their own order (Pool.sortOrder: Nagymedence, Karantén,
 * Ragadozós, Korallos, Inkubátor), not by name; a pool without a place after them, by name.
 */
export function sortDayAnimals<T extends ChooserAnimal>(animals: T[]): T[] {
  // an explicit "no pool" step: a "~" sentinel sorts FIRST under the Hungarian collation (punctuation before letters)
  const place = (a: T) => a.poolSortOrder ?? Number.POSITIVE_INFINITY;
  return [...animals].sort(
    (x, y) =>
      Number(x.poolName === null) - Number(y.poolName === null) ||
      (place(x) === place(y) ? 0 : place(x) < place(y) ? -1 : 1) ||
      (x.poolName ?? "").localeCompare(y.poolName ?? "", "hu") ||
      compareAnimals(x, y),
  );
}

export const NO_POOL = "Medence nélkül";

/** One line per pool, in the order the animals arrive (sorted by `sortDayAnimals`). */
export function chooserPools<T extends ChooserAnimal>(animals: T[]): { key: string; name: string; emoji: string | null; animals: T[] }[] {
  const lines: { key: string; name: string; emoji: string | null; animals: T[] }[] = [];
  for (const a of animals) {
    const last = lines.at(-1);
    if (last && last.name === (a.poolName ?? NO_POOL)) last.animals.push(a);
    else lines.push({ key: a.poolName ?? "nincs", name: a.poolName ?? NO_POOL, emoji: a.poolEmoji ?? null, animals: [a] });
  }
  return lines;
}
