// Runs before every request (Next 16 proxy, formerly middleware). The only job: the basic-auth gate
// of the public test site (src/lib/basic-auth.ts). No matcher, so pages, /api and /_next are all
// behind it. The one exception is the exact path /api/health, which answers only {ok, commit} (the
// deployed commit, src/lib/release.ts: no data, no secret) and is what the container healthcheck calls
// from inside; the raw request URL is checked, not nextUrl, which
// rewrites some internal paths. The web app's manifest and icons are the other exception (APP_FILES below).
import { NextResponse, type NextRequest } from "next/server";
import { checkCredentials, clientIp, effectiveGate, FailureLimiter } from "@/lib/basic-auth";

const limiter = new FailureLimiter();

// The web app's manifest and its icons (Lili 2026-10-31, task caparium-webapp-ikon, card 135b457e). A phone asks for them WITHOUT the site's
// credentials (the manifest and the home-screen icon requests carry none), so behind the gate they would answer 401 and the app could not be put on
// the home screen with its logo. The EXACT list below, read-only methods only: the logo's pictures and a file of names, no data and no secret.
// Every other path, a neighbour of these included, stays behind the gate. Taking this list out takes the exception out.
const APP_FILES = new Set([
  "/manifest.webmanifest",
  "/icons/apple-touch-icon.png",
  "/icons/icon-32.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
]);

const challenge = (status: 401 | 429 | 503, text: string) =>
  new NextResponse(text, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...(status === 401 ? { "WWW-Authenticate": 'Basic realm="Caparium nAPPlo teszt", charset="UTF-8"' } : {}),
    },
  });

export async function proxy(request: NextRequest) {
  const gate = effectiveGate(process.env, request.headers);
  if (gate.mode === "off") return NextResponse.next();
  if (new URL(request.url).pathname === "/api/health") return NextResponse.next();
  if (gate.mode === "misconfigured") return challenge(503, "A teszthozzaferes nincs helyesen beallitva.");
  if ((request.method === "GET" || request.method === "HEAD") && APP_FILES.has(new URL(request.url).pathname)) return NextResponse.next();

  const ip = clientIp(request.headers);
  if (limiter.blocked(ip)) return challenge(429, "Tul sok sikertelen probalkozas. Probald ujra 15 perc mulva.");
  const header = request.headers.get("authorization");
  if (await checkCredentials(header, gate.cfg)) return NextResponse.next();
  if (header) limiter.fail(ip);
  return challenge(401, "Bejelentkezes szukseges.");
}
