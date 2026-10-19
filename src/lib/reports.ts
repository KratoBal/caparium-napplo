// Reports from the feeding log (EGY-13; D-39 / NY-11 default: a filterable table and Excel). A period's
// feedings broken down by day and by recipient, per feed and base unit; pieces never add to grams.
// A group item counts for the group as a whole (R-8: no split is invented).

import type { LogEntry } from "./feeding-log";

export type Column = { key: string; feed: string; unit: string };
export type ReportLine = { label: string; cells: Record<string, number>; totals: Record<string, number> };

function line(label: string, entries: LogEntry[]): ReportLine {
  const cells: Record<string, number> = {};
  const totals: Record<string, number> = {};
  for (const e of entries) {
    const key = `${e.feed}|${e.unit}`;
    cells[key] = (cells[key] ?? 0) + e.value;
    totals[e.unit] = (totals[e.unit] ?? 0) + e.value;
  }
  return { label, cells, totals };
}

export function breakdown(entries: LogEntry[], days: string[]) {
  const columns: Column[] = [...new Map(entries.map((e) => [`${e.feed}|${e.unit}`, { key: `${e.feed}|${e.unit}`, feed: e.feed, unit: e.unit }])).values()].sort(
    (a, b) => a.feed.localeCompare(b.feed, "hu") || a.unit.localeCompare(b.unit),
  );
  const byDay = days.map((d) => line(d, entries.filter((e) => e.day === d)));
  const recipients = [...new Set(entries.map((e) => e.recipient))].sort((a, b) => a.localeCompare(b, "hu"));
  const byRecipient = recipients.map((r) => line(r, entries.filter((e) => e.recipient === r)));
  return { columns, byDay, byRecipient, total: line("Összesen", entries) };
}
