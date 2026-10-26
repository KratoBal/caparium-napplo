import { redirect } from "next/navigation";
import { NewPoolForm, NewUserForm, PoolRow, PoolVolumeForm, ReferenceRow, UserRow, WaterReportRecipient } from "@/components/SettingsForms";
import { IconForm } from "@/components/FeedingForms";
import { Shell } from "@/components/Shell";
import { prisma } from "@/lib/db";
import { canonicalDecimal } from "@/lib/decimal";
import { getSetting, moduleLevel, pickValid, validAt } from "@/lib/master";
import { reasonsRequired } from "@/lib/reasons";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// ÁLT-08, ÁLT-09, DAT-04: master data for admins. Units are shown, not edited here (ÁLT-08).
export default async function SettingsPage() {
  const user = await requireUser();
  if ((await moduleLevel(prisma, user.id, user.role, "SETTINGS")) !== "ADMIN") redirect("/nincs-jogosultsag");
  const now = new Date();
  const reasons = await reasonsRequired(prisma);
  const [params, pools, users, feedTypes] = await Promise.all([
    prisma.parameter.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      include: { names: true, unit: true, referenceRanges: { where: validAt(now) } },
    }),
    prisma.pool.findMany({
      where: { active: true },
      orderBy: { code: "asc" },
      include: {
        names: true,
        // a pool's measured parameters are its measurement groups' parameters
        memberships: { where: validAt(now), include: { group: { include: { parameters: { where: validAt(now), orderBy: { sortOrder: "asc" } } } } } },
      },
    }),
    // user management is for the admin role only (review of #2), not for a SETTINGS override
    user.role === "ADMIN"
      ? prisma.user.findMany({
          where: { role: { in: ["AQUARIST", "ADMIN"] } },
          orderBy: [{ active: "desc" }, { fullName: "asc" }],
          include: { monograms: true, zimsNames: true },
        })
      : Promise.resolve([]),
    prisma.feedType.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  return (
    <Shell title="Beállítások" active="settings" user={user}>
      <div className="card" data-testid="pool-references">
        <h2>Vízparaméterek és referenciaértékek medencénként</h2>
        <p className="hint">
          Minden medence a saját mért paramétereit látja (a mérési csoportjaiból). Ahol a medencének nincs saját értéke, a lenti
          közös érték érvényes rá; az első mentés a medence saját értékét hozza létre, mostantól. A korábbi mérések a régi
          értékhez mérődnek; a „helyesbítés” elírást javít, és a múltra is hat.
        </p>
        {pools
          .filter((pool) => pool.memberships.length > 0)
          .map((pool) => {
            const poolName = pickValid(pool.names, now)?.displayName ?? pool.code;
            const measured = new Set(pool.memberships.flatMap((m) => m.group.parameters.map((gp) => gp.parameterId)));
            return (
              <details key={pool.id} data-testid={`pool-ref-${poolName}`}>
                <summary>{poolName}</summary>
                <div className="table-scroll">
                  <table className="log-table">
                    <thead>
                      <tr><th>Paraméter</th><th>Mértékegység</th><th>Minimum</th><th>Maximum</th><th>Fajta</th>{reasons && <th>Indoklás</th>}<th></th></tr>
                    </thead>
                    <tbody>
                      {params
                        .filter((p) => measured.has(p.id))
                        .map((p) => {
                          const own = p.referenceRanges.find((r) => r.poolId === pool.id);
                          const r = own ?? p.referenceRanges.find((x) => x.poolId === null);
                          return (
                            <ReferenceRow
                              key={`${pool.id}:${p.id}`}
                              parameterId={p.id}
                              name={pickValid(p.names, now)?.displayName ?? p.code}
                              unit={p.unit.symbol}
                              min={r?.min ? canonicalDecimal(r.min) : null}
                              max={r?.max ? canonicalDecimal(r.max) : null}
                              pool={{ id: pool.id, name: poolName, inherited: !own }}
                            />
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </details>
            );
          })}
      </div>

      <div className="card">
        <h2>Közös referenciaértékek</h2>
        <p className="hint">
          Az az érték, amiből minden saját érték nélküli medence indul (paraméterenként). A „változás” mostantól érvényes, a
          korábbi mérések a régi értékhez mérődnek; a „helyesbítés” elírást javít, és a múltra is hat.
        </p>
        <div className="table-scroll">
          <table className="log-table">
            <thead>
              <tr><th>Paraméter</th><th>Mértékegység</th><th>Minimum</th><th>Maximum</th><th>Fajta</th>{reasons && <th>Indoklás</th>}<th></th></tr>
            </thead>
            <tbody>
              {params.map((p) => {
                const r = p.referenceRanges.find((x) => x.poolId === null);
                return (
                  <ReferenceRow
                    key={p.id}
                    parameterId={p.id}
                    name={pickValid(p.names, now)?.displayName ?? p.code}
                    unit={p.unit.symbol}
                    min={r?.min ? canonicalDecimal(r.min) : null}
                    max={r?.max ? canonicalDecimal(r.max) : null}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="banner banner-warn" style={{ marginTop: 16 }}>A tesztkörnyezet referenciaértékei bemutató adatok.</p>
      </div>

      <div className="card">
        <h2>Medencék</h2>
        <p className="hint">Minden medencének állandó azonosítója van; a név változása a korábbi mérések hozzárendelését nem érinti.</p>
        <div className="table-scroll">
          <table className="log-table">
            <thead><tr><th>Név</th><th>Mérési csoport</th><th>Fajta</th>{reasons && <th>Indoklás</th>}<th></th></tr></thead>
            <tbody>
              {pools.map((p) => (
                <PoolRow
                  key={p.id}
                  poolId={p.id}
                  name={pickValid(p.names, now)?.displayName ?? p.code}
                  groups={p.memberships.map((m) => m.group.name).join(", ")}
                />
              ))}
            </tbody>
          </table>
        </div>
        {user.role === "ADMIN" && (
          <div data-testid="new-pool-box">
            <h3 style={{ marginTop: 20 }}>Új medence</h3>
            <p className="hint">
              Név, kód és űrtartalom (liter) kell, az ikon nem kötelező. Csak új medencét vesz fel: a meglévő medencéket, méréseket és neveket nem
              érinti. Mérési csoportba még nem kerül, tehát mérés addig nem rögzíthető rá.
            </p>
            <NewPoolForm />
          </div>
        )}
        <h3 style={{ marginTop: 20 }}>Űrtartalom</h3>
        <p className="hint">Literben. A vegyszer-kalkulátor ezzel számol, amikor a medencét kiválasztod.</p>
        <table className="log-table" data-testid="pool-volumes">
          <tbody>
            {pools.map((p) => {
              const name = pickValid(p.names, now)?.displayName ?? p.code;
              return (
                <tr key={p.id}>
                  <td>{name}</td>
                  <td className="keep">
                    <PoolVolumeForm poolId={p.id} name={name} volumeLiters={p.volumeLiters ? canonicalDecimal(p.volumeLiters) : null} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Vízmérés kiküldése</h2>
        <p className="hint">Erre a címre küldi az Export oldal „Vízmérés kiküldése” gombja a mai és az e heti eredményeket, PDF-ben.</p>
        <WaterReportRecipient email={await getSetting(prisma, "water_report_recipient", now)} />
      </div>

      {/* the page is for a SETTINGS admin already; the icon is master data of the same kind */}
      <div className="card" data-testid="icons">
        <h2>Ikonok</h2>
        <p className="hint">Medencék és takarmánytípusok ikonja (DAT-03): csak megjelenítés, exportba nem kerül. Üresen hagyva nincs ikon.</p>
        <table className="log-table">
          <tbody>
            {pools.map((p) => (
              <tr key={p.id}>
                <td>{pickValid(p.names, now)?.displayName ?? p.code}</td>
                <td className="keep"><IconForm target="pool" id={p.id} name={pickValid(p.names, now)?.displayName ?? p.code} emoji={p.emoji} /></td>
              </tr>
            ))}
            {feedTypes.map((t) => (
              <tr key={t.id}>
                <td>{t.name} (takarmánytípus)</td>
                <td className="keep"><IconForm target="feedType" id={t.id} name={t.name} emoji={t.emoji} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {user.role === "ADMIN" && (
      <div className="card" id="felhasznalok">
        <h2>Felhasználók</h2>
        <p className="hint">Törlés nincs, csak inaktiválás: a régi naplók és az auditnapló a felhasználóra hivatkoznak.</p>
        <div className="table-scroll">
          <table className="log-table" data-testid="users-table">
            <thead><tr><th>Név</th><th>Szerep</th><th>Monogram</th><th>ZIMS-név</th><th>Jelszó</th><th></th></tr></thead>
            <tbody>
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  id={u.id}
                  loginId={u.loginId}
                  fullName={u.fullName}
                  role={u.role as "AQUARIST" | "ADMIN"}
                  active={u.active}
                  monogram={pickValid(u.monograms, now)?.monogram ?? ""}
                  zimsName={pickValid(u.zimsNames, now)?.zimsName ?? ""}
                  self={u.id === user.id}
                />
              ))}
            </tbody>
          </table>
        </div>
        <h3 style={{ marginTop: 20 }}>Új felhasználó</h3>
        <NewUserForm />
      </div>
      )}
    </Shell>
  );
}
