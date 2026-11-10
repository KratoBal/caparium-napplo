// THE FORGOTTEN PASSWORD BY E-MAIL (task e7f9e84d, slice 2): the login page asks for a login id or an e-mail address, and a
// one-time link (slice 3's machinery, half an hour) goes to the account's own address (slice 1).
//
// THE ANSWER NEVER TELLS: the route answers the same whatever happened (no such account, no address, mail not set up, too many
// requests, sent). What happened is returned here for the tests and the log, never to the caller.
//
// THE LINK'S ADDRESS COMES FROM THE CONFIGURATION, NOT THE REQUEST: a link built from the Host or Origin header would let a caller
// have a reset link to their own site mailed to a user. `CAPARIUM_PUBLIC_URL` (https, the site's root) names it; without it no
// mail goes, and the log says why.
import { z } from "zod";
import { writeAudit } from "./audit";
import { prisma } from "./db";
import { mailConfig, smtpSender, type MailSender } from "./mail";
import { issueResetToken, RESET_LINK_TTL_MS, RESET_PATH } from "./password-reset";

export const PUBLIC_URL_ENV = "CAPARIUM_PUBLIC_URL";

/** At most this many e-mailed links per account in the window: a mailbox is not flooded from the login page. */
export const MAIL_REQUESTS = { max: 3, windowMs: 15 * 60_000 } as const;

/** The site's root for links in mails: an https origin without credentials, or null. */
export function publicBaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env[PUBLIC_URL_ENV]?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export const requestResetSchema = z.object({ identifier: z.string().trim().min(1).max(254) });

export type ResetRequestOutcome = "SENT" | "NO_MATCH" | "NO_ADDRESS" | "NOT_CONFIGURED" | "THROTTLED" | "SEND_FAILED";

export type MailDeps = { env?: Record<string, string | undefined>; send?: MailSender };

/** The configured sender and its from address, or null when the mail or the public address is not set up. */
function mailer(deps: MailDeps): { send: MailSender; from: string; base: string } | null {
  const env = deps.env ?? process.env;
  const base = publicBaseUrl(env);
  let config;
  try {
    config = mailConfig(env);
  } catch {
    return null;
  }
  if (!base) return null;
  return { send: deps.send ?? smtpSender(config), from: config.from, base };
}

export async function requestPasswordReset(identifier: string, deps: MailDeps = {}, now = new Date()): Promise<ResetRequestOutcome> {
  const key = identifier.trim().toLowerCase();
  const user = await prisma.user.findFirst({ where: { OR: [{ loginId: key }, { email: key }] } });
  if (!user || !user.active || user.role === "SYSTEM") return "NO_MATCH";
  if (!user.email) return "NO_ADDRESS";
  const m = mailer(deps);
  if (!m) {
    console.warn(`password reset by e-mail: not sent, the mail or ${PUBLIC_URL_ENV} is not set up`);
    return "NOT_CONFIGURED";
  }
  const issued = await prisma.$transaction(async (tx) => {
    // the count and the new row under one per-user lock, so parallel requests cannot pass the limit together (barracuda on #219)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`password-reset:${user.id}`}))`;
    const recent = await tx.passwordReset.count({
      where: { userId: user.id, createdById: null, createdAt: { gt: new Date(now.getTime() - MAIL_REQUESTS.windowMs) } },
    });
    if (recent >= MAIL_REQUESTS.max) return null;
    const issued = await issueResetToken(tx, { userId: user.id, createdById: null, ttlMs: RESET_LINK_TTL_MS.mail }, now);
    await writeAudit(tx, {
      userId: user.id,
      action: "MASTER_CHANGE",
      entityType: "User",
      entityId: user.id,
      changes: { passwordResetLink: { before: null, after: `visszaállító link kérve e-mailben, lejár: ${issued.expiresAt.toISOString()}` } },
    });
    return issued;
  });
  if (!issued) return "THROTTLED";
  const { token, expiresAt } = issued;
  const minutes = Math.round((expiresAt.getTime() - now.getTime()) / 60_000);
  try {
    await m.send({
      from: m.from,
      to: user.email,
      subject: "Cápárium nAPPló: jelszó-visszaállítás",
      text: [
        `Kedves ${user.fullName}!`,
        "",
        "Jelszó-visszaállítást kértél a Cápárium nAPPló-ban. Az új jelszavadat ezen a linken állíthatod be:",
        `${m.base}${RESET_PATH}/${token}`,
        "",
        `A link ${minutes} percig érvényes, és egyszer használható.`,
        "Ha nem te kérted, ne tegyél semmit: a jelszavad nem változik.",
      ].join("\n"),
      attachments: [],
    });
  } catch (e) {
    console.error(`password reset by e-mail: sending failed for user ${user.id}: ${e instanceof Error ? e.message : String(e)}`);
    return "SEND_FAILED";
  }
  return "SENT";
}

/**
 * A NOTICE TO THE OLD ADDRESS when a user changes their own (barracuda on #217): if someone else did it from an open session,
 * the owner hears of it where they still read. Best effort: without the mail set up, or on a failure, the change still stands.
 */
export async function notifyEmailChanged(input: { fullName: string; oldEmail: string; newEmail: string | null }, deps: MailDeps = {}) {
  const m = mailer(deps);
  if (!m) return "NOT_CONFIGURED" as const;
  try {
    await m.send({
      from: m.from,
      to: input.oldEmail,
      subject: "Cápárium nAPPló: megváltozott az e-mail címed",
      text: [
        `Kedves ${input.fullName}!`,
        "",
        input.newEmail
          ? "A Cápárium nAPPló-fiókodhoz tartozó e-mail címet most megváltoztatták. A jelszó-visszaállító levelek ezentúl az új címre mennek."
          : "A Cápárium nAPPló-fiókodról most törölték az e-mail címet. Jelszó-visszaállító levél ezentúl nem megy.",
        "Ha nem te tetted, szólj az adminisztrátornak.",
      ].join("\n"),
      attachments: [],
    });
    return "SENT" as const;
  } catch (e) {
    console.error(`e-mail change notice: sending failed: ${e instanceof Error ? e.message : String(e)}`);
    return "SEND_FAILED" as const;
  }
}
