import { FeedActive, NewFeed } from "@/components/AnimalForms";
import { Shell } from "@/components/Shell";
import { prisma } from "@/lib/db";
import { listFeeds } from "@/lib/feeds";
import { withIcon } from "@/lib/icons";
import { requireModuleRead } from "@/lib/session";

export const dynamic = "force-dynamic";

const DIM = { MASS: "tömeg", COUNT: "darab", VOLUME: "térfogat" } as Record<string, string>;

// DAT-02, TAK-07: the feed list by type; a feed is never deleted, only made inactive.
export default async function FeedsPage() {
  const { user } = await requireModuleRead("FEEDING");
  const [types, units] = await Promise.all([listFeeds(), prisma.unit.findMany({ where: { active: true }, orderBy: { symbol: "asc" } })]);
  const isAdmin = user.role === "ADMIN";
  return (
    <Shell title="Takarmánylista" active="feeds" user={user}>
      {types.map((t) => (
        <div className="card" key={t.id}>
          <h2>{withIcon(t.emoji, t.name)}</h2>
          {t.feeds.length === 0 ? (
            <p className="hint">Nincs takarmány ebben a típusban.</p>
          ) : (
            <table className="log-table" data-testid={`feeds-${t.code}`}>
              <thead><tr><th>Név</th><th>Mérhető</th><th>Alapegység</th><th></th></tr></thead>
              <tbody>
                {t.feeds.map((f) => (
                  <tr key={f.id} className={f.active ? undefined : "invalid"}>
                    <td className="keep">{f.name}</td>
                    <td>{f.dimensions.map((d) => DIM[d] ?? d).join(" és ")}</td>
                    <td>{f.defaultUnit}</td>
                    <td className="keep">{isAdmin && <FeedActive id={f.id} active={f.active} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
      {isAdmin && (
        <div className="card">
          <h2>Új takarmány</h2>
          <p className="hint">A darab és a tömeg külön összesítődik, sosem adódik össze (DN-16).</p>
          <NewFeed types={types.map((t) => ({ id: t.id, name: t.name }))} units={units.map((u) => ({ id: u.id, symbol: u.symbol, dimension: u.dimension }))} />
        </div>
      )}
    </Shell>
  );
}
