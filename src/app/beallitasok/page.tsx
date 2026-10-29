import { redirect } from "next/navigation";
import { NewPoolForm, NewUserForm, PoolList, PoolVolumeForm, ReferenceRow, SheetColorForm, UserRow, WaterReportRecipient } from "@/components/SettingsForms";
import { IconForm } from "@/components/FeedingForms";
import { SettingsCard } from "@/components/SettingsCard";
import { Shell } from "@/components/Shell";
import { listAnimals, listGroupsWithNames } from "@/lib/animals";
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
  // the pools card lists the inactive ones too (a renovation), to bring them back; the other cards the active ones
  const allPools = await prisma.pool.findMany({
    orderBy: [{ active: "desc" }, { code: "asc" }],
    include: { names: true, memberships: { where: validAt(now), include: { group: true } } },
  });
  const [params, pools, users, feedTypes, groups, animals, animalGroups] = await Promise.all([
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
    prisma.measurementGroup.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    listAnimals(now),
    listGroupsWithNames(now),
  ]);
  return (
    <Shell title="Beállítások" active="settings" user={user}>
      <SettingsCard id="referenciak" title="Vízparaméterek és referenciaértékek medencénként" testId="pool-references">
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
      </SettingsCard>

      <SettingsCard id="kozos-referenciak" title="Közös referenciaértékek">
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
      </SettingsCard>

      <SettingsCard id="medencek" title="Medencék">
        <p className="hint">Minden medencének állandó azonosítója van; a név változása a korábbi mérések hozzárendelését nem érinti. Az inaktív (felújítás alatti) medence csak itt látszik, az „Inaktívak mutatása” kapcsolóval, és innen aktiválható; a korábbi mérései a korábbi napokon és az exportban megmaradnak.</p>
        <PoolList
          reasons={reasons}
          pools={allPools.map((p) => ({
            poolId: p.id,
            name: pickValid(p.names, now)?.displayName ?? p.code,
            groups: p.memberships.map((m) => m.group.name).join(", "),
            active: p.active,
          }))}
        />
        {user.role === "ADMIN" && (
          <div data-testid="new-pool-box">
            <h3 style={{ marginTop: 20 }}>Új medence</h3>
            <p className="hint">
              Név, kód, űrtartalom (liter) és legalább egy mérési csoport kell, az ikon nem kötelező. A „Nincs vízmérés” jelölővel a medence csoport nélkül is felvehető: nyilvántartott, de nem kerül mérési táblába (mint a sózók). Csak új medencét vesz fel: a meglévő
              medencéket, méréseket, neveket és csoporttagságokat nem érinti. A kiválasztott csoport(ok) mérési táblájában a medence a lista
              végére kerül.
            </p>
            <NewPoolForm groups={groups} />
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
      </SettingsCard>

      <SettingsCard id="vizmeres-kikuldes" title="Vízmérés kiküldése">
        <p className="hint">Erre a címre küldi az Export oldal „Vízmérés kiküldése” gombja a mai és az e heti eredményeket, PDF-ben.</p>
        <WaterReportRecipient email={await getSetting(prisma, "water_report_recipient", now)} />
      </SettingsCard>

      {/* the page is for a SETTINGS admin already; the icon is master data of the same kind */}
      <SettingsCard id="ikonok" title="Ikonok" testId="icons">
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
      </SettingsCard>

      {/* Lili 2026-10-28 13:49 UTC: a row colour per animal and group, shown on the feeding sheet only */}
      <SettingsCard id="sorszinek" title="Sorszínek a takarmánylapon" testId="sheet-colors">
        <p className="hint">Az állat vagy a csoport sora ezzel a háttérszínnel jelenik meg a takarmánylapon, máshol nem. Csak megjelenítés, exportba nem kerül. Alapból nincs szín.</p>
        <table className="log-table">
          <tbody>
            {animals
              .filter((a) => a.alive)
              .map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td className="keep"><SheetColorForm target="animal" id={a.id} name={a.name} color={a.sheetColor} /></td>
                </tr>
              ))}
            {animalGroups.map((g) => (
              <tr key={g.id}>
                <td>{g.name} (csoport)</td>
                <td className="keep"><SheetColorForm target="group" id={g.id} name={`${g.name} (csoport)`} color={g.sheetColor} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </SettingsCard>

      {user.role === "ADMIN" && (
      <SettingsCard id="felhasznalok" title="Felhasználók" htmlId="felhasznalok">
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
      </SettingsCard>
      )}
    </Shell>
  );
}
