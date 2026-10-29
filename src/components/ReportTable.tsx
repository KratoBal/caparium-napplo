import { plainNumber as num, summaryCell } from "@/lib/mass-display";
import { headerGroups, type Column, type ReportLine } from "@/lib/reports";

/**
 * EGY-13: lines × (feed, base unit), with the line's total per unit and a total line. Lili 2026-10-29 (package item 12):
 * easier to read, in the other pages' style: banded rows, a group header per feed type above the feeds (and one over
 * the totals), and the total line apart at the bottom, on its own background in bold.
 */
const sumClass = (first: boolean) => (first ? "report-sum report-sum-first" : "report-sum");

export function ReportTable({ title, columns, lines, total, testId }: { title: string; columns: Column[]; lines: ReportLine[]; total: ReportLine; testId: string }) {
  const units = [...new Set(columns.filter((c) => !c.group).map((c) => c.unit))];
  const groupUnits = [...new Set(columns.filter((c) => c.group).map((c) => c.unit))];
  const groups = headerGroups(columns);
  // the first feed column of every group but the first: the line between the groups runs down from the header through the rows
  // (Lili 2026-10-29, picture 12c)
  const groupStart = new Set<string>();
  groups.reduce((at, g) => {
    if (at > 0) groupStart.add(columns[at].key);
    return at + g.span;
  }, 0);
  const startClass = (c: Column) => (groupStart.has(c.key) ? "report-gstart" : undefined);
  // The summary columns (the vertical totals) are marked like the total line is, and what they hold, like the total line,
  // reads in kg from 1000 g (Lili 2026-10-29, item 12 follow-up). `isTotal`: the bottom line, whose feed cells are sums too.
  const cells = (l: ReportLine, isTotal = false) => (
    <>
      <td>{l.label}</td>
      {columns.map((c) => (
        <td key={c.key} className={startClass(c)}>{l.cells[c.key] === undefined ? "" : isTotal ? summaryCell(c.unit, l.cells[c.key]) : num(l.cells[c.key])}</td>
      ))}
      {units.map((u, i) => (
        <td key={u} className={sumClass(i === 0)}>{l.totals[u] !== undefined ? summaryCell(u, l.totals[u]) : ""}</td>
      ))}
      {groupUnits.map((u, i) => (
        <td key={`g-${u}`} className={sumClass(units.length === 0 && i === 0)}>{l.groupTotals[u] !== undefined ? summaryCell(u, l.groupTotals[u]) : ""}</td>
      ))}
    </>
  );
  return (
    <div className="table-scroll">
      <table className="log-table report-table" data-testid={testId}>
        <thead>
          <tr className="report-groups">
            <th rowSpan={2}>{title}</th>
            {groups.map((g, i) => (
              <th key={`${g.label}-${i}`} colSpan={g.span} scope="colgroup" data-testid="report-group">
                {g.label}
              </th>
            ))}
            {units.length + groupUnits.length > 0 && (
              <th colSpan={units.length + groupUnits.length} scope="colgroup" data-testid="report-group">
                Összesítés
              </th>
            )}
          </tr>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={startClass(c)}>
                {c.feed} ({c.unit})
              </th>
            ))}
            {units.map((u, i) => (
              <th key={u} className={sumClass(i === 0)}>{groupUnits.length ? "Egyedi összesen" : "Összesen"} ({u})</th>
            ))}
            {groupUnits.map((u, i) => (
              <th key={`g-${u}`} className={sumClass(units.length === 0 && i === 0)}>Csoportos tételekben, a csoport teljes mennyisége ({u})</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={`${l.label}-${i}`}>{cells(l)}</tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="report-total" data-testid="report-total">
            {cells(total, true)}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
