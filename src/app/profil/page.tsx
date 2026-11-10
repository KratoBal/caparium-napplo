import { OwnEmailForm, OwnNameForm, OwnNicknameForm, OwnPasswordForm } from "@/components/OwnProfileForms";
import { Shell } from "@/components/Shell";
import { prisma } from "@/lib/db";
import { greetingName } from "@/lib/helper-notice";
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
      {/* Lili 2026-11-01 22:43 UTC: the login name, the display name and the nickname on one card, each with its own sentence */}
      <div className="card" data-testid="own-name-card">
        <h2>Név</h2>
        <p className="hint">Bejelentkezési név: {u.loginId}.</p>
        <p className="hint">A megjelenő név látszik a fejlécben és a naplókban.</p>
        <OwnNameForm fullName={u.fullName} />
        {/* Lili 2026-11-01 (point 17): the helper's greeting only; the header and the logs keep the display name */}
        <p className="hint">
          Ezen a becenéven köszön a segítő. Ha üres, a megjelenő név keresztnevét használja: {greetingName({ fullName: u.fullName })}.
        </p>
        <OwnNicknameForm nickname={u.nickname ?? ""} />
      </div>
      <div className="card">
        <h2>Jelszó</h2>
        <OwnPasswordForm />
      </div>
      {/* task e7f9e84d: the forgotten password's address */}
      <div className="card">
        <h2>E-mail cím</h2>
        <p className="hint">Ha elfelejted a jelszavad, erre a címre küldjük a visszaállító linket. Nem kötelező; enélkül az adminisztrátor ad új jelszót.</p>
        <OwnEmailForm email={u.email ?? ""} />
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
