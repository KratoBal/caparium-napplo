import Link from "next/link";
import { Shell } from "@/components/Shell";
import { pageTr } from "@/lib/i18n/server";
import { prisma } from "@/lib/db";
import { formatDecimalHu } from "@/lib/decimal";
import { pickValid } from "@/lib/master";
import { searchLog } from "@/lib/queries";
import { requireModuleRead } from "@/lib/session";
import { addDays, businessDayOf, formatDay, isValidDay } from "@/lib/time";
import { poolInUse } from "@/lib/pool-periods";

export const dynamic = "force-dynamic";

const STATUS_LABEL = { VALID: "Érvényes", INVALIDATED: "Érvénytelenített", PENDING: "Függő" } as const;
const STATUS_CLASS = { VALID: "badge-valid", INVALIDATED: "badge-invalid", PENDING: "badge-pending" } as const;

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<{ tol?: string; ig?: string; medence?: string; allapot?: string; oldal?: string }>;
}) {
  const { user } = await requireModuleRead("WATER");
  const { tr } = await pageTr(user);
  const sp = await searchParams;
  const today = businessDayOf(new Date());
  const to = sp.ig && isValidDay(sp.ig) ? sp.ig : today;
  const from = sp.tol && isValidDay(sp.tol) ? sp.tol : addDays(to, -14);
  const status = sp.allapot === "VALID" || sp.allapot === "INVALIDATED" || sp.allapot === "PENDING" ? sp.allapot : "ALL";
  const pools = await prisma.pool.findMany({ where: poolInUse(today), include: { names: true }, orderBy: { code: "asc" } });
  const now = new Date();
  const poolId = pools.some((p) => p.id === sp.medence) ? sp.medence : undefined;
  const page = Math.max(1, Number(sp.oldal) || 1);
  const result = from <= to ? await searchLog({ from, to, poolId, status, page }) : null;
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const qs = (p: number) =>
    `/naplo?tol=${from}&ig=${to}${poolId ? `&medence=${poolId}` : ""}${status !== "ALL" ? `&allapot=${status}` : ""}&oldal=${p}`;

  return (
    <Shell title={tr("Vízmérési napló")} active="log" user={user}>
      <form method="get" action="/naplo" className="filters">
        <label className="field">
          {tr("Naptól")}
          <input className="input" type="date" name="tol" defaultValue={from} />
        </label>
        <label className="field">
          {tr("Napig")}
          <input className="input" type="date" name="ig" defaultValue={to} />
        </label>
        <label className="field">
          {tr("Medence")}
          <select className="input" name="medence" defaultValue={poolId ?? ""}>
            <option value="">{tr("Minden medence")}</option>
            {pools.map((p) => (
              <option key={p.id} value={p.id}>
                {pickValid(p.names, now)?.displayName ?? p.code}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {tr("Állapot")}
          <select className="input" name="allapot" defaultValue={status}>
            <option value="ALL">{tr("Mind")}</option>
            <option value="VALID">{tr(STATUS_LABEL.VALID)}</option>
            <option value="INVALIDATED">{tr(STATUS_LABEL.INVALIDATED)}</option>
            <option value="PENDING">{tr(STATUS_LABEL.PENDING)}</option>
          </select>
        </label>
        <button className="btn" type="submit">{tr("Szűrés")}</button>
      </form>

      <div className="card">
        <h2>{tr("Rögzített mérések")}</h2>
        <p className="hint">{tr("A korábbi mérési eredmények külön bejegyzésként megmaradnak. A sorra kattintva látszik a javítások története.")}</p>
        {!result ? (
          <p className="banner banner-error">{tr("A kezdő nap nem lehet a záró nap után.")}</p>
        ) : result.rows.length === 0 ? (
          <p className="hint" data-testid="log-empty">{tr("Ebben az időszakban nincs rögzített mérés.")}</p>
        ) : (
          <div className="table-scroll">
            <table className="log-table" data-testid="log-table">
              <thead>
                <tr>
                  <th>{tr("Dátum")}</th>
                  <th>{tr("Medence")}</th>
                  <th>{tr("Paraméter")}</th>
                  <th>{tr("Érték")}</th>
                  <th>{tr("Mérte")}</th>
                  <th>{tr("Rögzítő")}</th>
                  <th>{tr("Kör")}</th>
                  <th>{tr("Állapot")}</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => {
                  const out = r.reference === "LOW" || r.reference === "HIGH";
                  return (
                    <tr key={r.id} className={r.status === "INVALIDATED" ? "invalid" : undefined}>
                      <td>
                        <Link href={`/naplo/${r.id}`}>
                          {formatDay(r.businessDay)} {r.localTime}
                        </Link>
                      </td>
                      <td>{r.poolName}</td>
                      <td>{r.parameterName}</td>
                      <td className={out ? "value-out" : undefined} title={out && r.range ? `ref: ${r.range.min ?? ""}–${r.range.max ?? ""}` : undefined}>
                        {formatDecimalHu(r.value, r.decimals)} {r.unitSymbol !== r.parameterName ? r.unitSymbol : ""}
                        {(r.dilution || r.diluentWater) && (
                          <span className="hint">
                            {" "}
                            ({[r.dilution ? `1:${r.dilution}` : null, r.diluentWater].filter(Boolean).join(", ")})
                          </span>
                        )}
                      </td>
                      <td>
                        {r.responsibleMonogram}
                        {r.traineePerformed ? ` (${tr("gyak.")})` : ""}
                      </td>
                      <td>{r.recordedByMonogram}</td>
                      <td>{r.roundSeq}.</td>
                      <td className="keep">
                        <span className={`badge ${STATUS_CLASS[r.status]}`}>{tr(STATUS_LABEL[r.status])}</span>
                        {r.version > 1 && r.status === "VALID" && <span className="hint"> {tr("javítva")}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {result && pages > 1 && (
          <div className="toolbar">
            {page > 1 && <Link className="btn btn-soft" href={qs(page - 1)}>{tr("Előző oldal")}</Link>}
            <span className="hint">
              {tr("{page}. oldal / {pages} ({total} mérés)", { page, pages, total: result.total })}
            </span>
            {page < pages && <Link className="btn btn-soft" href={qs(page + 1)}>{tr("Következő oldal")}</Link>}
          </div>
        )}
      </div>

    </Shell>
  );
}
