// The admin's own order of the animals (Lili 2026-10-26, card f67b1a06, item 4). Pure, so the rules are tested
// without a page or a database. `sortOrder` is the position the admin gave; null = never placed.
export type Orderable = { sortOrder?: number | null };

/**
 * Placed animals first (ascending), the never-placed after them; `fallback` breaks ties and orders the
 * never-placed, so with nothing placed the order is exactly what it was before this feature.
 */
export function byAnimalOrder<T extends Orderable>(fallback: (a: T, b: T) => number): (a: T, b: T) => number {
  return (a, b) => {
    const x = a.sortOrder ?? null;
    const y = b.sortOrder ?? null;
    if (x !== null && y !== null && x !== y) return x - y;
    return Number(x === null) - Number(y === null) || fallback(a, b);
  };
}

/**
 * THE ONE ORDER of the animals in every list (Lili 2026-10-26, msg 1564402506396598303; memory 2496: "a sorrendet minden lista
 * követi"): the admin's order first, the never-placed after them by name (Hungarian collation). Where a list shows its animals in
 * pool lines (the "Ki eszik ma" tick list), the lines keep their pool and this order is the one inside each line.
 */
export function compareAnimals<T extends Orderable & { name: string }>(a: T, b: T): number {
  return byAnimalOrder<T>((x, y) => x.name.localeCompare(y.name, "hu"))(a, b);
}

/** A new array of the animals in the one order; the input is not touched. */
export function sortAnimals<T extends Orderable & { name: string }>(animals: readonly T[]): T[] {
  return [...animals].sort(compareAnimals);
}

/** One position up (-1) or down (+1); at the edge nothing moves. A new array, the input is not touched. */
export function moveBy(ids: readonly string[], id: string, delta: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return [...ids];
  return moveTo(ids, id, to);
}

/** The animal `id` lands on index `to` (clamped into the list); the others keep their relative order. */
export function moveTo(ids: readonly string[], id: string, to: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return [...ids];
  const rest = ids.filter((x) => x !== id);
  rest.splice(Math.max(0, Math.min(to, rest.length)), 0, id);
  return rest;
}

/**
 * Which row a drag is over: `centers` are the vertical centers of the rows in their order, `y` the pointer. The row whose
 * center is nearest, so the target follows the pointer through the gaps and past the first and last row (Lili 2026-10-26,
 * msg 1564366437148270735: a drag handle, mouse and touch). -1 for no rows.
 */
export function rowAt(centers: readonly number[], y: number): number {
  let best = -1;
  let dist = Infinity;
  centers.forEach((c, i) => {
    const d = Math.abs(c - y);
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return best;
}

/**
 * The place the admin typed ("3" = the third), as a zero-based index; null for anything that is not a whole number from 1
 * to `count`, so a typo changes nothing.
 */
export function parsePlace(text: string, count: number): number | null {
  const t = text.trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= count ? n - 1 : null;
}

/**
 * The positions to store: the submitted animals in the submitted order, then every other animal in the order it
 * had (`othersInCurrentOrder`), so the animals the admin did not see (dead, just arrived) keep their relative
 * place and come after the shown ones. Positions are 0, 1, 2, ... without gaps.
 */
export function orderAssignments(submitted: readonly string[], othersInCurrentOrder: readonly string[]): { id: string; sortOrder: number }[] {
  const seen = new Set(submitted);
  return [...submitted, ...othersInCurrentOrder.filter((id) => !seen.has(id))].map((id, sortOrder) => ({ id, sortOrder }));
}
