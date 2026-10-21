// "Vízmérés kiküldése" (caparium-hibak-4, item 13): the recipient setting and the sending. The recipients are set in
// Beállítások by a settings admin (a versioned setting row, audited); anyone who may export sends, to those addresses
// only (no address is typed at sending time). Every sending is one EXPORT audit row with the recipients and the day.
// Several recipients (Lili, 2026-10-21 13:50 UTC, card c2e15128): the same setting holds a comma-separated list,
// each address checked on its own, stored once and normalized ("a@x.hu, b@y.hu"); one mail goes to all of them.
import { z } from "zod";
import { writeAudit } from "./audit";
import { prisma } from "./db";
import { AppError } from "./errors";
import { mailConfig, smtpSender, type MailSender } from "./mail";
import { getSetting, moduleLevel } from "./master";
import type { Actor } from "./measurements";
import { businessDayOf } from "./time";
import { waterReport } from "./water-report";
import { waterReportPdf } from "./water-report-pdf";

const requestId = z.string().min(8).max(100);

export const MAX_RECIPIENTS = 10;
const address = z.email();

/**
 * The recipients as typed: separated by commas, semicolons or whitespace, each checked, the same address (in any case)
 * once, in the order typed. An empty text is no recipient. Returns the problem in words, never a half list.
 */
export function parseRecipients(raw: string): { ok: true; list: string[] } | { ok: false; message: string } {
  const parts = raw.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean);
  const bad = parts.filter((p) => !address.safeParse(p).success);
  if (bad.length) return { ok: false, message: `Érvénytelen e-mail cím: ${bad.join(", ")}.` };
  const seen = new Set<string>();
  const list = parts.filter((p) => !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()));
  if (list.length > MAX_RECIPIENTS) return { ok: false, message: `Legfeljebb ${MAX_RECIPIENTS} címzett adható meg.` };
  return { ok: true, list };
}

export const recipientSchema = z.object({
  requestId,
  email: z
    .string()
    .max(2000)
    .superRefine((value, ctx) => {
      const parsed = parseRecipients(value);
      if (!parsed.ok) ctx.addIssue({ code: "custom", message: parsed.message });
    }),
});

export async function setWaterReportRecipient(actor: Actor, raw: z.input<typeof recipientSchema>, now = new Date()) {
  // parsed here too, not only in the route: an unchecked address would be where the report goes
  const input = recipientSchema.parse(raw);
  if ((await moduleLevel(prisma, actor.id, actor.role, "SETTINGS")) !== "ADMIN") {
    throw new AppError(403, "ADMIN_ONLY", "A beállításokat csak adminisztrátor módosíthatja.");
  }
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  const parsed = parseRecipients(input.email);
  const email = parsed.ok ? parsed.list.join(", ") : "";
  return prisma.$transaction(async (tx) => {
    const before = await getSetting(tx, "water_report_recipient", now);
    if (before === email) throw new AppError(422, "NO_CHANGE", "Nincs változás.");
    const row = await tx.setting.create({ data: { key: "water_report_recipient", value: email, validFrom: now, changedById: actor.id } });
    await writeAudit(tx, {
      userId: actor.id,
      action: "MASTER_CHANGE",
      entityType: "Setting",
      entityId: row.id,
      changes: { water_report_recipient: { before: before || null, after: email || null } },
      requestId: input.requestId,
    });
    return { replayed: false };
  });
}

export const sendSchema = z.object({ requestId });

export async function sendWaterReport(actor: Actor, input: z.infer<typeof sendSchema>, now = new Date(), sender?: MailSender) {
  const level = await moduleLevel(prisma, actor.id, actor.role, "EXPORT");
  if (level !== "RECORD" && level !== "ADMIN") throw new AppError(403, "READ_ONLY", "A vízmérés kiküldéséhez exportálási jog kell.");
  // only this action's row (review of #32): another action's row with the same request id is not a sending
  const prior = await prisma.auditEntry.findFirst({ where: { requestId: input.requestId, entityType: "WaterReportMail" } });
  if (prior) {
    // what that sending said (review of #32): a replay must not read "Elküldve: undefined"
    const c = prior.changes as { recipient?: { after?: string }; pools?: { after?: string[] } };
    return { replayed: true, to: c.recipient?.after ?? null, day: prior.entityId, pools: c.pools?.after?.length ?? 0 };
  }
  const to = await getSetting(prisma, "water_report_recipient", now);
  // a stored list is checked again: a row written by an older version, or by hand, must not send to a typo
  const recipients = to ? parseRecipients(to) : null;
  if (!recipients || !recipients.ok || recipients.list.length === 0)
    throw new AppError(422, "NO_RECIPIENT", "Nincs megadva címzett: a Beállításokban add meg, hova menjen a vízmérés.");
  const day = businessDayOf(now);
  const report = await waterReport(day);
  // the PDF before the SMTP check: where no SMTP is set the button still builds it, so a packaging fault of the PDF
  // (pdfkit, the font) is a 500 there, not first on a configured system. The e2e runs `next start` and measures the
  // code; the image's packaging (copied assets/, pdfkit from its node_modules) is proved when the image is built
  // (Dockerfile), and the CI compose job builds it.
  const pdf = await waterReportPdf(report);
  const config = mailConfig();
  const send = sender ?? smtpSender(config);
  const filename = `Vizmeres_${day}.pdf`;
  try {
    await send({
      from: config.from,
      to: recipients.list.join(", "),
      subject: `Vízmérés – ${day}`,
      text: `A Cápárium nAPPló vízmérési eredményei medencénként: napi értékek ${day}, heti értékek ${report.weekFrom} – ${day}. A részletek a csatolt PDF-ben.`,
      attachments: [{ filename, content: pdf, contentType: "application/pdf" }],
    });
  } catch (e) {
    // the SMTP server's own words may carry an address but never our key; still, only the code goes to the user
    console.error("water report mail failed:", e instanceof Error ? e.message : e);
    throw new AppError(502, "MAIL_FAILED", "A levél küldése nem sikerült. Próbáld újra később; ha ismétlődik, szólj az üzemeltetőnek.");
  }
  // AFTER the sending, said plainly (review of #32): a mail cannot be taken back, so there is no transaction to share
  // with it. If this write fails, the mail went out without its audit row, and pressing again sends a second one.
  await writeAudit(prisma, {
    userId: actor.id,
    action: "EXPORT",
    entityType: "WaterReportMail",
    entityId: day,
    changes: { recipient: { before: null, after: to }, pools: { before: null, after: report.pools.map((p) => p.pool) }, file: { before: null, after: filename } },
    requestId: input.requestId,
  });
  return { replayed: false, to, day, pools: report.pools.length };
}
