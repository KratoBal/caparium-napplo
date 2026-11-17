import Link from "next/link";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { pageTr } from "@/lib/i18n/server";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  // one text for a wrong password, an unknown id and a locked id: it must not tell which
  adat: "Sikertelen belépés. Ellenőrizd a felhasználónevet és a jelszót; sok hibás próba után a fiók 15 percig nem léptethető be.",
  sok: "Erről a címről túl sok sikertelen belépés érkezett. Próbáld újra 15 perc múlva.",
  forras: "A belépési kérés nem ebből az alkalmazásból jött. Töltsd újra az oldalt.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ hiba?: string }> }) {
  if (await currentUser()) redirect("/");
  const { hiba } = await searchParams;
  // the device's language: the header's HU/EN switch is here too, before anyone logs in (lib/i18n/lang.ts)
  const { tr } = await pageTr();
  return (
    <Shell title={tr("Bejelentkezés")} user={null}>
      <div className="login-wrap">
        <div className="card login-card">
          <h2 style={{ fontSize: 34 }}>Cápárium nAPPló</h2>
          <p className="hint">{tr("Jelentkezz be a napi naplók használatához.")}</p>
          <form method="post" action="/api/auth/login">
            {hiba && ERRORS[hiba] && (
              <div className="banner banner-error" role="alert">
                {tr(ERRORS[hiba])}
              </div>
            )}
            <label className="field">
              {tr("Felhasználónév")}
              <input className="input" name="loginId" autoComplete="username" autoCapitalize="none" required />
            </label>
            <label className="field">
              {tr("Jelszó")}
              <input className="input" name="password" type="password" autoComplete="current-password" required />
            </label>
            <button className="btn" type="submit">{tr("Bejelentkezés")}</button>
            <p className="hint">{tr("Az alkalmazás minden műveletet felhasználóhoz kapcsol.")}</p>
          </form>
          {/* task e7f9e84d: the forgotten password */}
          <p>
            <Link href="/elfelejtett-jelszo">{tr("Elfelejtettem a jelszavam")}</Link>
          </p>
        </div>
      </div>
    </Shell>
  );
}
