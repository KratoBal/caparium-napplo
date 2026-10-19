// Reports from the feeding log (EGY-13; D-39 / NY-11 default: a filterable table and Excel). A period's
// feedings broken down by day and by recipient, per feed and base unit; pieces never add to grams.
// A group item counts for the group as a whole (R-8: no split is invented). Under an animal or pool
// filter the group items stand in their own columns and their own totals (review of #17, as the log's
// total in #11): a day's sum must not read as if the animal had eaten the group's food alone.

import type { LogEntry } from "./feeding-log";

export const GROUP_MARK = " [csoportos tétel]";

export type Column = { key: string; feed: string; unit: string; group: boolean };
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
export function breakdown(entries: LogEntry[], days: string[], filtered = false) {
  const columns: Column[] = [
    ...new Map(
      entries.map((e) => {
        const apart = filtered && e.group;
        const feed = `${e.feed}${apart ? GROUP_MARK : ""}`;
        return [`${feed}|${e.unit}`, { key: `${feed}|${e.unit}`, feed, unit: e.unit, group: apart }];
      }),
    ).values(),
  ].sort((a, b) => Number(a.group) - Number(b.group) || a.feed.localeCompare(b.feed, "hu") || a.unit.localeCompare(b.unit));
  const byDay = days.map((d) => line(d, entries.filter((e) => e.day === d), filtered));
  const recipients = [...new Set(entries.map((e) => e.recipient))].sort((a, b) => a.localeCompare(b, "hu"));
  const byRecipient = recipients.map((r) => line(r, entries.filter((e) => e.recipient === r), filtered));
  return { columns, byDay, byRecipient, total: line("Összesen", entries, filtered), filtered };
}
