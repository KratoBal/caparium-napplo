import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { sameOrigin, userFromRequest, type SessionUser } from "./auth";
import { AppError } from "./errors";
import type { Lang } from "./i18n/lang";
import { requestLang } from "./i18n/request";
import { translate } from "./i18n/translate";

/** The error as JSON, its message in the request's language (lib/i18n): Hungarian when there is no English for it. */
export function errorResponse(e: unknown, lang: Lang = "hu"): NextResponse {
  const tr = (text: string) => translate(lang, text);
  if (e instanceof AppError) {
    return NextResponse.json({ error: { code: e.code, message: tr(e.message), ...e.details } }, { status: e.status });
  }
  if (e instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: tr("Hibás kérés."), issues: e.issues.map((i) => ({ path: i.path, message: tr(i.message) })) } },
      { status: 400 },
    );
  }
  console.error("unhandled API error", e);
  return NextResponse.json({ error: { code: "INTERNAL", message: tr("Váratlan hiba. Az adat nem mentődött.") } }, { status: 500 });
}

type Handler = (user: SessionUser) => Promise<unknown>;

/** Auth + CSRF + error mapping for JSON API routes. Writes require the same origin. */
export async function handle(req: Request, fn: Handler, opts: { write: boolean } = { write: true }): Promise<NextResponse> {
  const lang = requestLang(req);
  try {
    if (opts.write && !sameOrigin(req)) {
      return NextResponse.json({ error: { code: "BAD_ORIGIN", message: translate(lang, "Érvénytelen kérés-forrás.") } }, { status: 403 });
    }
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: translate(lang, "Jelentkezz be újra.") } }, { status: 401 });
    const result = await fn(user);
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e, lang);
  }
}

export async function parseJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new AppError(400, "BAD_JSON", "Hibás kérés.");
  }
  return schema.parse(body);
}
