import { login, sameOrigin, sessionCookie } from "@/lib/auth";
import { clientIp, FailureLimiter } from "@/lib/basic-auth";
import { seeOther } from "@/lib/redirect";

// Per client address, independent of the basic-auth gate (the public test runs without it,
// Balázs 2026-10-19 12:42 UTC): 20 login attempts in 15 minutes from one address, then a pause.
// The address is the last X-Forwarded-For entry, the one the proxy appended (src/lib/basic-auth.ts).
const addressLimiter = new FailureLimiter(20, 15 * 60_000);

// Plain form POST (works without JavaScript); answers with a redirect.
// A locked login id and an unknown or wrong one get the SAME answer (review 32580): the answer must
// not tell whether a login id exists. The audit still records which it was.
export async function POST(req: Request) {
  const back = (q: string) => seeOther(`/belepes?${q}`);
  if (!sameOrigin(req)) return back("hiba=forras");
  const ip = clientIp(req.headers);
  if (addressLimiter.blocked(ip)) return back("hiba=sok");
  // counted at once, BEFORE any await (review 32585): the check and the count are one step, so
  // parallel attempts from one address cannot all pass blocked() before the first one is counted;
  // a success is not refunded (20 attempts in 15 minutes is plenty for a person)
  addressLimiter.fail(ip);
  const form = await req.formData().catch(() => null);
  const loginId = String(form?.get("loginId") ?? "");
  const password = String(form?.get("password") ?? "");
  if (!loginId || !password || loginId.length > 100 || password.length > 200) return back("hiba=adat");
  const client = req.headers.get("user-agent")?.slice(0, 200) ?? null;
  const result = await login(loginId, password, client);
  if (!result.ok) return back(result.code === "BUSY" ? "hiba=sok" : "hiba=adat");
  return seeOther("/", sessionCookie(result.token, result.expiresAt, process.env.COOKIE_SECURE === "true"));
}
