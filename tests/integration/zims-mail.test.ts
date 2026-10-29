// The monthly ZIMS package by e-mail (Lili's package 2026-10-29, item 1), through a fake sender: nothing leaves the
// machine. March and May 2029: months no other spec uses (the database is shared across files); the "now" of each
// call is in the month after, so the job's own clock is not touched.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { monthlyPackage } from "@/lib/exports/zims";
import type { MailSender, OutgoingMail } from "@/lib/mail";
import { createMeasurement } from "@/lib/measurements";
import { setRecipientSetting } from "@/lib/water-mail";
import { mailMonthlyPackage } from "@/lib/zims-mail";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const SMTP = {
  CAPARIUM_SMTP_HOST: "smtp.example.test",
  CAPARIUM_SMTP_PORT: "587",
  CAPARIUM_SMTP_USER: "user@example.test",
  CAPARIUM_SMTP_PASSWORD: "not-a-real-key",
  CAPARIUM_MAIL_FROM: "napplo@example.test",
};
const saved: Record<string, string | undefined> = {};
beforeAll(async () => {
  f = await fixtures();
  for (const k of Object.keys(SMTP)) saved[k] = process.env[k];
  Object.assign(process.env, SMTP);
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const sent: (OutgoingMail & { from: string })[] = [];
const fake: MailSender = async (m) => {
  sent.push(m);
  return { messageId: "teszt" };
};
const code = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e as AppError).code);

describe("the monthly ZIMS package mail", () => {
  const now = new Date("2029-04-02T12:00:00+02:00");
  const audit = (key: string) => prisma.auditEntry.findMany({ where: { requestId: key, entityType: "MonthlyZimsMail" } });

  it("no recipient: nothing is sent; a settings admin sets it (an aquarist cannot), audited", async () => {
    await createMeasurement(f.aq1, { requestId: rid(), groupId: f.group("NAPI_NAGY"), poolId: f.pool("NAGY"), parameterId: f.param("PH"), value: "8,1", measuredAtLocal: "2029-03-15T09:00" }, new Date("2029-03-15T09:00:00+01:00"));
    const pkg = await monthlyPackage(now);
    expect(pkg.created).toBe(true);
    expect(await mailMonthlyPackage(pkg, now, fake)).toEqual({ sent: false, why: "NO_RECIPIENT" });
    expect(sent).toHaveLength(0);
    expect(await code(setRecipientSetting(f.aq1, { requestId: rid(), email: "havi-zims@example.test" }, "monthly_zims_recipient", now))).toBe("ADMIN_ONLY");
    await setRecipientSetting(f.admin, { requestId: rid(), email: "havi-zims@example.test, masik@example.test" }, "monthly_zims_recipient", now);
    const row = await prisma.auditEntry.findFirstOrThrow({
      where: { entityType: "Setting", changes: { path: ["monthly_zims_recipient", "after"], equals: "havi-zims@example.test, masik@example.test" } },
    });
    expect(row.action).toBe("MASTER_CHANGE");
  });

  it("a failed sending leaves no audit row, so the next try sends; then one mail with the agreed file names, and never a second", async () => {
    const pkg = await monthlyPackage(now);
    expect(pkg.created).toBe(false); // the run exists: the mail is a separate step
    const key = "havi-zims-level-2029-03-01-package";
    const boom: MailSender = async () => {
      throw new Error("smtp down");
    };
    expect(await code(mailMonthlyPackage(pkg, now, boom))).toBe("MAIL_FAILED");
    expect(await audit(key)).toHaveLength(0);

    expect(await mailMonthlyPackage(pkg, now, fake)).toEqual({ sent: true });
    expect(sent).toHaveLength(1);
    const m = sent[0];
    expect(m.from).toBe("napplo@example.test");
    expect(m.to).toBe("havi-zims@example.test, masik@example.test");
    expect(m.subject).toBe("Cápasuli ZIMS-csomag - 2029. március");
    const run = await prisma.exportRun.findUniqueOrThrow({ where: { id: pkg.runId! }, include: { files: true } });
    expect(run.purpose).toBe("PREVIEW"); // a mail is never a submission (R-9)
    expect(m.attachments.map((a) => a.filename)).toEqual(["2029_Nagymedence_03_ZIMSimport.csv"]);
    expect(run.files.map((x) => x.fileName)).toEqual(["2029_Nagymedence_03_ZIMSimport.csv"]); // the download carries the same name
    expect(m.attachments[0].content.toString("utf8")).toBe(run.files[0].content);
    const rows = await audit(key);
    expect(rows).toHaveLength(1);
    expect(rows[0].entityId).toBe(pkg.runId);

    expect(await mailMonthlyPackage(pkg, now, fake)).toEqual({ sent: false, why: "ALREADY_SENT" });
    expect(sent).toHaveLength(1);
  });

  it("a month without a package gets a warning with the reason, once", async () => {
    const mayDone = new Date("2029-06-02T12:00:00+02:00");
    const pkg = await monthlyPackage(mayDone);
    expect(pkg).toMatchObject({ created: false, reason: "NOTHING_TO_EXPORT" });
    const before = sent.length;
    expect(await mailMonthlyPackage(pkg, mayDone, fake)).toEqual({ sent: true });
    const m = sent[before];
    expect(m.subject).toBe("FIGYELMEZTETÉS: nincs ZIMS-csomag - 2029. május");
    expect(m.text).toContain("a hónapban nincs érvényes mérés");
    expect(m.attachments).toHaveLength(0);
    expect(await mailMonthlyPackage(pkg, mayDone, fake)).toEqual({ sent: false, why: "ALREADY_SENT" });
    expect(sent).toHaveLength(before + 1);
  });
});
