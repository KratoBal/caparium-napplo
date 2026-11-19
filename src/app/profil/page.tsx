import { OwnEmailForm, OwnLanguageForm, OwnNameForm, OwnNicknameForm, OwnPasswordForm } from "@/components/OwnProfileForms";
import { Shell } from "@/components/Shell";
import { pageTr } from "@/lib/i18n/server";
import { prisma } from "@/lib/db";
import { greetingName } from "@/lib/helper-notice";
import { pickValid } from "@/lib/master";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// Lili 2026-11-01 (point 11): every user's own page. Name and password are theirs; the monogram and the ZIMS name the admin sets.
export default async function OwnProfilePage() {
  const user = await requireUser();
  const { tr } = await pageTr(user);
  const now = new Date();
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { monograms: true, zimsNames: true } });
  const monogram = pickValid(u.monograms, now)?.monogram ?? "";
  const zimsName = pickValid(u.zimsNames, now)?.zimsName ?? "";
  return (
    <Shell title={tr("Saját beállítások")} user={user}>
      {/* Lili 2026-11-01 22:43 UTC: the login name, the display name and the nickname on one card, each with its own sentence */}
      <div className="card" data-testid="own-name-card">
        <h2>{tr("Név")}</h2>
        <p className="hint">{tr("Bejelentkezési név: {login}.", { login: u.loginId })}</p>
        <p className="hint">{tr("A megjelenő név látszik a fejlécben és a naplókban.")}</p>
        <OwnNameForm fullName={u.fullName} />
        {/* Lili 2026-11-01 (point 17): the helper's greeting only; the header and the logs keep the display name */}
        <p className="hint">
          {tr("Ezen a becenéven köszön a segítő. Ha üres, a megjelenő név keresztnevét használja: {name}.", { name: greetingName({ fullName: u.fullName }) })}
        </p>
        <OwnNicknameForm nickname={u.nickname ?? ""} />
      </div>
      {/* t-20261117-caparium-angol-alap: the default only; the header's HU/EN switch is the device's own choice and wins */}
      <div className="card">
        <h2>{tr("Nyelv")}</h2>
        <p className="hint">{tr("Ezen a nyelven nyílnak a képernyők egy olyan eszközön, ahol még senki nem választott a fejléc HU/EN gombjával. A gomb az eszközön megjegyzett választás, és erősebb ennél.")}</p>
        <OwnLanguageForm language={u.language} />
      </div>
      <div className="card">
        <h2>{tr("Jelszó")}</h2>
        <OwnPasswordForm />
      </div>
      {/* task e7f9e84d: the forgotten password's address */}
      <div className="card">
        <h2>{tr("E-mail cím")}</h2>
        <p className="hint">{tr("Ha elfelejted a jelszavad, erre a címre küldjük a visszaállító linket. Nem kötelező; enélkül az adminisztrátor ad új jelszót.")}</p>
        <OwnEmailForm email={u.email ?? ""} />
      </div>
      <div className="card" data-testid="own-admin-fields">
        <h2>{tr("Monogram és ZIMS-név")}</h2>
        <p>
          {tr("Monogram")}: <b>{monogram || tr("nincs")}</b> · {tr("ZIMS-név")}: <b>{zimsName || tr("nincs")}</b>
        </p>
        <p className="hint">{tr("Ezeket az adminisztrátor módosítja. A korábbi mérések a régi monogrammal maradnak.")}</p>
      </div>
    </Shell>
  );
}
