// "Vízmérés kiküldése" (caparium-hibak-4, item 13): the recipient setting, what the report holds (today's daily
// values, this week's weekly values, by pool) and the sending, through a fake sender: nothing leaves the machine.
// Dated 2027-09, a month no other spec uses (the shared database).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { MailSender, OutgoingMail } from "@/lib/mail";
import { setReference } from "@/lib/admin";
import { createMeasurement } from "@/lib/measurements";
import { sendWaterReport, setWaterReportRecipient } from "@/lib/water-mail";
import { waterReport, weekStart } from "@/lib/water-report";
import { readPdfLines } from "../support/pdf-readback";
import { cest, fixtures, rid } from "./fixtures";

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
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
const code = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e as AppError).code);

const measure = (group: string, pool: string, param: string, value: string, local: string, extra: Record<string, unknown> = {}) =>
  createMeasurement(
    f.aq1,
    { requestId: rid(), groupId: f.group(group), poolId: f.pool(pool), parameterId: f.param(param), value, measuredAtLocal: local, ...extra } as Parameters<typeof createMeasurement>[1],
    cest(local),
  );

describe("the water report", () => {
  it("today's latest daily value and the week's latest weekly value per pool; a pool with nothing is left out", async () => {
    expect(weekStart("2027-09-08")).toBe("2027-09-06"); // a Wednesday -> its Monday
    expect(weekStart("2027-09-12")).toBe("2027-09-06"); // a Sunday -> the same week's Monday
    await setReference(f.admin, { requestId: rid(), parameterId: f.param("NO3"), poolId: f.pool("NAGY"), min: null, max: "7", mode: "change" }, cest("2027-09-01T10:00"));
    await measure("NAPI_NAGY", "NAGY", "TEMP", "24,1", "2027-09-08T07:00");
    await measure("NAPI_NAGY", "NAGY", "TEMP", "24,6", "2027-09-08T15:00", { newRound: true }); // a later round of the day wins
    await measure("NAPI_NAGY", "NAGY", "PH", "8,1", "2027-09-07T08:00"); // yesterday: not a daily value of today
    await measure("HETI", "NAGY", "NO3", "6", "2027-09-06T09:00");
    await measure("HETI", "NAGY", "NO3", "8,4", "2027-09-07T09:00", { dilution: 10, diluentWater: "RO" }); // the week's latest
    await measure("HETI", "KIS", "KH", "8,2", "2027-09-03T09:00"); // last week: out
    const r = await waterReport("2027-09-08");
    expect(r.weekFrom).toBe("2027-09-06");
    // the reference of a value is the range it was judged against: the POOL's own if it has one, else the common one
    // (Lili 2026-10-26, msg 1564363895722737696). Nagymedence gets its own NO3 range; its TEMP stays the common one.
    const commonTemp = await prisma.referenceRange.findFirstOrThrow({ where: { parameterId: f.param("TEMP"), poolId: null, validTo: null }, include: { unit: true } });
    const tempRange = r.pools.find((p) => p.pool === "Nagymedence")!.daily[0]!.range;
    expect(tempRange).toEqual({ min: commonTemp.min?.toString() ?? null, max: commonTemp.max?.toString() ?? null, unit: commonTemp.unit.symbol });
    const no3 = r.pools.find((p) => p.pool === "Nagymedence")!.weekly[0]!.range;
    expect(no3).toEqual({ min: null, max: "7", unit: "ppm" });
    const nagy = r.pools.find((p) => p.pool === "Nagymedence")!;
    expect(nagy.daily.map((v) => [v.parameter, v.value, v.time])).toEqual([["Hőmérséklet", "24.6", "15:00"]]);
    expect(nagy.weekly.map((v) => [v.parameter, v.value, v.day, v.dilution, v.diluentWater])).toEqual([["NO3", "8.4", "2027-09-07", 10, "RO"]]);
    expect(r.pools.some((p) => p.pool === "Kismedence")).toBe(false);
  });
});

// Lili 2026-10-26 (Caparium channel msg 1564418747047874581): the pools stand in a fixed order in the PDF, whatever their codes
// say: Nagymedence, Karantén, Kismedence, Ragadozós, Korallos, Inkubátor. A pool added later comes at the end.
describe("the pools' order in the report", () => {
  const day = "2027-09-22";
  it("follows the fixed order, not the codes' alphabet", async () => {
    // measured in the "wrong" order on purpose: the codes alphabet would give INKUBATOR, KARANTEN, KIS, KORALLOS, NAGY
    await measure("NAPI_KIS", "INKUBATOR", "TEMP", "24", `${day}T07:00`);
    await measure("NAPI_KIS", "KORALLOS", "TEMP", "25", `${day}T07:01`);
    await measure("NAPI_NAGY", "KIS", "TEMP", "24", `${day}T07:02`);
    await measure("NAPI_NAGY", "KARANTEN", "TEMP", "24", `${day}T07:03`);
    await measure("NAPI_NAGY", "NAGY", "TEMP", "24", `${day}T07:04`);
    const r = await waterReport(day);
    expect(r.pools.map((p) => p.pool)).toEqual(["Nagymedence", "Karantén", "Kismedence", "Korallos", "Inkubátor"]);
    // the stored positions are the starting values
    const placed = await prisma.pool.findMany({ where: { code: { in: ["NAGY", "KARANTEN", "KIS", "RAGADOZOS", "KORALLOS", "INKUBATOR"] } }, orderBy: { sortOrder: "asc" } });
    expect(placed.map((p) => [p.code, p.sortOrder])).toEqual([["NAGY", 0], ["KARANTEN", 1], ["KIS", 2], ["RAGADOZOS", 3], ["KORALLOS", 4], ["INKUBATOR", 5]]);
  });
});

describe("the recipient and the sending", () => {
  it("no recipient: refused before anything is built; an aquarist cannot set it; a settings admin can, audited", async () => {
    Object.assign(process.env, SMTP);
    expect(await code(sendWaterReport(f.aq1, { requestId: rid() }, cest("2027-09-08T16:00")))).toBe("NO_RECIPIENT");
    expect(await code(setWaterReportRecipient(f.aq1, { requestId: rid(), email: "vizmeres@example.test" }, cest("2027-09-08T16:01")))).toBe("ADMIN_ONLY");
    const bad = await setWaterReportRecipient(f.admin, { requestId: rid(), email: "nem-cim" }, cest("2027-09-08T16:01")).then(() => null, (e: unknown) => e);
    expect((bad as Error).name, "not an address: refused").toBe("ZodError");
    await setWaterReportRecipient(f.admin, { requestId: rid(), email: "vizmeres@example.test" }, cest("2027-09-08T16:01"));
    const audit = await prisma.auditEntry.findFirstOrThrow({ where: { entityType: "Setting" }, orderBy: { at: "desc" } });
    expect(audit.changes).toMatchObject({ water_report_recipient: { after: "vizmeres@example.test" } });
  });

  it("sends the PDF to the set address only, from the configured sender, one EXPORT audit row; SMTP missing names the variables", async () => {
    const sent: (OutgoingMail & { from: string })[] = [];
    const fake: MailSender = async (m) => {
      sent.push(m);
      return { messageId: "teszt" };
    };
    const now = cest("2027-09-08T16:05");
    const req = rid();
    const r = await sendWaterReport(f.aq1, { requestId: req }, now, fake);
    expect(r).toMatchObject({ replayed: false, to: "vizmeres@example.test", day: "2027-09-08" });
    expect(sent).toHaveLength(1);
    // the same request again: nothing is sent, and the answer says what that sending did (review of #32)
    expect(await sendWaterReport(f.aq1, { requestId: req }, now, fake)).toEqual({ replayed: true, to: "vizmeres@example.test", day: "2027-09-08", pools: r.pools });
    expect(sent).toHaveLength(1);
    expect([sent[0]!.to, sent[0]!.from, sent[0]!.subject]).toEqual(["vizmeres@example.test", "napplo@example.test", "Cápasuli vízmérés - 2027-09-08"]);
    // Lili 2026-10-26: the letter is signed by the user who sent it (the seed's aq1 is "Teszt Akvarista Egy")
    expect(sent[0]!.text).toBe("Sziasztok!\n\nKüldöm a heti vízmérések eredményeit.\n\nÜdv,\nTeszt Akvarista Egy");
    const pdf = sent[0]!.attachments[0]!;
    expect([pdf.filename, pdf.contentType]).toEqual(["Cápasuli vízmérés - 2027-09-08.pdf", "application/pdf"]);
    const lines = await readPdfLines(pdf.content);
    expect(lines).toContain("Nagymedence");
    // parameter, value, measurer, then the reference (the common TEMP range here)
    expect(lines.some((l) => l.startsWith("Hőmérséklet 24,6 °C AE "))).toBe(true);
    expect(lines).toContain("Cápasuli vízmérés - 2027-09-08");
    const audit = await prisma.auditEntry.findFirstOrThrow({ where: { entityType: "WaterReportMail", entityId: "2027-09-08" } });
    expect([audit.action, audit.userId]).toEqual(["EXPORT", f.aq1.id]);
    expect(audit.changes).toMatchObject({ recipient: { after: "vizmeres@example.test" } });

    for (const k of Object.keys(SMTP)) delete process.env[k];
    const e = await sendWaterReport(f.aq1, { requestId: rid() }, now, fake).catch((x: unknown) => x as AppError);
    expect([(e as AppError).status, (e as AppError).code]).toEqual([503, "MAIL_NOT_CONFIGURED"]);
    expect(sent).toHaveLength(1);
  });

  it("several recipients: stored once and normalized, the mail goes to all of them, the log names them (card c2e15128)", async () => {
    Object.assign(process.env, SMTP);
    await setWaterReportRecipient(f.admin, { requestId: rid(), email: "vizmeres@example.test; masik@example.test, VIZMERES@example.test" }, cest("2027-09-08T16:20"));
    const sent: (OutgoingMail & { from: string })[] = [];
    const fake: MailSender = async (m) => {
      sent.push(m);
      return { messageId: "teszt" };
    };
    const r = await sendWaterReport(f.aq1, { requestId: rid() }, cest("2027-09-08T16:21"), fake);
    expect(r.to).toBe("vizmeres@example.test, masik@example.test");
    expect(sent.map((m) => m.to)).toEqual(["vizmeres@example.test, masik@example.test"]);
    const bad = await setWaterReportRecipient(f.admin, { requestId: rid(), email: "jo@example.test, nem-cim" }, cest("2027-09-08T16:22")).then(
      () => null,
      (e: unknown) => e,
    );
    expect((bad as Error).name, "one bad address: nothing saved").toBe("ZodError");
    // back to the one address the next test sends to
    await setWaterReportRecipient(f.admin, { requestId: rid(), email: "vizmeres@example.test" }, cest("2027-09-08T16:23"));
  });

  it("an export-read-only aquarist cannot send; a failing SMTP is a 502 without the server's words", async () => {
    Object.assign(process.env, SMTP);
    const reader = await prisma.user.create({ data: { loginId: `export-olvaso-${rid()}`, fullName: "Export Olvasó", role: "AQUARIST", passwordHash: "x" } });
    await prisma.modulePermission.create({ data: { userId: reader.id, module: "EXPORT", level: "READ" } });
    expect(await code(sendWaterReport({ id: reader.id, role: "AQUARIST" }, { requestId: rid() }, cest("2027-09-08T16:10")))).toBe("READ_ONLY");
    const broken: MailSender = async () => {
      throw new Error("535 authentication failed for user@example.test");
    };
    const e = (await sendWaterReport(f.aq1, { requestId: rid() }, cest("2027-09-08T16:10"), broken).catch((x: unknown) => x)) as AppError;
    expect([e.status, e.code]).toEqual([502, "MAIL_FAILED"]);
    expect(e.message).not.toContain("535");
  });
});
