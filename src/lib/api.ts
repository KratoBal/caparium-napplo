import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { sameOrigin, userFromRequest, type SessionUser } from "./auth";
import { AppError } from "./errors";

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof AppError) {
    return NextResponse.json({ error: { code: e.code, message: e.message, ...e.details } }, { status: e.status });
  }
  if (e instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Hibás kérés.", issues: e.issues.map((i) => ({ path: i.path, message: i.message })) } },
      { status: 400 },
    );
  }
  console.error("unhandled API error", e);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Váratlan hiba. Az adat nem mentődött." } }, { status: 500 });
}

type Handler = (user: SessionUser) => Promise<unknown>;

/** Auth + CSRF + error mapping for JSON API routes. Writes require the same origin. */
export async function handle(req: Request, fn: Handler, opts: { write: boolean } = { write: true }): Promise<NextResponse> {
  try {
    if (opts.write && !sameOrigin(req)) {
      return NextResponse.json({ error: { code: "BAD_ORIGIN", message: "Érvénytelen kérés-forrás." } }, { status: 403 });
    }
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Jelentkezz be újra." } }, { status: 401 });
    const result = await fn(user);
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
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
