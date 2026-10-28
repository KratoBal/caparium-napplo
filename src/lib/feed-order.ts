// The admin's own order of the feeds inside each feed type (Lili 2026-10-28 13:22 UTC, acrobot 37529: "kategórián belül húzással
// állítható sorrend, ugyanúgy, mint az állatoknál, és mindenhol ez a sorrend érvényes"). The types keep their own order
// (FeedType.sortOrder), the feeds stand by Feed.sortOrder inside their type. Pure, so the rule is tested without a page or a
// database. A feed's place: [its type's sortOrder, its own sortOrder]; null = not known (a name the lists cannot tie to a feed).
export type FeedPlace = readonly [typeOrder: number, feedOrder: number];

/** Placed first, by type then by the feed's own order; the unplaced after them; `fallback` breaks ties (the name, as before). */
export function byFeedOrder<T>(placeOf: (x: T) => FeedPlace | null | undefined, fallback: (a: T, b: T) => number): (a: T, b: T) => number {
  return (a, b) => {
    const x = placeOf(a) ?? null;
    const y = placeOf(b) ?? null;
    if (x && y) return x[0] - y[0] || x[1] - y[1] || fallback(a, b);
    return Number(x === null) - Number(y === null) || fallback(a, b);
  };
}
