// Sending e-mail (caparium-hibak-4, item 13; NY-09 until now: the app sent nothing). SMTP from the environment ONLY:
// the password never goes into the repository, a log, a test or an error message; an error names the missing
// variable, never a value. The stage's values are set by acrobot (Brevo SMTP relay, msg 1562040794381164617).
//
//   CAPARIUM_SMTP_HOST       e.g. smtp-relay.brevo.com
//   CAPARIUM_SMTP_PORT       587 (STARTTLS required) or 465 (TLS from the start)
//   CAPARIUM_SMTP_USER       the SMTP login
//   CAPARIUM_SMTP_PASSWORD   the SMTP key (secret)
//   CAPARIUM_MAIL_FROM       the sender address, e.g. napplo@acropora.hu
import nodemailer from "nodemailer";
import { AppError } from "./errors";

export const MAIL_ENV = ["CAPARIUM_SMTP_HOST", "CAPARIUM_SMTP_PORT", "CAPARIUM_SMTP_USER", "CAPARIUM_SMTP_PASSWORD", "CAPARIUM_MAIL_FROM"] as const;

export type MailConfig = { host: string; port: number; user: string; password: string; from: string };

/** The SMTP settings, or a 503 that names the missing (or unusable) variables. */
export function mailConfig(env: Record<string, string | undefined> = process.env): MailConfig {
  const missing = MAIL_ENV.filter((k) => !env[k]?.trim());
  const port = Number(env.CAPARIUM_SMTP_PORT);
  if (!missing.includes("CAPARIUM_SMTP_PORT") && !(Number.isInteger(port) && port > 0 && port < 65536)) missing.push("CAPARIUM_SMTP_PORT");
  if (missing.length) {
    throw new AppError(503, "MAIL_NOT_CONFIGURED", `A levélküldés nincs beállítva: hiányzik vagy hibás: ${missing.join(", ")}.`);
  }
  return {
    host: env.CAPARIUM_SMTP_HOST!.trim(),
    port,
    user: env.CAPARIUM_SMTP_USER!.trim(),
    password: env.CAPARIUM_SMTP_PASSWORD!,
    from: env.CAPARIUM_MAIL_FROM!.trim(),
  };
}

export type OutgoingMail = { to: string; subject: string; text: string; attachments: { filename: string; content: Buffer; contentType: string }[] };
/** The one thing a sender does; a test passes its own and nothing leaves the machine. */
export type MailSender = (mail: OutgoingMail & { from: string }) => Promise<{ messageId?: string }>;

export function smtpSender(c: MailConfig): MailSender {
  const transport = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.port === 465,
    requireTLS: c.port !== 465, // 587: STARTTLS is required, never a plain-text fallback
    auth: { user: c.user, pass: c.password },
  });
  return async (mail) => {
    const info = await transport.sendMail(mail);
    return { messageId: info.messageId };
  };
}
