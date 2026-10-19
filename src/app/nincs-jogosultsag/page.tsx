import Link from "next/link";
import { Shell } from "@/components/Shell";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NoAccessPage() {
  const user = await requireUser();
  return (
    <Shell title="Nincs jogosultság" user={user}>
      <div className="card" data-testid="no-access">
        <h2>Ehhez a modulhoz nincs jogosultságod.</h2>
        <p className="hint">Ha szükséged van rá, az adminisztrátor tudja megadni.</p>
        <p>
          <Link href="/">Vissza az áttekintéshez</Link>
        </p>
      </div>
    </Shell>
  );
}
