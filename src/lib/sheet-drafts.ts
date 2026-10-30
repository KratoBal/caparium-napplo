// A draft on the feeding sheet lives in the browser, under its row's key and the feed. When the sheet is refreshed and a row is gone (an
// animal moved into a group while the page was open, say), its draft must neither stay invisible in memory nor vanish without a word:
// it is dropped, and the sheet says which row's draft was lost (Lili 2026-10-30, msg 1565798789183447103; acrobot 38947, b).
// A draft that equals what is saved is nothing lost, and is dropped silently.

export function vanishedDrafts(input: {
  /** the drafts by "rowKey|feedId" */
  draftKeys: string[];
  /** the keys of the rows the sheet has now */
  present: ReadonlySet<string>;
  /** whether the draft of that row and feed differs from what is saved */
  dirty: (rowKey: string, feedId: string) => boolean;
  labelOf: (rowKey: string) => string;
  feedName: (feedId: string) => string;
}): { drop: string[]; message: string | null } {
  const drop: string[] = [];
  const lost = new Map<string, string[]>();
  for (const key of input.draftKeys) {
    const cut = key.lastIndexOf("|");
    const row = key.slice(0, cut);
    const feedId = key.slice(cut + 1);
    if (input.present.has(row)) continue;
    drop.push(key);
    if (!input.dirty(row, feedId)) continue;
    const feeds = lost.get(row) ?? [];
    feeds.push(input.feedName(feedId));
    lost.set(row, feeds);
  }
  const parts = [...lost].map(([row, feeds]) => `${input.labelOf(row)} sor piszkozata a csoportváltás miatt elveszett: ${feeds.join(", ")}.`);
  return { drop, message: parts.length ? parts.join(" ") : null };
}
