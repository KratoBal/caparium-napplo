import Link from "next/link";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";
import { Shell } from "@/components/Shell";
import { pageTr } from "@/lib/i18n/server";
import { resetLinkUsable } from "@/lib/password-reset";

export const dynamic = "force-dynamic";

// task e7f9e84d: the page of a one-time reset link; no session needed (the user cannot log in)
export default async function PasswordResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const usable = await resetLinkUsable(token);
  // the device's language, as on the login page (no user here)
  const { tr } = await pageTr();
  return (
    <Shell title={tr("Új jelszó")} user={null}>
      <div className="login-wrap">
      <div className="card login-card">
        <h2>{tr("Új jelszó")}</h2>
        {usable ? (
          <ResetPasswordForm token={token} />
        ) : (
          <>
            <p data-testid="reset-gone">{tr("Ez a link lejárt, már felhasználták, vagy nem érvényes. Kérj újat az adminisztrátortól.")}</p>
            <p>
              <Link href="/belepes">{tr("Vissza a belépéshez")}</Link>
            </p>
          </>
        )}
      </div>
      </div>
    </Shell>
  );
}
