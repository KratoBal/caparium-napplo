// The user's own settings (Lili 2026-11-01, point 11): every user changes their own password and display name. The
// monogram and the ZIMS name stay with the admin (Beállítások, Felhasználók): they are on the measurements and in the
// ZIMS export, and a change there is versioned (the old measurements keep the old monogram, K3).
import { z } from "zod";
import { writeAudit } from "./audit";
import { checkOwnPassword, hashPassword, sessionIdOf, type SessionUser } from "./auth";
import { prisma } from "./db";
import { AppError, isUniqueViolation } from "./errors";
import { EMAIL_TAKEN, emailOrNull, userEmailField } from "./user-email";

export const ownProfileSchema = z
  .object({
    requestId: z.string().min(8).max(100),
    fullName: z
      .string()
      .trim()
      .min(2, "A név legalább 2 karakter legyen.")
      .max(100)
      .refine((v) => !/^[=+\-@\t\r]/.test(v), "A név nem kezdődhet =, +, -, @ jellel (táblázatkezelőben képletként futna).")
      .optional(),
    /** point 17: the greeting's name; "" clears it (the given name then) */
    nickname: z.string().trim().max(40).optional(),
    /** task e7f9e84d: the address a forgotten password's link goes to; "" clears it */
    email: userEmailField.optional(),
    currentPassword: z.string().max(200).optional(),
    newPassword: z.string().min(10, "Az új jelszó legalább 10 karakter legyen.").max(200).optional(),
  })
  .refine((v) => v.newPassword === undefined || !!v.currentPassword, { message: "Add meg a jelenlegi jelszavadat.", path: ["currentPassword"] });
export type OwnProfileInput = z.infer<typeof ownProfileSchema>;

/**
 * Saves what the user changed of their own profile. A new password needs the current one, and ends every other session
 * of the user (this one stays, so the page does not log them out). Audited as the user's own change.
 */
export async function updateOwnProfile(actor: SessionUser, input: OwnProfileInput, session: { token?: string; client: string | null }) {
  if (actor.role === "SYSTEM") throw new AppError(403, "FORBIDDEN", "Nincs jogosultság.");
  if ((await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) !== null) return { replayed: true };
  const u = await prisma.user.findUnique({ where: { id: actor.id } });
  if (!u || !u.active) throw new AppError(404, "NOT_FOUND", "A felhasználó nem található.");
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  if (input.fullName !== undefined && input.fullName !== u.fullName) changes.fullName = { before: u.fullName, after: input.fullName };
  const nickname = input.nickname === undefined ? undefined : input.nickname || null;
  if (nickname !== undefined && nickname !== u.nickname) changes.nickname = { before: u.nickname, after: nickname };
  const email = emailOrNull(input.email);
  if (email !== undefined && email !== u.email) changes.email = { before: u.email, after: email };
  let passwordHash: string | undefined;
  if (input.newPassword !== undefined) {
    const check = await checkOwnPassword(u.id, input.currentPassword ?? "", session.client);
    if (check === "LOCKED") throw new AppError(429, "LOCKED", "Túl sok hibás jelszó. Próbáld újra 15 perc múlva.");
    if (check === "BUSY") throw new AppError(503, "BUSY", "A szerver most foglalt. Próbáld újra egy perc múlva.");
    if (check !== "OK") throw new AppError(422, "WRONG_PASSWORD", "A jelenlegi jelszó nem helyes.");
    if (input.newPassword === input.currentPassword) throw new AppError(422, "SAME_PASSWORD", "Az új jelszó ugyanaz, mint a régi.");
    passwordHash = await hashPassword(input.newPassword);
    changes.password = { before: null, after: "új jelszó beállítva (saját)" };
  }
  if (Object.keys(changes).length === 0) throw new AppError(422, "NO_CHANGE", "Nincs változás.");
  const keep = session.token ? sessionIdOf(session.token) : null;
  await prisma
    .$transaction(async (tx) => {
    await tx.user.update({
      where: { id: u.id },
      data: {
        ...(changes.fullName ? { fullName: input.fullName } : {}),
        ...(changes.nickname ? { nickname } : {}),
        ...(changes.email ? { email } : {}),
        ...(passwordHash ? { passwordHash } : {}),
      },
    });
    // the other devices log in again with the new password; this one stays
    if (passwordHash) await tx.session.deleteMany({ where: { userId: u.id, ...(keep ? { id: { not: keep } } : {}) } });
    await writeAudit(tx, { userId: u.id, action: "MASTER_CHANGE", entityType: "User", entityId: u.id, changes, requestId: input.requestId, client: session.client });
    })
    .catch((e: unknown) => {
      if (isUniqueViolation(e, "email")) throw new AppError(409, "EMAIL_TAKEN", EMAIL_TAKEN);
      throw e;
    });
  return { replayed: false };
}
