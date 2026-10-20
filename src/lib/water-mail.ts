// "Vízmérés kiküldése" (caparium-hibak-4, item 13): the recipient setting and the sending. The recipient is set in
// Beállítások by a settings admin (a versioned setting row, audited); anyone who may export sends, to that address
// only (no address is typed at sending time). Every sending is one EXPORT audit row with the recipient and the day.
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

export const recipientSchema = z.object({
  requestId,
  email: z.union([z.literal(""), z.email({ error: "Érvényes e-mail címet adj meg." })]),
});

export async function setWaterReportRecipient(actor: Actor, raw: z.input<typeof recipientSchema>, now = new Date()) {
  // parsed here too, not only in the route: an unchecked address would be where the report goes
  const input = recipientSchema.parse(raw);
  if ((await moduleLevel(prisma, actor.id, actor.role, "SETTINGS")) !== "ADMIN") {
    throw new AppError(403, "ADMIN_ONLY", "A beállításokat csak adminisztrátor módosíthatja.");
  }
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  const email = input.email.trim();
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
  const prior = await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } });
  if (prior) return { replayed: true };
  const to = await getSetting(prisma, "water_report_recipient", now);
  if (!to) throw new AppError(422, "NO_RECIPIENT", "Nincs megadva címzett: a Beállításokban add meg, hova menjen a vízmérés.");
  const day = businessDayOf(now);
  const report = await waterReport(day);
  // the PDF before the SMTP check: where no SMTP is set (the e2e run) the button still builds it in the server, so a
  // packaging fault of the PDF (pdfkit, the font) shows as a 500 there, not first on a configured system
  const pdf = await waterReportPdf(report);
  const config = mailConfig();
  const send = sender ?? smtpSender(config);
  const filename = `Vizmeres_${day}.pdf`;
  try {
    await send({
      from: config.from,
      to,
      subject: `Vízmérés – ${day}`,
      text: `A Cápárium nAPPló vízmérési eredményei medencénként: napi értékek ${day}, heti értékek ${report.weekFrom} – ${day}. A részletek a csatolt PDF-ben.`,
      attachments: [{ filename, content: pdf, contentType: "application/pdf" }],
    });
  } catch (e) {
    // the SMTP server's own words may carry an address but never our key; still, only the code goes to the user
    console.error("water report mail failed:", e instanceof Error ? e.message : e);
    throw new AppError(502, "MAIL_FAILED", "A levél küldése nem sikerült. Próbáld újra később; ha ismétlődik, szólj az üzemeltetőnek.");
  }
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
