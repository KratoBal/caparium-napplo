import Link from "next/link";
import { Fragment } from "react";
import type { SessionUser } from "@/lib/auth";
import type { HelperData } from "@/lib/helpers";
import { greetingName } from "@/lib/helper-notice";
import type { Lang } from "@/lib/i18n/lang";
import { translate } from "@/lib/i18n/translate";
import { navChildren, navFor, phoneGroups, type NavKey } from "@/lib/nav";
import { Helper } from "./Helper";
import { HelperToggle } from "./HelperToggle";
import { HydratedMain } from "./HydratedMain";
import { LangProvider } from "./LangProvider";
import { LangSwitch } from "./LangSwitch";
import { NavGroup } from "./NavGroup";
import { NavSub } from "./NavSub";
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
  lang = "hu",
  guard = true,
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
  /** the device's language (lib/i18n/lang.ts) */
  lang?: Lang;
  /** the main area inert until hydration (Shell decides: a user, or a page's own React-state form) */
  guard?: boolean;
  children: React.ReactNode;
}) {
  const tr = (text: string) => translate(lang, text);
  return (
    <LangProvider lang={lang}>
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
          <LangSwitch inHeader={!!user} />
          {user ? (
            <TopbarUser name={user.fullName} roleLabel={tr(user.role === "ADMIN" ? "adminisztrátor" : "akvarista")} monogram={monogram} helper={!!helper} />
          ) : (
            /* the helper's switch, only on a page that has one (card 8b22c3c2) */
            helper && <HelperToggle />
          )}
        </header>
      </div>
      <nav className="nav" aria-label={tr("Fő navigáció")}>
        {user && <NavLinks items={navFor(user.role).map((n) => ({ ...n, label: tr(n.label) }))} active={active} tr={tr} />}
        <div className="nav-foot">{tr("CÁPASULI • TESZTKÖRNYEZET")}</div>
      </nav>
      {/* guarded unless the page turns it off: only the login, a native form that must work even when the scripts fail (Shell's guard) */}
      <HydratedMain className="main" guard={guard}>
        <ReasonProvider on={reasons}>{children}</ReasonProvider>
      </HydratedMain>
      {helper && <Helper data={helper} userName={user ? greetingName(user) : undefined} loginAt={user?.sessionStartedAt} userKey={user?.id} />}
    </div>
    </LangProvider>
  );
}

/**
 * The menu entries. A colored entry is also part of its group's phone drop-down, which stands before the group's first entry: on a
 * phone the drop-downs show and the colored entries hide, on a tablet and a desktop the other way round (globals.css), so the server
 * renders one markup for both and nothing jumps at hydration.
 */
function NavLinks({ items, active, tr }: { items: ReturnType<typeof navFor>; active?: NavKey; tr: (text: string) => string }) {
  const groups = phoneGroups(items);
  // an entry with a `parent` is rendered inside its parent's drop-down (NavSub), not in the row
  return items.filter((n) => !n.parent).map((n) => {
    const group = groups.get(n.key);
    const children = navChildren(items, n.key);
    if (children.length) return <NavSub key={n.label} parent={n} items={children} active={active} />;
    return (
      <Fragment key={n.label}>
        {group && <NavGroup label={tr(group.label)} tone={group.tone} items={group.items} active={active} />}
        <Link
          href={n.href}
          className={[n.tone ? `nav-${n.tone} nav-in-group` : "", n.key === active ? "active" : ""].filter(Boolean).join(" ") || undefined}
        >
          {n.icon && (
            <span className="nav-icon" aria-hidden="true">
              {n.icon}
            </span>
          )}
          {n.label}
        </Link>
      </Fragment>
    );
  });
}
