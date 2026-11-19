import Link from "next/link";
import { Shell } from "@/components/Shell";
import { pageTr } from "@/lib/i18n/server";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NoAccessPage() {
  const user = await requireUser();
  const { tr } = await pageTr(user);
  return (
    <Shell title={tr("Nincs jogosultság")} user={user}>
      <div className="card" data-testid="no-access">
        <h2>{tr("Ehhez a modulhoz nincs jogosultságod.")}</h2>
        <p className="hint">{tr("Ha szükséged van rá, az adminisztrátor tudja megadni.")}</p>
        <p>
          <Link href="/">{tr("Vissza a START oldalra")}</Link>
        </p>
      </div>
    </Shell>
  );
}
