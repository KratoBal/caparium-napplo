// A ONE-TIME PASSWORD RESET LINK (task e7f9e84d, Lili 2026-11-01 20:01 UTC: a convenient reset before live use).
//
// The link carries a random 32-byte token; only its sha256 is stored (as for a session), so a copy of the table cannot reset
// anyone. A link is used once, only before it expires, only for an active user, and a new link for the same user ends the
// earlier unused ones (they are expired, not deleted: the app role has no DELETE here, and the row is the history). Setting
// the new password ends every session of the user and is audited without the password.
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { writeAudit } from "./audit";
import { hashPassword } from "./auth";
import { prisma, type Tx } from "./db";
import { AppError } from "./errors";

/** The admin's link is handed over in person, so it lives a day; the e-mailed one (slice 2) half an hour. */
export const RESET_LINK_TTL_MS = { admin: 24 * 60 * 60 * 1000, mail: 30 * 60 * 1000 } as const;

export const RESET_PATH = "/jelszo-visszaallitas";

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

/** Makes a link's token for the user, ending the earlier unused ones; the raw token is returned once and stored nowhere. */
export async function issueResetToken(
  tx: Tx,
  input: { userId: string; createdById: string | null; ttlMs: number },
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  await tx.passwordReset.updateMany({ where: { userId: input.userId, usedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } });
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + input.ttlMs);
  await tx.passwordReset.create({ data: { id: hashOf(token), userId: input.userId, createdById: input.createdById, expiresAt } });
  return { token, expiresAt };
}

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: z.string().min(10, "Az új jelszó legalább 10 karakter legyen.").max(200),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

const GONE = "Ez a link lejárt, már felhasználták, vagy nem érvényes. Kérj újat az adminisztrátortól.";

/** Whether the link can still be used (the page asks before it shows the form). */
export async function resetLinkUsable(token: string, now = new Date()): Promise<boolean> {
  const row = await prisma.passwordReset.findUnique({ where: { id: hashOf(token) }, include: { user: true } });
  return !!row && row.usedAt === null && row.expiresAt > now && row.user.active;
}

/**
 * Sets the new password through a link. The link is taken in the same write that checks it (usedAt from null), so two
 * submissions of one link set one password; every session of the user ends; the audit names the change, not the password.
 */
export async function resetPassword(input: ResetPasswordInput, client: string | null, now = new Date()) {
  const passwordHash = await hashPassword(input.newPassword);
  await prisma.$transaction(async (tx) => {
    const row = await tx.passwordReset.findUnique({ where: { id: hashOf(input.token) }, include: { user: true } });
    if (!row || !row.user.active) throw new AppError(410, "RESET_LINK_GONE", GONE);
    const taken = await tx.passwordReset.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (taken.count !== 1) throw new AppError(410, "RESET_LINK_GONE", GONE);
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
    await tx.session.deleteMany({ where: { userId: row.userId } });
    await writeAudit(tx, {
      userId: row.userId,
      action: "MASTER_CHANGE",
      entityType: "User",
      entityId: row.userId,
      changes: { password: { before: null, after: "új jelszó beállítva (visszaállító link)" } },
      client,
    });
  });
  return { ok: true };
}
