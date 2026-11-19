import Link from "next/link";
import { redirect } from "next/navigation";
import { PendingActions } from "@/components/PendingActions";
import { Shell } from "@/components/Shell";
import { canonicalDecimal } from "@/lib/decimal";
import { pageTr } from "@/lib/i18n/server";
import { monogramResolver, pickValid } from "@/lib/master";
import { listPending } from "@/lib/pending";
import { requireModuleRead } from "@/lib/session";
import { businessDayOf, dateToDay, formatDay, localTimeOf } from "@/lib/time";

export const dynamic = "force-dynamic";

// K9: saves that arrived after the grace period wait here for an admin decision.
export default async function PendingPage() {
  const { user, level } = await requireModuleRead("WATER");
  if (level !== "ADMIN") redirect("/nincs-jogosultsag");
  const { tr } = await pageTr(user);
  const rows = await listPending();
  const mono = await monogramResolver(rows.map((r) => r.createdById));
  return (
    <Shell title={tr("Függő mentések")} active="pending" user={user}>
      <div className="card">
        <h2>{tr("Késve érkezett mentések")}</h2>
        <p className="hint">
          {tr(
            "Ezek a mentések a türelmi időn túl érkeztek a szerverre. Nem vesztek el, de amíg nem döntesz róluk, nem számítanak bele sem a napi nézetbe, sem az exportba.",
          )}
        </p>
        {rows.length === 0 ? (
          <p className="hint" data-testid="pending-empty">{tr("Nincs függő mentés.")}</p>
        ) : (
          <div className="table-scroll">
            <table className="log-table" data-testid="pending-table">
              <thead>
                <tr>
                  <th>{tr("Mérés")}</th>
                  <th>{tr("Medence")}</th>
                  <th>{tr("Paraméter")}</th>
                  <th>{tr("Érték")}</th>
                  <th>{tr("Rögzítő")}</th>
                  <th>{tr("Beküldve (eszközön)")}</th>
                  <th>{tr("Megérkezett")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/naplo/${r.id}`}>
                        {formatDay(dateToDay(r.businessDay))} {localTimeOf(r.measuredAt)}
                      </Link>
                    </td>
                    <td>{pickValid(r.pool.names, r.measuredAt)?.displayName ?? r.pool.code}</td>
                    {/* a measurement's name, translated where shown as on the measurement grid (tr(p.name)) */}
                    <td>{tr(pickValid(r.parameter.names, r.measuredAt)?.displayName ?? r.parameter.code)}</td>
                    <td>{canonicalDecimal(r.value).replace(".", ",")}</td>
                    <td>{mono.monogram(r.createdById, r.createdAt)}</td>
                    <td>{r.clientTimestamp ? `${formatDay(businessDayOf(r.clientTimestamp))} ${localTimeOf(r.clientTimestamp)}` : "–"}</td>
                    <td>{localTimeOf(r.createdAt)}</td>
                    <td>
                      <PendingActions id={r.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}
