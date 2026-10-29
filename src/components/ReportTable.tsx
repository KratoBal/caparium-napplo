import { headerGroups, type Column, type ReportLine } from "@/lib/reports";

const num = (v: number) => String(Math.round(v * 10000) / 10000).replace(".", ",");

/**
 * EGY-13: lines × (feed, base unit), with the line's total per unit and a total line. Lili 2026-10-29 (package item 12):
 * easier to read, in the other pages' style: banded rows, a group header per feed type above the feeds (and one over
 * the totals), and the total line apart at the bottom, on its own background in bold.
 */
export function ReportTable({ title, columns, lines, total, testId }: { title: string; columns: Column[]; lines: ReportLine[]; total: ReportLine; testId: string }) {
  const units = [...new Set(columns.filter((c) => !c.group).map((c) => c.unit))];
  const groupUnits = [...new Set(columns.filter((c) => c.group).map((c) => c.unit))];
  const groups = headerGroups(columns);
  const cells = (l: ReportLine) => (
    <>
      <td>{l.label}</td>
      {columns.map((c) => (
        <td key={c.key}>{l.cells[c.key] !== undefined ? num(l.cells[c.key]) : ""}</td>
      ))}
      {units.map((u) => (
        <td key={u}>{l.totals[u] !== undefined ? num(l.totals[u]) : ""}</td>
      ))}
      {groupUnits.map((u) => (
        <td key={`g-${u}`}>{l.groupTotals[u] !== undefined ? num(l.groupTotals[u]) : ""}</td>
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
              <th key={c.key}>
                {c.feed} ({c.unit})
              </th>
            ))}
            {units.map((u) => (
              <th key={u}>{groupUnits.length ? "Egyedi összesen" : "Összesen"} ({u})</th>
            ))}
            {groupUnits.map((u) => (
              <th key={`g-${u}`}>Csoportos tételekben, a csoport teljes mennyisége ({u})</th>
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
            {cells(total)}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
