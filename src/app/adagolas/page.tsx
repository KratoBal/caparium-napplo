import { ChemistryCalculator } from "@/components/ChemistryCalculator";
import { ChemicalActive, ChemicalEdit, DosingForm, MovementForm, NewChemical, type ChemicalOpt } from "@/components/DosingForms";
import { InvalidateButton } from "@/components/FeedingForms";
import { PrintButton } from "@/components/PrintButton";
import { Shell } from "@/components/Shell";
import { waterHelper } from "@/lib/helpers";
import { chemistryCalcPools } from "@/lib/chemistry-calc";
import { prisma } from "@/lib/db";
import { dosingLog, stockLevels } from "@/lib/dosing";
import { AppError } from "@/lib/errors";
import { moduleLevel, pickValid } from "@/lib/master";
import { requireModuleRead } from "@/lib/session";
import { addDays, businessDayOf, isValidDay, localTimeOf } from "@/lib/time";

export const dynamic = "force-dynamic";

const num = (v: number) => String(v).replace(".", ",");

// ADA-01..ADA-06, JAV-09: dosing by pool, the log (filterable, printable as PDF: ADA-04), the stock.
export default async function DosingPage({ searchParams }: { searchParams: Promise<{ tol?: string; ig?: string; medence?: string; szer?: string }> }) {
  const { user, level } = await requireModuleRead("DOSING");
  const sp = await searchParams;
  const today = businessDayOf(new Date());
  const to = sp.ig && isValidDay(sp.ig) ? sp.ig : today;
  const from = sp.tol && isValidDay(sp.tol) ? sp.tol : addDays(to, -6);
  const uuid = /^[0-9a-f-]{36}$/;
  const poolId = sp.medence && uuid.test(sp.medence) ? sp.medence : null;
  const chemicalId = sp.szer && uuid.test(sp.szer) ? sp.szer : null;
  const now = new Date();
  const [pools, stock, units, calcPools] = await Promise.all([
    prisma.pool.findMany({ where: { active: true }, include: { names: true }, orderBy: { code: "asc" } }),
    stockLevels(now),
    prisma.unit.findMany({ where: { active: true, dimension: { in: ["MASS", "VOLUME", "COUNT"] } }, orderBy: { symbol: "asc" } }),
    chemistryCalcPools(now),
  ]);
  let log: Awaited<ReturnType<typeof dosingLog>> = [];
  let error: string | null = null;
  try {
    log = await dosingLog({ from, to, poolId, chemicalId });
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    error = e.message;
  }
  const poolOpts = pools.map((p) => ({ id: p.id, name: pickValid(p.names, now)?.displayName ?? p.code }));
  const chemOpts: ChemicalOpt[] = stock
    .filter((c) => c.active)
    .map((c) => ({ id: c.id, name: c.name, units: units.filter((u) => u.dimension === c.dimension).map((u) => ({ id: u.id, symbol: u.symbol })) }));
  const canRecord = level === "RECORD" || level === "ADMIN";
  const isAdmin = level === "ADMIN";
  return (
    <Shell title="Vegyszeradagolás" active="dosing" user={user} helper={(await moduleLevel(prisma, user.id, user.role, "WATER")) !== "NONE" ? await waterHelper(true) : null}>
      {canRecord && (
        <div className="card no-print">
          <h2>Adagolás</h2>
          <p className="hint">Mentés után az űrlap marad: a következő adagolás a nap újabb sora (ADA-03). A szer a saját egységének dimenziójában adagolható.</p>
          <DosingForm pools={poolOpts} chemicals={chemOpts} />
        </div>
      )}
      {/* caparium-hibak-3: a calculation, saves nothing; open to everyone who sees the dosing page */}
      <div className="card no-print">
        <h2>Vegyszer-kalkulátor</h2>
        <p className="hint">
          Tiszta vegyszerekre: a szükséges mennyiség a kémiai képletből és a medence térfogatából. A javasolt értékek a
          medence legutóbbi méréséből és célsávjából jönnek, mind átírható. Nem ment semmit.
        </p>
        <ChemistryCalculator pools={calcPools} />
      </div>
      <div className="card">
        <h2>Napló</h2>
        <form method="get" action="/adagolas" className="filters no-print">
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
            <select className="input" name="medence" defaultValue={poolId ?? ""} aria-label="Szűrés medencére">
              <option value="">mind</option>
              {poolOpts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Szer
            <select className="input" name="szer" defaultValue={chemicalId ?? ""} aria-label="Szűrés szerre">
              <option value="">mind</option>
              {stock.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-soft" type="submit">Lekérés</button>
          <span className="spacer" />
          <PrintButton />
        </form>
        {error && <div className="banner banner-error">{error}</div>}
        <div className="table-scroll">
          <table className="log-table" data-testid="dosing-log">
            <thead>
              <tr><th>Nap</th><th>Idő</th><th>Medence</th><th>Szer</th><th>Mennyiség</th><th>Végezte</th><th></th></tr>
            </thead>
            <tbody>
              {log.map((r) => (
                <tr key={r.id} className={r.status === "VALID" ? undefined : "invalid"}>
                  <td>{r.day}</td>
                  <td>{localTimeOf(r.at)}</td>
                  <td>{r.pool}</td>
                  <td>{r.chemical}</td>
                  <td>
                    {r.quantity.replace(".", ",")} {r.unit}
                  </td>
                  <td>{r.by}</td>
                  <td className="keep no-print">
                    {r.status === "VALID" ? canRecord && <InvalidateButton url={`/api/dosings/${r.id}/invalidate`} version={r.version} /> : `érvénytelenítve${r.invalidationReason ? `: ${r.invalidationReason}` : ""}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h2>Készlet</h2>
        <p className="hint">A készlet a mozgások összege; kezdőkészlet nélkül negatív lehet, ez jelzés, nem hiba. Bevételezést és leltárkorrekciót adminisztrátor rögzít.</p>
        <table className="log-table" data-testid="stock">
          <thead>
            <tr><th>Szer</th><th>Készlet</th><th>Fogyás, 7 nap</th><th>Fogyás, 30 nap</th>{isAdmin && <th className="no-print" />}</tr>
          </thead>
          <tbody>
            {stock.map((c) => (
              <tr key={c.id} className={c.active ? undefined : "invalid"}>
                <td>{c.name}</td>
                <td className="keep">
                  <span className={c.negative ? "badge badge-invalid" : undefined}>
                    {num(c.level)} {c.unit}
                  </span>
                </td>
                <td>
                  {num(c.week)} {c.unit}
                </td>
                <td>
                  {num(c.month)} {c.unit}
                </td>
                {isAdmin && (
                  <td className="keep no-print">
                    <ChemicalEdit chem={c} units={units.map((u) => ({ id: u.id, name: u.symbol }))} /> <ChemicalActive chem={c} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {isAdmin && (
          <div className="no-print">
            <MovementForm chemicals={chemOpts} />
            <NewChemical units={units.map((u) => ({ id: u.id, name: u.symbol }))} />
          </div>
        )}
      </div>
    </Shell>
  );
}
