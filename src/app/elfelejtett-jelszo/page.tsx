import Link from "next/link";
import { redirect } from "next/navigation";
import { ForgotPasswordForm } from "@/components/ResetPasswordForm";
import { Shell } from "@/components/Shell";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// task e7f9e84d, slice 2: the login page's "Elfelejtettem a jelszavam"
export default async function ForgotPasswordPage() {
  if (await currentUser()) redirect("/");
  return (
    <Shell title="Elfelejtett jelszó" user={null}>
      <div className="login-wrap">
        <div className="card login-card">
          <h2>Elfelejtett jelszó</h2>
          <p className="hint">
            Add meg a felhasználóneved vagy az e-mail címed. Ha a fiókodhoz tartozik e-mail cím, oda küldünk egy fél óráig érvényes
            linket. Ha nincs megadva címed, az adminisztrátor tud visszaállító linket adni.
          </p>
          <ForgotPasswordForm />
          <p>
            <Link href="/belepes">Vissza a belépéshez</Link>
          </p>
        </div>
      </div>
    </Shell>
  );
}
