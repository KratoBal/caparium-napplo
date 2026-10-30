// Reports from the feeding log (EGY-13; D-39 / NY-11 default: a filterable table and Excel). A period's
// feedings broken down by day and by recipient, per feed and base unit; pieces never add to grams.
// A group item counts for the group as a whole (R-8: no split is invented). Under an animal or pool
// filter the group items stand in their own columns and their own totals (review of #17, as the log's
// total in #11): a day's sum must not read as if the animal had eaten the group's food alone.

import { compareAnimals } from "./animal-order";
import { formatDay } from "./time";
import { byFeedOrder, type FeedPlace } from "./feed-order";
import type { LogEntry } from "./feeding-log";

export const GROUP_MARK = " [csoportos tétel]";

/** `type`: the feed type's label, for the group header above the feeds (Lili 2026-10-29, package item 12) */
export type Column = { key: string; feed: string; unit: string; group: boolean; type?: string };

/** The header's groups over the feed columns, in order: one per run of the same type (a run, not a set: the columns are sorted by type, the group-item ones after the rest). */
export function headerGroups(columns: readonly Column[]): { label: string; span: number }[] {
  const out: { label: string; span: number }[] = [];
  for (const c of columns) {
    const label = `${c.type ?? ""}${c.group ? " (csoportos tételek)" : ""}`;
    const last = out.at(-1);
    if (last && last.label === label) last.span++;
    else out.push({ label, span: 1 });
  }
  return out;
}
export type ReportLine = { label: string; cells: Record<string, number>; totals: Record<string, number>; groupTotals: Record<string, number> };

function line(label: string, entries: LogEntry[], split: boolean): ReportLine {
  const cells: Record<string, number> = {};
  const totals: Record<string, number> = {};
  const groupTotals: Record<string, number> = {};
  for (const e of entries) {
    const apart = split && e.group;
    const key = `${e.feed}${apart ? GROUP_MARK : ""}|${e.unit}`;
    cells[key] = (cells[key] ?? 0) + e.value;
    const t = apart ? groupTotals : totals;
    t[e.unit] = (t[e.unit] ?? 0) + e.value;
  }
  return { label, cells, totals, groupTotals };
}

/** `filtered`: an animal or pool filter is on, so the group items are kept apart. */
export function breakdown(
  entries: LogEntry[],
  days: string[],
  filtered = false,
  recipientOrder?: ReadonlyMap<string, number | null>,
  feedOrder?: ReadonlyMap<string, FeedPlace>,
  feedType?: ReadonlyMap<string, string>,
) {
  const columns: Column[] = [
    ...new Map(
      entries.map((e) => {
        const apart = filtered && e.group;
        const feed = `${e.feed}${apart ? GROUP_MARK : ""}`;
        const type = feedType?.get(e.feed);
        return [`${feed}|${e.unit}`, { key: `${feed}|${e.unit}`, feed, unit: e.unit, group: apart, ...(type ? { type } : {}) }];
      }),
    ).values(),
  ].sort(
    (a, b) =>
      Number(a.group) - Number(b.group) ||
      // the feeds in the admin's order (Lili 2026-10-28, acrobot 37529); without the places, by name as before
      byFeedOrder<Column>(
        (c) => feedOrder?.get(c.group ? c.feed.slice(0, -GROUP_MARK.length) : c.feed),
        (x, y) => x.feed.localeCompare(y.feed, "hu") || x.unit.localeCompare(y.unit),
      )(a, b),
  );
  // the day labels read dotted (2026.11.02.), in the page and in the Excel sheet alike (Lili 2026-10-30)
  const byDay = days.map((d) => line(formatDay(d), entries.filter((e) => e.day === d), filtered));
  // the animals in the admin's order (Lili 2026-10-26, msg 1564402506396598303); without the positions, by name as before
  const recipients = [...new Set(entries.map((e) => e.recipient))].sort((a, b) =>
    compareAnimals({ name: a, sortOrder: recipientOrder?.get(a) ?? null }, { name: b, sortOrder: recipientOrder?.get(b) ?? null }),
  );
  const byRecipient = recipients.map((r) => line(r, entries.filter((e) => e.recipient === r), filtered));
  return { columns, byDay, byRecipient, total: line("Összesen", entries, filtered), filtered };
}
