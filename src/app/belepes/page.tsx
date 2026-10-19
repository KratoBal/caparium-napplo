import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  adat: "Hibás felhasználónév vagy jelszó.",
  zarolva: "Túl sok sikertelen próbálkozás. Próbáld újra 15 perc múlva.",
  forras: "A belépési kérés nem ebből az alkalmazásból jött. Töltsd újra az oldalt.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ hiba?: string }> }) {
  if (await currentUser()) redirect("/");
  const { hiba } = await searchParams;
  return (
    <Shell title="Bejelentkezés" user={null}>
      <div className="login-wrap">
        <div className="card login-card">
          <h2 style={{ fontSize: 34 }}>Cápárium nAPPló</h2>
          <p className="hint">Jelentkezz be a napi naplók használatához.</p>
          <form method="post" action="/api/auth/login">
            {hiba && ERRORS[hiba] && (
              <div className="banner banner-error" role="alert">
                {ERRORS[hiba]}
              </div>
            )}
            <label className="field">
              Felhasználónév
              <input className="input" name="loginId" autoComplete="username" autoCapitalize="none" required />
            </label>
            <label className="field">
              Jelszó
              <input className="input" name="password" type="password" autoComplete="current-password" required />
            </label>
            <button className="btn" type="submit">Bejelentkezés</button>
            <p className="hint">Az alkalmazás minden műveletet felhasználóhoz kapcsol.</p>
          </form>
        </div>
      </div>
    </Shell>
  );
}
