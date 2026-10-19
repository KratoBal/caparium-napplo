// Per-user login with a server-side session (ÁLT-17).
// Passwords: scrypt from node:crypto (no native dependency). Sessions: random token in an
// httpOnly cookie, only its sha256 stored in the database.

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { writeAudit } from "./audit";
import { prisma } from "./db";
import type { Role } from "./permissions";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

export const SESSION_COOKIE = "napplo_session";
const SESSION_HOURS = 12;
const SCRYPT = { N: 16384, r: 8, p: 1, len: 32 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.len, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type SessionUser = { id: string; fullName: string; loginId: string; role: Role };

const MAX_FAILURES = 10;
const FAILURE_WINDOW_MIN = 15;
// A fixed hash to spend the same time on unknown login ids as on known ones.
const DUMMY_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; user: SessionUser }
  | { ok: false; code: "INVALID" | "LOCKED" };

/** Checks the password, writes the LOGIN or LOGIN_FAILED audit entry, and opens a session. */
export async function login(loginId: string, password: string, client: string | null): Promise<LoginResult> {
  const id = loginId.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { loginId: id } });
  const since = new Date(Date.now() - FAILURE_WINDOW_MIN * 60_000);
  if (user) {
    const failures = await prisma.auditEntry.count({
      where: { action: "LOGIN_FAILED", entityType: "User", entityId: user.id, at: { gte: since } },
    });
    if (failures >= MAX_FAILURES) {
      // the same work as a wrong password, so the time of the answer does not tell either
      await verifyPassword(password, DUMMY_HASH);
      return { ok: false, code: "LOCKED" };
    }
  }
  const usable = user && user.active && user.role !== "SYSTEM" && user.passwordHash;
  const ok = await verifyPassword(password, usable ? user.passwordHash! : DUMMY_HASH);
  if (!usable || !ok) {
    if (user) {
      await prisma.$transaction((tx) =>
        writeAudit(tx, { userId: user.id, action: "LOGIN_FAILED", entityType: "User", entityId: user.id, client }),
      );
    }
    return { ok: false, code: "INVALID" };
  }
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000);
  await prisma.$transaction(async (tx) => {
    await tx.session.create({ data: { id: tokenHash(token), userId: user.id, expiresAt } });
    await writeAudit(tx, { userId: user.id, action: "LOGIN", entityType: "User", entityId: user.id, client });
  });
  return {
    ok: true,
    token,
    expiresAt,
    user: { id: user.id, fullName: user.fullName, loginId: user.loginId, role: user.role },
  };
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  const session = await prisma.session.findUnique({ where: { id: tokenHash(token) } });
  if (!session) return;
  await prisma.$transaction(async (tx) => {
    await tx.session.delete({ where: { id: session.id } });
    await writeAudit(tx, { userId: session.userId, action: "LOGOUT", entityType: "User", entityId: session.userId });
  });
}

export async function userForToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { id: tokenHash(token) }, include: { user: true } });
  if (!session || session.expiresAt <= new Date() || !session.user.active || session.user.role === "SYSTEM") return null;
  return { id: session.user.id, fullName: session.user.fullName, loginId: session.user.loginId, role: session.user.role };
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export async function userFromRequest(req: Request): Promise<SessionUser | null> {
  return userForToken(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
}

/**
 * CSRF guard for cookie-authenticated writes: the Origin (or Referer) must be this host.
 * The session cookie is also SameSite=Lax; this is the second layer.
 */
export function sameOrigin(req: Request): boolean {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  if (!host || !origin) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function sessionCookie(token: string, expiresAt: Date, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}
