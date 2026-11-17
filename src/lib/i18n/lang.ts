// THE LANGUAGE OF THE SCREENS (Lili 2026-11-17, task t-20261117-caparium-angol-alap). One account can be used by a
// Hungarian colleague and by a foreign student in turn (no separate student user: Lili's decision, acrobot 54635), so
// the language belongs to the DEVICE: the header's HU/EN switch writes a cookie, and that wins. The user's own setting
// (Profil) is only the default, written into the cookie at login when the device has none yet. Server messages follow
// the request's cookie too, so a page and its errors always speak the same language.
// Pure: no Next import, so the unit tests and both the server and the client use it.

export type Lang = "hu" | "en";
export const LANGS: readonly Lang[] = ["hu", "en"];
export const LANG_COOKIE = "nyelv";
/** a year: a device keeps its language until someone switches it */
export const LANG_COOKIE_MAX_AGE = 365 * 24 * 3600;

export function parseLang(value: string | null | undefined): Lang | null {
  return value === "hu" || value === "en" ? value : null;
}

/** The device's choice when it has one, else the user's default, else Hungarian. */
export function resolveLang(cookie: string | null | undefined, userDefault?: "HU" | "EN" | null): Lang {
  return parseLang(cookie) ?? (userDefault === "EN" ? "en" : "hu");
}

/** The Set-Cookie value for a language (path / so every page and the API read it; Lax like the session cookie). */
export function langCookie(lang: Lang, secure: boolean): string {
  return `${LANG_COOKIE}=${lang}; Path=/; Max-Age=${LANG_COOKIE_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
