import { redirect } from "next/navigation";
import { NewUserForm, PoolRow, ReferenceRow, UserRow } from "@/components/SettingsForms";
import { IconForm } from "@/components/FeedingForms";
import { Shell } from "@/components/Shell";
import { prisma } from "@/lib/db";
import { canonicalDecimal } from "@/lib/decimal";
import { moduleLevel, pickValid, validAt } from "@/lib/master";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// ÁLT-08, ÁLT-09, DAT-04: master data for admins. Units are shown, not edited here (ÁLT-08).
export default async function SettingsPage() {
  const user = await requireUser();
  if ((await moduleLevel(prisma, user.id, user.role, "SETTINGS")) !== "ADMIN") redirect("/nincs-jogosultsag");
  const now = new Date();
  const [params, pools, users, feedTypes] = await Promise.all([
    prisma.parameter.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      include: { names: true, unit: true, referenceRanges: { where: validAt(now) } },
    }),
    prisma.pool.findMany({
      where: { active: true },
      orderBy: { code: "asc" },
      include: { names: true, memberships: { where: validAt(now), include: { group: true } } },
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
      <div className="card">
        <h2>Vízparaméterek és referenciaértékek</h2>
        <p className="hint">
          Az összes medencére érvényes referenciaértékek (paraméterenként). A „változás” mostantól érvényes, a korábbi mérések
          a régi értékhez mérődnek; a „helyesbítés” elírást javít, és a múltra is hat.
        </p>
        <div className="table-scroll">
          <table className="log-table">
            <thead>
              <tr><th>Paraméter</th><th>Mértékegység</th><th>Minimum</th><th>Maximum</th><th>Fajta</th><th>Indoklás</th><th></th></tr>
            </thead>
            <tbody>
              {params.map((p) => {
                const r = p.referenceRanges[0];
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
            <thead><tr><th>Név</th><th>Mérési csoport</th><th>Fajta</th><th>Indoklás</th><th></th></tr></thead>
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
      <div className="card">
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
