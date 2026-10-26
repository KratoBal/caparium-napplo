// The main navigation as data, so its order and who sees which entry can be tested without rendering.
export type NavKey =
  | "overview" | "daily" | "weekly" | "log" | "export" | "animals" | "feeds" | "feeding" | "eating"
  | "feedlog" | "withdrawal" | "calculator" | "dosing" | "reports" | "pending" | "settings";

export type NavItem = { key: NavKey; href: string; label: string };

// Lili 2026-10-26 (card f67b1a06): "Takarmánylista" sits directly above "Kimutatások", for everyone.
const NAV: NavItem[] = [
  { key: "overview", href: "/", label: "Áttekintés" },
  { key: "daily", href: "/vizmeres", label: "Napi vízmérés" },
  { key: "weekly", href: "/heti", label: "Heti vízmérés" },
  { key: "log", href: "/naplo", label: "Vízmérési napló" },
  { key: "export", href: "/export", label: "Export" },
  { key: "animals", href: "/allatok", label: "Állatok" },
  { key: "feeding", href: "/etetes", label: "Takarmánynapló" },
  { key: "eating", href: "/evesi-naplo", label: "Evési napló" },
  { key: "feedlog", href: "/takarmany-naplo", label: "Takarmányozási napló" },
  { key: "calculator", href: "/kalkulator", label: "Takarmánykalkulátor" },
  { key: "withdrawal", href: "/kivetel", label: "Takarmánykivétel" },
  { key: "dosing", href: "/adagolas", label: "Vegyszeradagolás" },
  { key: "feeds", href: "/takarmanyok", label: "Takarmánylista" },
  { key: "reports", href: "/kimutatasok", label: "Kimutatások" },
];

const ADMIN_ONLY: NavKey[] = ["animals"];

const ADMIN_EXTRA: NavItem[] = [
  { key: "pending", href: "/fuggo", label: "Függő mentések" },
  { key: "settings", href: "/beallitasok", label: "Beállítások" },
];

/**
 * The entries a role sees. The animal list is for admins only for now (Lili 2026-10-26 09:51 UTC,
 * msg 1564214896453750805): the page itself checks the same rule, hiding the entry is not the guard.
 */
export function navFor(role: "ADMIN" | "AQUARIST" | "SYSTEM"): NavItem[] {
  const admin = role === "ADMIN";
  return [...NAV.filter((n) => admin || !ADMIN_ONLY.includes(n.key)), ...(admin ? ADMIN_EXTRA : [])];
}
