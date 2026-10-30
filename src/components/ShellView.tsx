import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import type { HelperData } from "@/lib/helpers";
import { greetingName } from "@/lib/helper-notice";
import { navFor, type NavKey } from "@/lib/nav";
import { Helper } from "./Helper";
import { HelperToggle } from "./HelperToggle";
import { ReasonProvider } from "./ReasonSwitch";
import { TopbarUser } from "./TopbarUser";

/**
 * The page's frame, without a database in it (Shell reads what it needs and hands it over): so the frame is one component the page and a preview
 * both use. The brand and the topbar stand in a `head`, which on a tablet and a desktop is no box at all (display: contents), and on a phone is
 * the one compact row (globals.css).
 */
export function ShellView({
  title,
  active,
  user,
  helper,
  today,
  reasons,
  monogram,
  children,
}: {
  title?: string;
  active?: NavKey;
  user: SessionUser | null;
  helper?: HelperData | null;
  /** the day as the pill shows it */
  today: string;
  reasons: boolean;
  /** the user's monogram for the phone's profile button */
  monogram: string;
  children: React.ReactNode;
}) {
  return (
    <div className="shell">
      <div className="head">
        <div className="brand">
          <div className="brand-title">CÁPÁRIUM</div>
          <div className="brand-sub">nAPPló</div>
        </div>
        <header className="topbar">
          {title && <h1>{title}</h1>}
          <span className="pill" data-testid="today">{today}</span>
          {!title && <span style={{ flex: 1 }} aria-hidden="true" />}
          {user ? (
            <TopbarUser name={user.fullName} roleLabel={user.role === "ADMIN" ? "adminisztrátor" : "akvarista"} monogram={monogram} helper={!!helper} />
          ) : (
            /* the helper's switch, only on a page that has one (card 8b22c3c2) */
            helper && <HelperToggle />
          )}
        </header>
      </div>
      <nav className="nav" aria-label="Fő navigáció">
        {user &&
          navFor(user.role).map((n) => (
            <Link
              key={n.label}
              href={n.href}
              className={[n.tone ? `nav-${n.tone}` : "", n.key === active ? "active" : ""].filter(Boolean).join(" ") || undefined}
            >
              {n.icon && (
                <span className="nav-icon" aria-hidden="true">
                  {n.icon}
                </span>
              )}
              {n.label}
            </Link>
          ))}
        <div className="nav-foot">CÁPASULI • TESZTKÖRNYEZET</div>
      </nav>
      <main className="main">
        <ReasonProvider on={reasons}>{children}</ReasonProvider>
      </main>
      {helper && <Helper data={helper} userName={user ? greetingName(user) : undefined} loginAt={user?.sessionStartedAt} userKey={user?.id} />}
    </div>
  );
}
