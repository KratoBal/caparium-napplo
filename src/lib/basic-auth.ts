// The basic-auth gate in front of the whole public test site (Balázs 2026-10-19 12:09 UTC:
// Lilian reaches the test on a public address with a password, without Tailscale).
// It stands before EVERY path (pages, /api, /_next), in the app itself, so it does not depend on
// router names the hosting platform generates. The app's own login stays behind it.
// Configuration from the environment (Coolify), never from the repository:
//   BASIC_AUTH_USER       the user name
//   BASIC_AUTH_SHA256     hex sha256 of the password, or
//   BASIC_AUTH_PASSWORD   the password itself (a Coolify-generated secret: the owner has no command
//                         line to compute a hash, and Coolify keeps the variable as a secret)
// Nothing set: the gate is off (local development, CI). A user without a password or a password
// without a user: closed (503), never open.
// Pure functions with Web Crypto, so they run in the proxy and in the tests alike.

export type BasicAuthConfig = { user: string; sha256?: string; password?: string };

export type GateConfig = { mode: "off" } | { mode: "misconfigured" } | { mode: "on"; cfg: BasicAuthConfig };

export function gateConfig(env: Record<string, string | undefined>): GateConfig {
  const user = env.BASIC_AUTH_USER?.trim() ?? "";
  const hash = env.BASIC_AUTH_SHA256?.trim().toLowerCase() ?? "";
  const password = env.BASIC_AUTH_PASSWORD ?? "";
  if (!user && !hash && !password) return { mode: "off" };
  if (!user) return { mode: "misconfigured" };
  if (hash) return /^[0-9a-f]{64}$/.test(hash) ? { mode: "on", cfg: { user, sha256: hash } } : { mode: "misconfigured" };
  if (password.length < 12) return { mode: "misconfigured" };
  return { mode: "on", cfg: { user, password } };
}

export function parseBasic(header: string | null): { user: string; pass: string } | null {
  if (!header) return null;
  const m = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header);
  if (!m) return null;
  let decoded: string;
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
  const i = decoded.indexOf(":");
  if (i < 0) return null;
  return { user: decoded.slice(0, i), pass: decoded.slice(i + 1) };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares in time independent of where the strings differ (both are fixed-length hex digests). */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function checkCredentials(header: string | null, cfg: BasicAuthConfig): Promise<boolean> {
  const c = parseBasic(header);
  if (!c) return false;
  // both compared as digests, so neither the user name nor the password leaks through timing
  const [u1, u2, p, expected] = await Promise.all([
    sha256Hex(c.user),
    sha256Hex(cfg.user),
    sha256Hex(c.pass),
    cfg.sha256 ? Promise.resolve(cfg.sha256) : sha256Hex(cfg.password ?? ""),
  ]);
  const userOk = sameHex(u1, u2);
  const passOk = sameHex(p, expected);
  return userOk && passOk;
}

/**
 * The client address behind the proxy: the LAST X-Forwarded-For entry is the one the proxy
 * itself appended; earlier entries come from the client and can be forged.
 */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return headers.get("x-real-ip") ?? "unknown";
}

/** Failed attempts per client address in a fixed window: MAX failures, then 429 until the window ends. */
export class FailureLimiter {
  private readonly hits = new Map<string, { count: number; until: number }>();
  constructor(
    private readonly max = 20,
    private readonly windowMs = 15 * 60_000,
  ) {}

  blocked(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || h.until <= now) return false;
    return h.count >= this.max;
  }

  fail(key: string, now = Date.now()): void {
    const h = this.hits.get(key);
    if (!h || h.until <= now) this.hits.set(key, { count: 1, until: now + this.windowMs });
    else h.count += 1;
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (v.until <= now) this.hits.delete(k);
    }
  }
}
