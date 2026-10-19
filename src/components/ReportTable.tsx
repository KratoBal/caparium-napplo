import type { Column, ReportLine } from "@/lib/reports";

const num = (v: number) => String(Math.round(v * 10000) / 10000).replace(".", ",");

/** EGY-13: lines × (feed, base unit), with the line's total per unit and a total line. */
export function ReportTable({ title, columns, lines, total, testId }: { title: string; columns: Column[]; lines: ReportLine[]; total: ReportLine; testId: string }) {
  const units = [...new Set(columns.map((c) => c.unit))];
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
              <th key={u}>Összesen ({u})</th>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
