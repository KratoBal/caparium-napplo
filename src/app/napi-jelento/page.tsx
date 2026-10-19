import { DayNav } from "@/components/DayNav";
import { PrintButton } from "@/components/PrintButton";
import { Shell } from "@/components/Shell";
import { getGrid, listGroups } from "@/lib/queries";
import { requireModuleRead } from "@/lib/session";
import { businessDayOf, formatDayLong, isValidDay } from "@/lib/time";

export const dynamic = "force-dynamic";

// VIZ-14 (an idea: the day's water report as one printable page). Every group's day view on one page,
// the latest valid value per cell, out-of-range values in red; "Nyomtatás / PDF" gives the file. The
// form of the official daily report (VIZ-13, D-28) is still open: this is the visual idea, not it.
export default async function DailyReportPage({ searchParams }: { searchParams: Promise<{ nap?: string }> }) {
  const { user } = await requireModuleRead("WATER");
  const today = businessDayOf(new Date());
  const sp = await searchParams;
  const day = sp.nap && isValidDay(sp.nap) && sp.nap <= today ? sp.nap : today;
  const groups = await listGroups();
  const grids = (await Promise.all(groups.map((g) => getGrid(g.id, day)))).filter((g) => g !== null);
  return (
    <Shell title="Napi jelentő" active="dailyreport" user={user}>
      <div className="toolbar no-print">
        <DayNav path="/napi-jelento" day={day} today={today} />
        <span className="spacer" />
        {/* VIZ-15 (NY-09 default: no e-mail): the day's measurements as a file to download */}
        <form method="post" action="/api/exports/excel">
          <input type="hidden" name="from" value={day} />
          <input type="hidden" name="to" value={day} />
          <button className="btn btn-soft" type="submit" data-testid="daily-excel">Napi jelentő (Excel)</button>
        </form>
        <PrintButton />
      </div>
      <h2 data-testid="report-day">Vízmérés, {formatDayLong(day)}</h2>
      {grids.map((g) => {
        const measured = Object.keys(g.daily).length;
        return (
          <div className="card" key={g.group.id} data-testid={`report-group-${g.group.name}`}>
            <h2>{g.group.name}</h2>
            {measured === 0 ? (
              <p className="hint">Ezen a napon nincs mérés.</p>
            ) : (
              <div className="table-scroll">
                <table className="log-table">
                  <thead>
                    <tr>
                      <th>Medence</th>
                      {g.layout.parameters.map((p) => (
                        <th key={p.id}>
                          {p.name} ({p.unit.symbol})
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.layout.pools.map((pool) => (
                      <tr key={pool.id}>
                        <td>{pool.name}</td>
                        {g.layout.parameters.map((p) => {
                          const c = g.daily[`${pool.id}:${p.id}`];
                          const out = c && (c.reference === "LOW" || c.reference === "HIGH");
                          return (
                            <td key={p.id} className="keep" style={out ? { color: "var(--c-error)", fontWeight: 700 } : undefined}>
                              {c ? `${c.value.replace(".", ",")}${c.dilution ? ` (×${c.dilution})` : ""}` : ""}
                              {c && <small className="hint"> {c.localTime} {c.responsibleMonogram}</small>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </Shell>
  );
}
