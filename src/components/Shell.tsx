import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import type { HelperData } from "@/lib/helpers";
import { Helper } from "./Helper";
import { ReasonProvider } from "./ReasonSwitch";
import { prisma } from "@/lib/db";
import { navFor, type NavKey } from "@/lib/nav";
import { reasonsRequired } from "@/lib/reasons";
import { businessDayOf, formatDayLong } from "@/lib/time";

export async function Shell({
  title,
  active,
  user,
  helper,
  children,
}: {
  /** none on the start page (Lili 2026-10-27 13:02 UTC): the bar keeps the day and the user */
  title?: string;
  active?: NavKey;
  user: SessionUser | null;
  /** AST-01: the page's helper, if it has one */
  helper?: HelperData | null;
  children: React.ReactNode;
}) {
  const today = formatDayLong(businessDayOf(new Date()));
  const reasons = await reasonsRequired(prisma);
  return (
    <div className="shell">
      <div className="brand">
        <div className="brand-title">CÁPÁRIUM</div>
        <div className="brand-sub">nAPPló</div>
      </div>
      <header className="topbar">
        {title && <h1>{title}</h1>}
        <span className="pill" data-testid="today">{today}</span>
        {!title && <span style={{ flex: 1 }} aria-hidden="true" />}
        {user && (
          <div className="userbox">
            <span data-testid="current-user">
              {user.fullName} · {user.role === "ADMIN" ? "adminisztrátor" : "akvarista"}
            </span>
            <form method="post" action="/api/auth/logout">
              <button className="btn btn-soft" type="submit">Kilépés</button>
            </form>
          </div>
        )}
      </header>
      <nav className="nav" aria-label="Fő navigáció">
        {user &&
          navFor(user.role).map((n) => (
            <Link
              key={n.label}
              href={n.href}
              className={[n.tone ? `nav-${n.tone}` : "", n.key === active ? "active" : ""].filter(Boolean).join(" ") || undefined}
            >
              {n.label}
            </Link>
          ))}
        <div className="nav-foot">CÁPASULI • TESZTKÖRNYEZET</div>
      </nav>
      <main className="main">
        <ReasonProvider on={reasons}>{children}</ReasonProvider>
      </main>
      {helper && <Helper data={helper} />}
    </div>
  );
}
