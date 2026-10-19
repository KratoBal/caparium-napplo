import { clearSessionCookie, logout, readCookie, sameOrigin, SESSION_COOKIE } from "@/lib/auth";
import { seeOther } from "@/lib/redirect";

export async function POST(req: Request) {
  if (sameOrigin(req)) await logout(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
  return seeOther("/belepes", clearSessionCookie());
}
