import { FeedActive, FeedEdit, NewFeed } from "@/components/AnimalForms";
import { FeedCopies } from "@/components/FeedCopies";
import { OrderList } from "@/components/AnimalOrder";
import { Shell } from "@/components/Shell";
import { prisma } from "@/lib/db";
import { listFeeds } from "@/lib/feeds";
import { withIcon } from "@/lib/icons";
import { requireModuleRead } from "@/lib/session";

export const dynamic = "force-dynamic";

const DIM = { MASS: "tömeg", COUNT: "darab", VOLUME: "térfogat" } as Record<string, string>;

// DAT-02, TAK-07: the feed list by type; a feed is never deleted, only made inactive.
export default async function FeedsPage() {
  const { user, level } = await requireModuleRead("FEEDING");
  const [types, units] = await Promise.all([listFeeds(), prisma.unit.findMany({ where: { active: true }, orderBy: { symbol: "asc" } })]);
  const isAdmin = user.role === "ADMIN";
  // caparium-hibak-4: an aquarist who records feeding may add an "Egyéb" feed; the other types stay the admin's
  const canRecord = level === "RECORD" || level === "ADMIN";
  const unitOpts = units.map((u) => ({ id: u.id, symbol: u.symbol, dimension: u.dimension }));
  const addable = isAdmin ? types : canRecord ? types.filter((t) => t.code === "EGYEB") : [];
  return (
    <Shell title="Takarmánylista" active="feeds" user={user}>
      {types.map((t) => (
        <div className="card" key={t.id}>
          <h2>{withIcon(t.emoji, t.name)}</h2>
          {t.feeds.length === 0 ? (
            <p className="hint">Nincs takarmány ebben a típusban.</p>
          ) : (
            <table
              // Lili 2026-10-29 (package item 15): banded rows, paler than the reports' bands, under the coloured marks
              className="log-table feeds-table"
              data-testid={`feeds-${t.code}`}
            >
              <thead><tr><th>Név</th><th>Mérhető</th><th>Alapegység</th><th>Pipa</th><th></th></tr></thead>
              <tbody>
                {t.feeds.map((f) => (
                  <tr key={f.id} className={f.active ? undefined : "invalid"}>
                    <td className="keep">{f.name}</td>
                    <td>{f.dimensions.map((d) => DIM[d] ?? d).join(" és ")}</td>
                    <td>{f.defaultUnit}</td>
                    {/* package item 3: the amount the feeding sheet's tick records; everyone sees it, only the admin sets it */}
                    <td data-testid={`feed-dose-${f.id}`}>{f.dose ? `${f.dose.value.replace(".", ",")} ${f.dose.symbol}` : "–"}</td>
                    <td className="keep">
                      {isAdmin && (
                        <span className="row-actions">
                          <FeedEdit feed={f} units={unitOpts} />
                          <FeedActive id={f.id} active={f.active} />
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {/* Lili 2026-10-28 (acrobot 37529): the feeds' order inside the type, as the animals'; every list follows it */}
          {isAdmin && t.feeds.length > 1 && (
            <details className="no-print" data-testid={`feed-order-box-${t.code}`}>
              <summary>Sorrend</summary>
              <p className="hint">
                Húzd a sort a helyére (érintőképernyőn a Fel és Le gombokkal), majd mentsd. Az etetés, a kivétel, a kimutatások és az
                Excel-exportok a típuson belül ezt a sorrendet követik.
              </p>
              <OrderList
                key={t.feeds.map((x) => x.id).join()}
                rows={t.feeds.map((x) => ({ id: x.id, name: x.name, detail: x.active ? "" : "inaktív" }))}
                saveUrl="/api/feeds/order"
                extra={{ typeId: t.id }}
                testId={`feed-order-${t.code}`}
                saveTestId={`save-feed-order-${t.code}`}
              />
            </details>
          )}
        </div>
      ))}
      {addable.length > 0 && (
        <div className="card">
          <h2>{isAdmin ? "Új takarmány" : "Új Egyéb takarmány"}</h2>
          <p className="hint">A darab és a tömeg külön összesítődik, sosem adódik össze (DN-16).</p>
          <NewFeed types={addable.map((t) => ({ id: t.id, name: t.name }))} units={unitOpts} />
        </div>
      )}
      {/* package item 14: the basic data's copies, an admin's operation with a dry run */}
      {isAdmin && <FeedCopies />}
    </Shell>
  );
}
