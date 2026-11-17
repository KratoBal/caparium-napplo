// The language of an API request: its cookie (lib/i18n/lang.ts). Hungarian without one. No Next import, so lib/api.ts
// can use it in every route.
import { readCookie } from "../auth";
import { LANG_COOKIE, resolveLang, type Lang } from "./lang";

export function requestLang(req: Request): Lang {
  return resolveLang(readCookie(req.headers.get("cookie"), LANG_COOKIE));
}
