import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { businessDayOf, formatDayLong } from "@/lib/time";

type NavKey = "overview" | "daily" | "weekly" | "log" | "export" | "animals" | "feeds" | "feeding" | "eating" | "pending" | "settings";

const NAV: { key: NavKey | null; href: string | null; label: string; note?: string }[] = [
  { key: "overview", href: "/", label: "Áttekintés" },
  { key: "daily", href: "/vizmeres", label: "Napi vízmérés" },
  { key: "weekly", href: "/heti", label: "Heti vízmérés" },
  { key: "log", href: "/naplo", label: "Vízmérési napló" },
  { key: "export", href: "/export", label: "Export" },
  { key: "animals", href: "/allatok", label: "Állatok" },
  { key: "feeds", href: "/takarmanyok", label: "Takarmánylista" },
  { key: "feeding", href: "/etetes", label: "Takarmánynapló" },
  { key: "eating", href: "/evesi-naplo", label: "Evési napló" },
];

export function Shell({
  title,
  active,
  user,
  children,
}: {
  title: string;
  active?: NavKey;
  user: SessionUser | null;
  children: React.ReactNode;
}) {
  const today = formatDayLong(businessDayOf(new Date()));
  return (
    <div className="shell">
      <div className="brand">
        <div className="brand-title">CÁPÁRIUM</div>
        <div className="brand-sub">nAPPló</div>
      </div>
      <header className="topbar">
        <h1>{title}</h1>
        <span className="pill" data-testid="today">{today}</span>
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
          [
            ...NAV,
            ...(user.role === "ADMIN"
              ? [
                  { key: "pending" as NavKey, href: "/fuggo", label: "Függő mentések" },
                  { key: "settings" as NavKey, href: "/beallitasok", label: "Beállítások" },
                ]
              : []),
          ].map((n) =>
            n.href ? (
              <Link key={n.label} href={n.href} className={n.key === active ? "active" : undefined}>
                {n.label}
              </Link>
            ) : (
              <span key={n.label} className="disabled" aria-disabled="true">
                {n.label}
                {n.note && <small>({n.note})</small>}
              </span>
            ),
          )}
        <div className="nav-foot">CÁPASULI • TESZTKÖRNYEZET</div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
