// The main navigation as data, so its order and who sees which entry can be tested without rendering.
export type NavKey =
  | "overview" | "daily" | "weekly" | "log" | "export" | "animals" | "feeds" | "feeding" | "eating"
  | "feedlog" | "withdrawal" | "calculator" | "dosing" | "reports" | "pending" | "settings";

/** The label color group of an entry: the water measurement group or the feeding group (Lili 2026-10-26). */
export type NavTone = "water" | "feed";

export type NavItem = { key: NavKey; href: string; label: string; tone?: NavTone };

// Lili 2026-10-26 (caparium-menu-sorrend-szinek, channel msg 1564292920016904403 and 1564295015704957030): the
// order of the list she sent, and a label color for two groups (#A8DDE0 water, #FFCFC2 feeding, in globals.css).
// Everything else keeps the plain label color. "Takarmánylista" still sits directly above "Kimutatások" (card
// f67b1a06), for everyone.
const NAV: NavItem[] = [
  // Lili 2026-10-27 13:02 UTC: the first entry is called START
  { key: "overview", href: "/", label: "START" },
  { key: "daily", href: "/vizmeres", label: "Napi vízmérés", tone: "water" },
  { key: "weekly", href: "/heti", label: "Heti vízmérés", tone: "water" },
  { key: "export", href: "/export", label: "Export" },
  { key: "feeding", href: "/etetes", label: "Takarmánynapló", tone: "feed" },
  { key: "eating", href: "/evesi-naplo", label: "Evési napló", tone: "feed" },
  { key: "withdrawal", href: "/kivetel", label: "Takarmánykivétel", tone: "feed" },
  { key: "calculator", href: "/kalkulator", label: "Takarmánykalkulátor", tone: "feed" },
  { key: "dosing", href: "/adagolas", label: "Vegyszeradagolás", tone: "water" },
  { key: "log", href: "/naplo", label: "Vízmérési napló", tone: "water" },
  { key: "feedlog", href: "/takarmany-naplo", label: "Takarmányozási napló", tone: "feed" },
  { key: "feeds", href: "/takarmanyok", label: "Takarmánylista", tone: "feed" },
  { key: "reports", href: "/kimutatasok", label: "Kimutatások" },
];

// The admin entries, in Lili's order: Függő mentések, Állatok, Beállítások. The animal list is admin only for
// now (Lili 2026-10-26 09:51 UTC, msg 1564214896453750805).
const ADMIN_EXTRA: NavItem[] = [
  { key: "pending", href: "/fuggo", label: "Függő mentések" },
  { key: "animals", href: "/allatok", label: "Állatok" },
  { key: "settings", href: "/beallitasok", label: "Beállítások" },
];

/**
 * The entries a role sees. The animal list is for admins only for now: the page itself checks the same rule,
 * hiding the entry is not the guard.
 */
export function navFor(role: "ADMIN" | "AQUARIST" | "SYSTEM"): NavItem[] {
  const admin = role === "ADMIN";
  return [...NAV, ...(admin ? ADMIN_EXTRA : [])];
}
