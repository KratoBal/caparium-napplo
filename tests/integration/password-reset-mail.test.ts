// Task e7f9e84d, slice 2: the forgotten password by e-mail. WHAT TURNS THIS RED: a link mailed to anyone but the account's own
// address, or built from anything but CAPARIUM_PUBLIC_URL; a link without the mail or the public address set up; an answer
// that differs between an existing and an unknown account; no limit on the mails per account; the old address not told of an
// e-mail change, or told when there was none.
import { beforeAll, describe, expect, it } from "vitest";
import { POST as requestRoute } from "@/app/api/password-reset/request/route";
import { createUser, updateUser } from "@/lib/admin";
import { prisma } from "@/lib/db";
import type { MailSender } from "@/lib/mail";
import { resetLinkUsable } from "@/lib/password-reset";
import { notifyEmailChanged, requestPasswordReset } from "@/lib/password-reset-mail";
import { updateOwnProfile } from "@/lib/own-profile";
import { fixtures, rid } from "./fixtures";

const ENV = {
  CAPARIUM_SMTP_HOST: "smtp.example.test",
  CAPARIUM_SMTP_PORT: "587",
  CAPARIUM_SMTP_USER: "u",
  CAPARIUM_SMTP_PASSWORD: "p",
  CAPARIUM_MAIL_FROM: "napplo@example.test",
  CAPARIUM_PUBLIC_URL: "https://napplo.example.test/",
};

function outbox() {
  const sent: { to: string; subject: string; text: string; from: string }[] = [];
  const send: MailSender = async (m) => {
    sent.push({ to: m.to, subject: m.subject, text: m.text, from: m.from });
    return {};
  };
  return { sent, send };
}

let f: Awaited<ReturnType<typeof fixtures>>;
let withMail: { id: string; loginId: string; email: string };
let noMail: { id: string; loginId: string };
const n = Date.now() % 100000;

beforeAll(async () => {
  f = await fixtures();
  const base = { fullName: "Levél Próba", role: "AQUARIST" as const, zimsName: "Mail Test", password: "level-jelszo-123" };
  const a = (await createUser(f.admin, { requestId: rid(), loginId: `level.${n}`, monogram: `LA${n % 100}`, ...base })) as { id: string };
  await updateUser(f.admin, a.id, { requestId: rid(), email: `Level.${n}@Example.test` });
  withMail = { id: a.id, loginId: `level.${n}`, email: `level.${n}@example.test` };
  const b = (await createUser(f.admin, { requestId: rid(), loginId: `nincs.${n}`, monogram: `LB${n % 100}`, ...base })) as { id: string };
  noMail = { id: b.id, loginId: `nincs.${n}` };
});

describe("the forgotten password by e-mail", () => {
  it("by login id or address, a half-hour link from the configured root goes to the account's own address", async () => {
    const box = outbox();
    expect(await requestPasswordReset(withMail.loginId, { env: ENV, send: box.send })).toBe("SENT");
    expect(await requestPasswordReset(` ${withMail.email.toUpperCase()} `, { env: ENV, send: box.send })).toBe("SENT");
    expect(box.sent.map((m) => m.to)).toEqual([withMail.email, withMail.email]);
    expect(box.sent[0]!.from).toBe("napplo@example.test");
    const link = box.sent[1]!.text.match(/https:\/\/napplo\.example\.test\/jelszo-visszaallitas\/([A-Za-z0-9_-]{40,})/);
    expect(link).not.toBeNull();
    expect(box.sent[1]!.text).toContain("30 percig");
    // the second request ended the first link; the last one works
    expect(await resetLinkUsable(link![1]!)).toBe(true);
    const first = box.sent[0]!.text.match(/jelszo-visszaallitas\/([A-Za-z0-9_-]+)/)![1]!;
    expect(await resetLinkUsable(first)).toBe(false);
    expect(await resetLinkUsable(link![1]!, new Date(Date.now() + 31 * 60_000))).toBe(false);
  });

  it("no address, no account, an inactive one, or no mail or public address set up: nothing is sent and no link is made", async () => {
    const box = outbox();
    const before = await prisma.passwordReset.count();
    expect(await requestPasswordReset(noMail.loginId, { env: ENV, send: box.send })).toBe("NO_ADDRESS");
    expect(await requestPasswordReset(`nincs-ilyen-${n}`, { env: ENV, send: box.send })).toBe("NO_MATCH");
    const gone = (await createUser(f.admin, {
      requestId: rid(),
      loginId: `kilepett.${n}`,
      monogram: `LC${n % 100}`,
      fullName: "Kilépett",
      role: "AQUARIST",
      zimsName: "Gone Test",
      password: "kilepett-jelszo-1",
    })) as { id: string };
    await updateUser(f.admin, gone.id, { requestId: rid(), email: `kilepett.${n}@example.test` });
    await updateUser(f.admin, gone.id, { requestId: rid(), active: false, reason: "kilépett" });
    expect(await requestPasswordReset(`kilepett.${n}@example.test`, { env: ENV, send: box.send })).toBe("NO_MATCH");
    const { CAPARIUM_PUBLIC_URL: _gone, ...noBase } = ENV;
    expect(await requestPasswordReset(withMail.loginId, { env: noBase, send: box.send })).toBe("NOT_CONFIGURED");
    expect(await requestPasswordReset(withMail.loginId, { env: { ...ENV, CAPARIUM_PUBLIC_URL: "http://napplo.example.test" }, send: box.send })).toBe("NOT_CONFIGURED");
    const { CAPARIUM_SMTP_HOST: _h, ...noSmtp } = ENV;
    expect(await requestPasswordReset(withMail.loginId, { env: noSmtp, send: box.send })).toBe("NOT_CONFIGURED");
    expect(box.sent).toEqual([]);
    expect(await prisma.passwordReset.count()).toBe(before);
  });

  it("at most three mails per account in fifteen minutes", async () => {
    const box = outbox();
    const later = new Date(Date.now() + 60 * 60_000);
    const outcomes = [];
    for (let i = 0; i < 4; i++) outcomes.push(await requestPasswordReset(withMail.loginId, { env: ENV, send: box.send }, later));
    expect(outcomes).toEqual(["SENT", "SENT", "SENT", "THROTTLED"]);
    expect(box.sent).toHaveLength(3);
  });

  it("the route answers the same for an existing and an unknown account, and refuses another origin", async () => {
    const call = (identifier: string, origin = "http://napplo.test") =>
      requestRoute(
        new Request("http://napplo.test/api/password-reset/request", {
          method: "POST",
          headers: { host: "napplo.test", origin, "content-type": "application/json", "x-forwarded-for": `10.77.0.${n % 200}` },
          body: JSON.stringify({ identifier }),
        }),
      );
    const known = await call(withMail.loginId);
    const unknown = await call(`senki-${n}`);
    expect(known.status).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());
    expect((await call(withMail.loginId, "https://idegen.example")).status).toBe(403);
  });

  it("the old address is told of an own e-mail change; nobody is told when there was no address", async () => {
    const box = outbox();
    const u = await prisma.user.findUniqueOrThrow({ where: { id: withMail.id } });
    const actor = { id: u.id, fullName: u.fullName, loginId: u.loginId, role: u.role };
    const newAddr = `uj.${n}@example.test`;
    await updateOwnProfile(actor, { requestId: rid("own"), email: newAddr, currentPassword: "level-jelszo-123" }, { client: null }, { env: ENV, send: box.send });
    expect(box.sent.map((m) => m.to)).toEqual([withMail.email]);
    expect(box.sent[0]!.text).toContain("megváltoztatták");
    expect(await notifyEmailChanged({ fullName: "X", oldEmail: "a@example.test", newEmail: null }, { env: {}, send: box.send })).toBe("NOT_CONFIGURED");
    const v = await prisma.user.findUniqueOrThrow({ where: { id: noMail.id } });
    const box2 = outbox();
    await updateOwnProfile({ id: v.id, fullName: v.fullName, loginId: v.loginId, role: v.role }, { requestId: rid("own"), email: `elso.${n}@example.test`, currentPassword: "level-jelszo-123" }, { client: null }, { env: ENV, send: box2.send });
    expect(box2.sent).toEqual([]);
  });
});
