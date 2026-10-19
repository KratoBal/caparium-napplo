import type { Column, ReportLine } from "@/lib/reports";

const num = (v: number) => String(Math.round(v * 10000) / 10000).replace(".", ",");

/** EGY-13: lines × (feed, base unit), with the line's total per unit and a total line. */
export function ReportTable({ title, columns, lines, total, testId }: { title: string; columns: Column[]; lines: ReportLine[]; total: ReportLine; testId: string }) {
  const units = [...new Set(columns.filter((c) => !c.group).map((c) => c.unit))];
  const groupUnits = [...new Set(columns.filter((c) => c.group).map((c) => c.unit))];
  return (
    <div className="table-scroll">
      <table className="log-table" data-testid={testId}>
        <thead>
          <tr>
            <th>{title}</th>
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
          {[...lines, total].map((l, i) => (
            <tr key={`${l.label}-${i}`} style={i === lines.length ? { fontWeight: 600 } : undefined}>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
