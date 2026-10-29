// The monthly ZIMS package by e-mail (Lili's package 2026-10-29, item 1; the package itself is VIZ-20 in exports/zims.ts).
// After the hourly job has the previous month's package (or knows why there is none), ONE mail goes to the
// monthly ZIMS recipients: the per-pool CSVs as attachments, or a warning with the reason. The recipients are their
// own setting (`monthly_zims_recipient`), not the water report's. A mail is PREVIEW, never a submission (R-9).
// Once per month and kind: the audit row `MonthlyZimsMail` is the memory; a failed sending leaves no row, so the
// next hourly try sends again. Nothing is sent where no recipient is set, and nothing unless the instance is switched on
// (CAPARIUM_MONTHLY_ZIMS_MAIL=on): a stage or a test instance on a copy of the production data has the recipient setting
// and may have SMTP, and must not mail Lili from stage data (barracuda on #110).
// Once-only across instances too: the check, the sending and the audit row are one transaction under an advisory lock on
// the key, so a second instance in the same hour waits, then finds the row.
import { writeAudit } from "./audit";
import { prisma, SYSTEM_USER_ID, type Tx } from "./db";
import { AppError } from "./errors";
import { activeProfile, monthlyFileName, previousMonth, type monthlyPackage } from "./exports/zims";
import { mailConfig, smtpSender, type MailSender } from "./mail";
import { getSetting, pickValid } from "./master";
import { resolveLocalDateTime } from "./time";
import { parseRecipients } from "./water-mail";
import { zimsPackageSubject, zimsPackageText, zimsWarningSubject, zimsWarningText } from "./zims-mail-text";

type PackageResult = Awaited<ReturnType<typeof monthlyPackage>>;

/** What the month's missing package means, in words for the letter. */
const WHY: Record<string, string> = {
  NOTHING_TO_EXPORT: "a hónapban nincs érvényes mérés.",
  MAPPING_MISSING: "néhány méréshez hiányzik a ZIMS-megfeleltetés.",
};

// A sending whose audit row could not be written is remembered here, so the hourly job does not send it again
// (a mail cannot be taken back; the row is the memory only if it exists).
const sentThisRun = new Set<string>();

/** The automatic mail is off unless this instance is switched on. */
export const monthlyMailEnabled = (env: Record<string, string | undefined> = process.env) => env.CAPARIUM_MONTHLY_ZIMS_MAIL === "on";

const alreadySent = (tx: Tx, key: string) => tx.auditEntry.findFirst({ where: { requestId: key, entityType: "MonthlyZimsMail" } });

export async function mailMonthlyPackage(
  result: PackageResult,
  now = new Date(),
  sender?: MailSender,
): Promise<{ sent: boolean; why?: string }> {
  if (!monthlyMailEnabled()) return { sent: false, why: "DISABLED" };
  const { from, to } = previousMonth(now);
  const kind = result.runId ? "package" : result.reason ? `warning-${result.reason}` : null;
  if (!kind) return { sent: false, why: "NOTHING_TO_SAY" };
  const key = `havi-zims-level-${from}-${kind}`;
  if (sentThisRun.has(key)) return { sent: false, why: "ALREADY_SENT" };
  if (await alreadySent(prisma, key)) return { sent: false, why: "ALREADY_SENT" };

  const raw = await getSetting(prisma, "monthly_zims_recipient", now);
  const recipients = raw ? parseRecipients(raw) : null;
  if (!recipients || !recipients.ok || recipients.list.length === 0) return { sent: false, why: "NO_RECIPIENT" };

  let subject: string;
  let text: string;
  let attachments: { filename: string; content: Buffer; contentType: string }[] = [];
  if (result.runId) {
    const files = await prisma.exportFile.findMany({ where: { exportRunId: result.runId }, orderBy: { fileName: "asc" } });
    // the pool's name at the period's end, as the run itself names its files; recomputed so that a package made
    // before this naming existed is still sent under the agreed name
    const poolIds = files.map((f) => f.poolId).filter((id): id is string => !!id);
    const pools = await prisma.pool.findMany({ where: { id: { in: poolIds } }, include: { names: true } });
    const tz = (await activeProfile()).timeZone;
    const endOfPeriod = resolveLocalDateTime(`${to}T23:59`, tz)!.instant;
    attachments = files.map((f) => {
      const pool = pools.find((p) => p.id === f.poolId);
      const name = pool ? (pickValid(pool.names, endOfPeriod)?.displayName ?? pool.code) : "";
      return { filename: name ? monthlyFileName(name, from) : f.fileName, content: Buffer.from(f.content ?? "", "utf8"), contentType: "text/csv; charset=utf-8" };
    });
    subject = zimsPackageSubject(from);
    text = zimsPackageText(from, attachments.map((a) => a.filename));
  } else {
    subject = zimsWarningSubject(from);
    text = zimsWarningText(from, WHY[result.reason!] ?? `ok: ${result.reason}.`);
  }

  const config = mailConfig();
  const send = sender ?? smtpSender(config);
  const names = attachments.map((x) => x.filename);
  // One transaction: the lock, the check, the sending, the audit row. A second instance waits at the lock and then finds
  // the row; a failed sending throws, rolls back, and leaves no row, so the next hourly try sends again. The timeout
  // covers a slow SMTP server.
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      if (sentThisRun.has(key) || (await alreadySent(tx, key))) return { sent: false, why: "ALREADY_SENT" };
      try {
        await send({ from: config.from, to: recipients.list.join(", "), subject, text, attachments });
      } catch (e) {
        // only the code goes on; the SMTP server's own words are logged, never our key
        console.error("monthly ZIMS mail failed:", e instanceof Error ? e.message : e);
        throw new AppError(502, "MAIL_FAILED", "A havi ZIMS-levél küldése nem sikerült.");
      }
      sentThisRun.add(key); // the mail is out: if the commit below fails, this process does not send it again
      await writeAudit(tx, {
        userId: SYSTEM_USER_ID,
        action: "EXPORT",
        entityType: "MonthlyZimsMail",
        entityId: result.runId ?? from,
        changes: {
          recipient: { before: null, after: recipients.list.join(", ") },
          files: { before: null, after: names },
          kind: { before: null, after: kind },
        },
        requestId: key,
      });
      return { sent: true };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}
