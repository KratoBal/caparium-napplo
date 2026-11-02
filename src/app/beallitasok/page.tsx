import { redirect } from "next/navigation";
import { MonthlyZimsRecipient, NewMeasurementForm, NewPoolForm, NewUserForm, PoolList, PoolSystemForm, PoolVolumeForm, SaveReminderSwitch, SheetColorForm, UserRow, WaterReportRecipient } from "@/components/SettingsForms";
import { IconForm } from "@/components/FeedingForms";
import { FridgeSettings } from "@/components/FridgeSettings";
import { WaterMeasurements } from "@/components/WaterMeasurements";
import { SettingsCard } from "@/components/SettingsCard";
import { Shell } from "@/components/Shell";
import { listAnimals, listGroupsWithNames } from "@/lib/animals";
import { prisma } from "@/lib/db";
import { canonicalDecimal } from "@/lib/decimal";
import { getSetting, moduleLevel, pickValid, validAt } from "@/lib/master";
import { listFridges } from "@/lib/fridges";
import { listMeasurementTypes } from "@/lib/measurement-types";
import { reasonsRequired } from "@/lib/reasons";
import { saveReminderOn } from "@/lib/save-reminder-setting";
import { poolCovers, poolInUse, poolPeriodView } from "@/lib/pool-periods";
import { requireUser } from "@/lib/session";
import { businessDayOf } from "@/lib/time";

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
    include: { names: true, memberships: { where: validAt(now), include: { group: true } }, periods: { orderBy: { firstDay: "asc" } } },
  });
  // Lili 2026-11-01 (point 16): "active" is in use today, by the pool's periods
  const today = businessDayOf(now);
  const [pools, users, feedTypes, groups, animals, animalGroups] = await Promise.all([
    prisma.pool.findMany({ where: poolInUse(today), orderBy: { code: "asc" }, include: { names: true } }),
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
  // point 9: the units a water value is measured in, and each group with its pools today
  const measurementTypes = await listMeasurementTypes(now);
  const [measureUnits, groupPools] = await Promise.all([
    prisma.unit.findMany({ where: { active: true, dimension: { notIn: ["MASS", "COUNT", "VOLUME"] } }, orderBy: { symbol: "asc" } }),
    prisma.measurementGroup.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      include: { memberships: { where: validAt(now), orderBy: { sortOrder: "asc" }, include: { pool: { include: { names: true } } } } },
    }),
  ]);
  return (
    <Shell title="Beállítások" active="settings" user={user}>
      {/* Lili 2026-11-02 09:36-09:40 UTC (acrobot 39956, 39960): the water measurements on one card, as the pools, the feeds and
          the animals; the per-pool and the common references, the tester conversion and the new measurement moved in here */}
      <SettingsCard id="vizmeresek" title="Vízmérések" testId="water-measurements-card">
        <p className="hint">
          Mérésenként egy sor; a Szerkesztés alatt a név (attól a naptól), a tizedesjegy és a hihető tartomány, a referenciák (közös és
          medencénkénti), a mérőeszköz-átváltás, a lezárás és a mértékegység váltása. Törlés nincs: a lezárt mérés régi értékei megmaradnak.
        </p>
        <WaterMeasurements rows={measurementTypes} units={measureUnits.map((u) => ({ id: u.id, symbol: u.symbol }))} today={businessDayOf(now)} reasons={reasons} />
        <div data-testid="new-measurement-card">
          <h3 style={{ marginTop: 20 }}>Új mérés</h3>
          <p className="hint">
            Új vízérték mérésének kezdete (például nitrit vagy oldott oxigén): a kiválasztott napi vagy heti táblába új oszlop kerül, amely
            csak a bejelölt medencékben tölthető ki, a megadott naptól; a többi medencében kötőjel áll. A hihető tartományon kívüli
            értéknél a tábla rákérdez, a referencián kívülit pirossal jelzi. A ZIMS-név és -mértékegység betűre úgy kell, ahogy a ZIMS várja.
          </p>
          <NewMeasurementForm
            today={businessDayOf(now)}
            units={measureUnits.map((u) => ({ id: u.id, symbol: u.symbol }))}
            groups={groupPools.map((g) => ({
              id: g.id,
              name: `${g.name} (${g.frequency === "DAILY" ? "napi" : "heti"})`,
              pools: g.memberships.map((m) => ({ id: m.pool.id, name: pickValid(m.pool.names, now)?.displayName ?? m.pool.code })),
            }))}
          />
        </div>
        <p className="banner banner-warn" style={{ marginTop: 16 }}>A tesztkörnyezet referenciaértékei bemutató adatok.</p>
      </SettingsCard>

      {/* Lili 2026-11-02 (task caparium-hutok): the fridges of the daily temperature book; their own card, not a water measurement */}
      <SettingsCard id="hutok" title="Hűtők" testId="fridges-card">
        <p className="hint">
          Hűtőnként és fagyasztónként egy sor: név, fajta és a megengedett tartomány (°C). A napi vízmérés oldalán, a Nagy medencék tábla alatt
          rögzíthető a hőmérséklet; a tartományon kívüli érték piros. Törlés nincs: a lezárt hűtőre nem rögzíthető új leolvasás, a régiek
          megmaradnak, és újranyitható. Az új tartomány mostantól érvényes, a korábbi leolvasások a sajátjukat tartják.
        </p>
        <FridgeSettings fridges={await listFridges({ closedToo: true })} />
      </SettingsCard>

      <SettingsCard id="medencek" title="Medencék">
        <p className="hint">Minden medencének állandó azonosítója van; a név változása a korábbi mérések hozzárendelését nem érinti. Az inaktív (felújítás alatti) medence csak itt látszik, az „Inaktívak mutatása” kapcsolóval, és innen aktiválható; a korábbi mérései a korábbi napokon és az exportban megmaradnak.</p>
        <PoolList
          reasons={reasons}
          pools={allPools.map((p) => ({
            poolId: p.id,
            name: pickValid(p.names, now)?.displayName ?? p.code,
            groups: p.memberships.map((m) => m.group.name).join(", "),
            active: p.periods.some((x) => poolCovers(poolPeriodView(x), today)),
            periods: p.periods.map(poolPeriodView),
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
        <h3 style={{ marginTop: 20 }}>Űrtartalom és rendszer</h3>
        <p className="hint">
          Literben. A vegyszer-kalkulátor ezzel számol, amikor a medencét kiválasztod. A rendszer (korallos vagy halas) a napi emelési
          határt adja: korallos rendszerben kisebb lépésben emeli.
        </p>
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
                  <td className="keep">
                    <PoolSystemForm poolId={p.id} name={name} systemType={p.systemType} />
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

      <SettingsCard id="havi-zims-level" title="Havi ZIMS-csomag levélben">
        <p className="hint">Erre a címre megy az előző hónap ZIMS-csomagja az új hónap első órájában, medencénként egy CSV-vel. Ha a hónapra nem készül csomag, figyelmeztető levél megy. Üresen hagyva nem megy levél. Ha a címet hónap közben adod meg, az előző hónap csomagja is egyszer kimegy.</p>
        <MonthlyZimsRecipient email={await getSetting(prisma, "monthly_zims_recipient", now)} />
      </SettingsCard>

      <SettingsCard id="mentes-emlekezteto" title="Mentés-emlékeztető">
        <p className="hint">
          Ha a napi vagy a heti vízmérésen minden mező ki van töltve, de még nincs mentve, a segítő szól: egy perc csend után,
          vagy amikor az oldalt elhagynád. Ha már rutin a mentés, itt kikapcsolható mindenkinek.
        </p>
        <SaveReminderSwitch on={await saveReminderOn(prisma, now)} />
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
