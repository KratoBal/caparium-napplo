import { NextResponse } from "next/server";
import { errorResponse, parseJson } from "@/lib/api";
import { sameOrigin } from "@/lib/auth";
import { clientIp, FailureLimiter } from "@/lib/basic-auth";
import { requestPasswordReset, requestResetSchema } from "@/lib/password-reset-mail";

// Per client address, before anything else (as the login): 10 requests in 15 minutes, then the same answer and nothing done.
const addressLimiter = new FailureLimiter(10, 15 * 60_000);

/** The one answer, whatever happened: it must not tell whether a login id or an address exists (task e7f9e84d). */
const SAME = { ok: true, message: "Ha a megadott névhez vagy címhez tartozik e-mail cím, elküldtük rá a visszaállító linket." };

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: { code: "BAD_ORIGIN", message: "Érvénytelen kérés-forrás." } }, { status: 403 });
    }
    const ip = clientIp(req.headers);
    if (addressLimiter.blocked(ip)) return NextResponse.json(SAME);
    addressLimiter.fail(ip);
    const { identifier } = await parseJson(req, requestResetSchema);
    const outcome = await requestPasswordReset(identifier);
    if (outcome !== "SENT" && outcome !== "NO_MATCH" && outcome !== "NO_ADDRESS") console.warn(`password reset request: ${outcome}`);
    return NextResponse.json(SAME);
  } catch (e) {
    return errorResponse(e);
  }
}
