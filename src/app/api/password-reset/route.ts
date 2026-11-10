import { NextResponse } from "next/server";
import { errorResponse, parseJson } from "@/lib/api";
import { sameOrigin } from "@/lib/auth";
import { resetPassword, resetPasswordSchema } from "@/lib/password-reset";

// task e7f9e84d: the new password through a one-time link. No session (the user cannot log in), so the link's token is the
// authority; a write still needs the same origin.
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: { code: "BAD_ORIGIN", message: "Érvénytelen kérés-forrás." } }, { status: 403 });
    }
    const input = await parseJson(req, resetPasswordSchema);
    return NextResponse.json(await resetPassword(input, req.headers.get("user-agent")?.slice(0, 200) ?? null));
  } catch (e) {
    return errorResponse(e);
  }
}
