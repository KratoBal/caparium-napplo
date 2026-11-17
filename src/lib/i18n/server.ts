// The language on the server: a page reads the device's cookie (and the user's default without one), an API route the
// request's cookie, so an error comes back in the language the page shows (lib/i18n/lang.ts).
import { cookies } from "next/headers";
import type { SessionUser } from "../auth";
import { LANG_COOKIE, resolveLang, type Lang } from "./lang";
import { translate, type TrVars } from "./translate";

export async function pageLang(user?: Pick<SessionUser, "language"> | null): Promise<Lang> {
  const store = await cookies();
  return resolveLang(store.get(LANG_COOKIE)?.value, user?.language);
}

/** The page's language and its translator, in one call. */
export async function pageTr(user?: Pick<SessionUser, "language"> | null): Promise<{ lang: Lang; tr: (text: string, vars?: TrVars) => string }> {
  const lang = await pageLang(user);
  return { lang, tr: (text, vars) => translate(lang, text, vars) };
}
