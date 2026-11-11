// The Kimutatások as a PDF made on the server (Lili 2026-11-01, point 8): landscape A4, the page's two breakdowns (by day, by
// recipient), each as a separate table per feed group (the page's group header: a feed type, the group items apart), so a wide
// period of many feeds does not run off the page; a group too wide for one table goes on in the next one. Then the totals.
import { feedingLog } from "../feeding-log";
import { plainNumber, summaryCell } from "../mass-display";
import { breakdown, headerGroups, type Column, type ReportLine } from "../reports";
import { formatPeriod } from "../time";
import { pdfPage, type PdfPage } from "./pdf-layout";

export const REPORT_PDF_TITLE = "Cápasuli kimutatás";
const LABEL_WIDTH = 120;
/** A feed type's label without its icon: the embedded typeface has no emoji, an icon would print as an empty box. */
const plain = (s: string) => s.replace(/\p{Extended_Pictographic}\uFE0F?/gu, "").replace(/\s+/g, " ").trim();
const MIN_COL = 58;

/**
 * Thousands in groups, with a no-break space, the decimal comma and a unit kept: "25 619", "1 362,5", "7,67 kg" (Lili
 * 2026-11-11, task caparium-kimutatas-pdf-formazas). The PDF only: the pages keep their own display (mass-display.ts).
 */
export function grouped(text: string): string {
  return text.replace(/^(-?)(\d+)/, (_, sign: string, digits: string) => sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0"));
}
const num = (v: number) => grouped(plainNumber(v));
const sum = (unit: string, v: number) => grouped(summaryCell(unit, v));

type Filter = { from: string; to: string; poolId: string | null; animalId: string | null };

/** The feed columns cut into groups (and a group too wide for the page into parts), in the page's order. */
export function groupTables(columns: Column[], room: number): { label: string; columns: Column[] }[] {
  const perTable = Math.max(1, Math.floor((room - LABEL_WIDTH) / MIN_COL) - 1); // one column left for the group's total
  const out: { label: string; columns: Column[] }[] = [];
  let at = 0;
  for (const g of headerGroups(columns)) {
    const cols = columns.slice(at, at + g.span);
    at += g.span;
    for (let i = 0; i < cols.length; i += perTable) {
      const part = cols.slice(i, i + perTable);
      out.push({ label: cols.length > perTable ? `${g.label} (${i / perTable + 1}. rész)` : g.label, columns: part });
    }
  }
  return out;
}

function section(page: PdfPage, name: string, first: string, lines: ReportLine[], total: ReportLine, columns: Column[], byDay = false) {
  page.band(name);
  for (const t of groupTables(columns, page.width)) {
    const units = [...new Set(t.columns.map((c) => c.unit))];
    const widths = [LABEL_WIDTH, ...t.columns.map(() => 0), ...units.map(() => 0)];
    const each = Math.floor((page.width - LABEL_WIDTH) / (widths.length - 1));
    for (let i = 1; i < widths.length; i++) widths[i] = Math.min(each, 150);
    const row = (l: ReportLine, isTotal: boolean) => {
      const sums = units.map((u) => t.columns.filter((c) => c.unit === u).reduce((s, c) => s + (l.cells[c.key] ?? 0), 0));
      const any = t.columns.some((c) => l.cells[c.key] !== undefined);
      return {
        cells: [
          l.label,
          ...t.columns.map((c) => (l.cells[c.key] === undefined ? "" : isTotal ? sum(c.unit, l.cells[c.key]) : num(l.cells[c.key]))),
          ...units.map((u, i) => (any ? sum(u, sums[i]) : "")),
        ],
        total: isTotal,
        align: ["left" as const, ...t.columns.map(() => "right" as const), ...units.map(() => "right" as const)],
      };
    };
    page.doc.fontSize(10).fillColor("#000").text(plain(t.label) || "Takarmányok", page.left, page.doc.y, { width: page.width });
    page.doc.moveDown(0.2);
    page.table(
      widths,
      [first, ...t.columns.map((c) => `${c.feed} (${c.unit})`), ...units.map((u) => `Összesen (${u})`)],
      [
        // one day a row on the days' table: every other day in a pale band, so the change of day shows
        ...lines.filter((l) => t.columns.some((c) => l.cells[c.key] !== undefined)).map((l, n) => ({ ...row(l, false), band: byDay && n % 2 === 1 })),
        row(total, true),
      ],
    );
  }
}

export async function buildReportPdf(f: Filter): Promise<{ buffer: Buffer; rows: number }> {
  const log = await feedingLog(f);
  const r = breakdown(log.entries, log.days, log.filtered, log.recipientOrder, log.feedOrder, log.feedType);
  const filters = [f.poolId ? "egy medencére szűrve" : null, f.animalId ? "egy állatra szűrve" : null].filter(Boolean);
  const page = pdfPage({
    title: `${REPORT_PDF_TITLE}: ${formatPeriod(f.from, f.to)}`,
    subtitle: `Időszak: ${formatPeriod(f.from, f.to)}${filters.length ? ` (${filters.join(", ")})` : ""}; takarmányonként és alapegységben, a darab és a tömeg külön oszlop, a csoportos tétel a csoporté, felosztás nélkül.`,
    landscape: true,
  });
  if (r.columns.length === 0) page.note("Az időszakban nem volt etetés.");
  else {
    section(page, "Napokra bontva", "Nap", r.byDay, r.total, r.columns, true);
    section(page, "Kinek", "Állat vagy csoport", r.byRecipient, r.total, r.columns);
    // the page's Összesítés: the whole period per unit, the group items apart when a filter keeps them apart
    const units = [...new Set(r.columns.filter((c) => !c.group).map((c) => c.unit))];
    const groupUnits = [...new Set(r.columns.filter((c) => c.group).map((c) => c.unit))];
    page.band("Összesítés");
    page.table(
      [LABEL_WIDTH, ...units.map(() => 130), ...groupUnits.map(() => 200)],
      ["", ...units.map((u) => `${groupUnits.length ? "Egyedi összesen" : "Összesen"} (${u})`), ...groupUnits.map((u) => `Csoportos tételekben (${u})`)],
      [{ cells: ["Összesen", ...units.map((u) => sum(u, r.total.totals[u] ?? 0)), ...groupUnits.map((u) => sum(u, r.total.groupTotals[u] ?? 0))], total: true }],
    );
  }
  return { buffer: await page.done(), rows: r.byDay.length };
}
