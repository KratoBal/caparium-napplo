import { login, sameOrigin, sessionCookie } from "@/lib/auth";
import { seeOther } from "@/lib/redirect";

// Plain form POST (works without JavaScript); answers with a redirect.
export async function POST(req: Request) {
  const back = (q: string) => seeOther(`/belepes?${q}`);
  if (!sameOrigin(req)) return back("hiba=forras");
  const form = await req.formData().catch(() => null);
  const loginId = String(form?.get("loginId") ?? "");
  const password = String(form?.get("password") ?? "");
  if (!loginId || !password || loginId.length > 100 || password.length > 200) return back("hiba=adat");
  const client = req.headers.get("user-agent")?.slice(0, 200) ?? null;
  const result = await login(loginId, password, client);
  if (!result.ok) return back(result.code === "LOCKED" ? "hiba=zarolva" : "hiba=adat");
  return seeOther("/", sessionCookie(result.token, result.expiresAt, process.env.COOKIE_SECURE === "true"));
}
