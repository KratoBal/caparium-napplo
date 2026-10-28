import { PrintButton } from "@/components/PrintButton";
import { Shell } from "@/components/Shell";
import { prisma } from "@/lib/db";
import { EAT_LABEL } from "@/lib/eating-labels";
import { AppError } from "@/lib/errors";
import { weekShade } from "@/lib/exports/feeding-excel";
import { feedingLog } from "@/lib/feeding-log";
import { listAnimals } from "@/lib/animals";
import { moduleLevel, pickValid } from "@/lib/master";
import { requireModuleRead } from "@/lib/session";
import { addDays, businessDayOf, isValidDay } from "@/lib/time";

export const dynamic = "force-dynamic";

const num = (v: number) => String(Math.round(v * 10000) / 10000).replace(".", ",");
const fmt = (t: Record<string, number>) => Object.entries(t).map(([u, v]) => `${num(v)} ${u}`).join(", ");

// TAK-04 (Notes N7): the feeding log of a period, filtered by pool and animal, with the eating pattern
// of the same animals; TAK-05: the same period as Excel, and the page itself as PDF.
export default async function FeedingLogPage({ searchParams }: { searchParams: Promise<{ tol?: string; ig?: string; medence?: string; allat?: string }> }) {
  const { user } = await requireModuleRead("FEEDING");
  const sp = await searchParams;
  const today = businessDayOf(new Date());
  const to = sp.ig && isValidDay(sp.ig) ? sp.ig : today;
  const from = sp.tol && isValidDay(sp.tol) ? sp.tol : addDays(to, -6);
  const uuid = /^[0-9a-f-]{36}$/;
  const poolId = sp.medence && uuid.test(sp.medence) ? sp.medence : null;
  const animalId = sp.allat && uuid.test(sp.allat) ? sp.allat : null;
  const now = new Date();
  const [pools, animals, exportLevel] = await Promise.all([
    prisma.pool.findMany({ where: { active: true }, include: { names: true }, orderBy: { code: "asc" } }),
    listAnimals(now),
    moduleLevel(prisma, user.id, user.role, "EXPORT"),
  ]);
  let log: Awaited<ReturnType<typeof feedingLog>> | null = null;
  let error: string | null = null;
  try {
    log = await feedingLog({ from, to, poolId, animalId });
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    error = e.message;
  }
  return (
    <Shell title="Takarmányozási napló" active="feedlog" user={user}>
      <form method="get" action="/takarmany-naplo" className="filters no-print">
        <label className="field">
          Naptól
          <input className="input" type="date" name="tol" defaultValue={from} />
        </label>
        <label className="field">
          Napig
          <input className="input" type="date" name="ig" defaultValue={to} />
        </label>
        <label className="field">
          Medence
          <select className="input" name="medence" defaultValue={poolId ?? ""} aria-label="Medence">
            <option value="">mind</option>
            {pools.map((p) => (
              <option key={p.id} value={p.id}>
                {pickValid(p.names, now)?.displayName ?? p.code}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Állat
          <select className="input" name="allat" defaultValue={animalId ?? ""} aria-label="Állat">
            <option value="">mind</option>
            {animals.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-soft" type="submit">Lekérés</button>
        <span className="spacer" />
        <PrintButton />
      </form>
      {error && <div className="banner banner-error">{error}</div>}
      {log && (
        <>
          {/* Lili 2026-10-28: above the lists, which grow; not at the page's end */}
          {exportLevel !== "NONE" && (
            <div className="toolbar no-print" data-testid="feedlog-exports">
              {(["etetes", "evesi"] as const).map((kind) => (
                <form key={kind} method="post" action="/api/exports/feeding">
                  <input type="hidden" name="kind" value={kind} />
                  <input type="hidden" name="from" value={from} />
                  <input type="hidden" name="to" value={to} />
                  <button className="btn" type="submit">
                    {kind === "etetes" ? "Egyedi takarmánynapló" : "Evési minta"} (Excel)
                  </button>
                </form>
              ))}
            </div>
          )}
          <div className="card">
            <h2>Evési minta</h2>
            <div className="table-scroll">
              <table className="log-table" data-testid="eating-pattern">
                <thead>
                  <tr>
                    <th>Állat</th>
                    {log.days.map((d) => (
                      // EVE-08: the weeks in two alternating colours
                      <th key={d} style={{ background: `#${weekShade(log!.days[0], d).slice(2)}` }}>
                        {d.slice(5).replace("-", ".")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {log.pattern.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      {log!.days.map((d) => {
                        const c = p.cells[d];
                        return (
                          <td key={d} className="keep">
                            {c && (
                              <span className={`badge eat-${c.state}`} title={EAT_LABEL[c.state]}>
                                {[c.vitamin ? "V" : "", c.medicine ? "Gy" : ""].filter(Boolean).join(" ") || " "}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <h2>Etetések ({log.rows.length})</h2>
            <p className="hint" data-testid="log-totals">
              {log.filtered && Object.keys(log.group).length > 0
                ? `Egyedi tételek: ${fmt(log.own) || "semmi"}; csoportos tételekben (a csoport teljes mennyisége, felosztás nélkül): ${fmt(log.group)}`
                : `Összesen: ${fmt(log.totals) || "semmi"}`}{" "}
              (alapegységben; a darab és a tömeg külön)
            </p>
            <div className="table-scroll">
              <table className="log-table" data-testid="feeding-log">
                <thead>
                  <tr><th>Nap</th><th>Kinek</th><th>Medence</th><th>Takarmány</th><th>Mennyiség</th></tr>
                </thead>
                <tbody>
                  {log.rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.day}</td>
                      <td>{r.recipient}</td>
                      <td>{r.pools || "–"}</td>
                      <td>{r.feed}</td>
                      <td>{r.quantities}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}
