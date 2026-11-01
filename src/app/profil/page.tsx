import { OwnNameForm, OwnPasswordForm } from "@/components/OwnProfileForms";
import { Shell } from "@/components/Shell";
import { prisma } from "@/lib/db";
import { pickValid } from "@/lib/master";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// Lili 2026-11-01 (point 11): every user's own page. Name and password are theirs; the monogram and the ZIMS name the admin sets.
export default async function OwnProfilePage() {
  const user = await requireUser();
  const now = new Date();
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { monograms: true, zimsNames: true } });
  const monogram = pickValid(u.monograms, now)?.monogram ?? "";
  const zimsName = pickValid(u.zimsNames, now)?.zimsName ?? "";
  return (
    <Shell title="Saját beállítások" user={user}>
      <div className="card">
        <h2>Név</h2>
        <p className="hint">Felhasználónév: {u.loginId}. Ez a név látszik a fejlécben és a köszöntésben.</p>
        <OwnNameForm fullName={u.fullName} />
      </div>
      <div className="card">
        <h2>Jelszó</h2>
        <OwnPasswordForm />
      </div>
      <div className="card" data-testid="own-admin-fields">
        <h2>Monogram és ZIMS-név</h2>
        <p>
          Monogram: <b>{monogram || "nincs"}</b> · ZIMS-név: <b>{zimsName || "nincs"}</b>
        </p>
        <p className="hint">Ezeket az adminisztrátor módosítja. A korábbi mérések a régi monogrammal maradnak.</p>
      </div>
    </Shell>
  );
}
