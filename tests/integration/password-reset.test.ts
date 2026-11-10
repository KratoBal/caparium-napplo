// Task e7f9e84d, slice 3: an admin makes a one-time reset link, the user sets a new password through it without a session.
// WHAT TURNS THIS RED: a link usable twice, after it expired, for an inactive user, or after a newer one was made; the old
// password still working, or a session surviving the reset; the raw token or the password in the audit or the table; an
// aquarist making a link; a reset from another origin; a scrypt run for a token that is not a usable link (barracuda on #218).
import { beforeAll, describe, expect, it } from "vitest";
import { POST as resetRoute } from "@/app/api/password-reset/route";
import { createPasswordResetLink, createUser, updateUser } from "@/lib/admin";
import { login } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { hashPassword } from "@/lib/auth";
import { resetLinkUsable, resetPassword } from "@/lib/password-reset";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
let userId: string;
const loginId = `reset.${Date.now() % 100000}`;
const OLD = "regi-jelszo-12345";
const NEW = "uj-jelszo-67890";

beforeAll(async () => {
  f = await fixtures();
  const r = await createUser(f.admin, { requestId: rid(), loginId, fullName: "Visszaállító Próba", role: "AQUARIST", monogram: `RP${Date.now() % 1000}`, zimsName: "Reset Test", password: OLD });
  userId = (r as { id: string }).id;
});

const tokenOf = (path: string) => path.split("/").at(-1)!;

function post(body: unknown, origin = "http://napplo.test") {
  return resetRoute(
    new Request("http://napplo.test/api/password-reset", {
      method: "POST",
      headers: { host: "napplo.test", origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function code(p: Promise<unknown>) {
  const e = await p.then(() => null, (err: unknown) => err);
  return e instanceof AppError ? e.code : String(e);
}

describe("a one-time reset link", () => {
  it("an aquarist cannot make one; an admin's link sets the new password once, ends the sessions, and the audit keeps no secret", async () => {
    expect(await code(createPasswordResetLink(f.aq1, userId, rid()))).toBe("ADMIN_ROLE_ONLY");
    expect((await login(loginId, OLD, null)).ok).toBe(true);
    expect(await prisma.session.count({ where: { userId } })).toBeGreaterThan(0);

    const { path, expiresAt } = await createPasswordResetLink(f.admin, userId, rid());
    expect(path).toMatch(/^\/jelszo-visszaallitas\/[A-Za-z0-9_-]{40,}$/);
    expect(new Date(expiresAt).getTime() - Date.now()).toBeGreaterThan(23 * 3600_000);
    const token = tokenOf(path);
    expect(await resetLinkUsable(token)).toBe(true);

    expect((await post({ token, newPassword: NEW }, "https://idegen.example")).status).toBe(403);
    expect((await post({ token, newPassword: NEW })).status).toBe(200);
    expect(await prisma.session.count({ where: { userId } })).toBe(0);
    expect((await login(loginId, OLD, null)).ok).toBe(false);
    expect((await login(loginId, NEW, null)).ok).toBe(true);

    // once only
    expect((await post({ token, newPassword: "masodik-jelszo-1" })).status).toBe(410);
    expect(await resetLinkUsable(token)).toBe(false);

    const rows = await prisma.passwordReset.findMany({ where: { userId } });
    expect(JSON.stringify(rows)).not.toContain(token);
    const audits = await prisma.auditEntry.findMany({ where: { entityType: "User", entityId: userId } });
    const text = JSON.stringify(audits.map((a) => ({ changes: a.changes, reason: a.reason })));
    expect(text).not.toContain(token);
    expect(text).not.toContain(NEW);
    expect(text).toContain("visszaállító link");
  });

  it("a made-up, used or expired token is refused before any scrypt runs; a busy hasher is a 503, not a 500", async () => {
    let runs = 0;
    const counting = async (p: string) => {
      runs += 1;
      return { ran: true as const, value: await hashPassword(p) };
    };
    expect(await code(resetPassword({ token: "x".repeat(43), newPassword: "kitalalt-jelszo-1" }, null, new Date(), counting))).toBe("RESET_LINK_GONE");
    const token = tokenOf((await createPasswordResetLink(f.admin, userId, rid())).path);
    const later = new Date(Date.now() + 25 * 3600_000);
    expect(await code(resetPassword({ token, newPassword: "lejart-jelszo-12" }, null, later, counting))).toBe("RESET_LINK_GONE");
    expect(runs).toBe(0);
    expect(await code(resetPassword({ token, newPassword: "foglalt-jelszo-1" }, null, new Date(), async () => ({ ran: false })))).toBe("BUSY");
    // the busy try did not use the link up
    expect(await resetLinkUsable(token)).toBe(true);
    await resetPassword({ token, newPassword: "valodi-jelszo-12" }, null, new Date(), counting);
    expect(runs).toBe(1);
    expect(await code(resetPassword({ token, newPassword: "ujra-jelszo-1234" }, null, new Date(), counting))).toBe("RESET_LINK_GONE");
    expect(runs).toBe(1);
  });

  it("a newer link ends the older one; an expired link and an inactive user's link do nothing", async () => {
    const first = tokenOf((await createPasswordResetLink(f.admin, userId, rid())).path);
    const second = tokenOf((await createPasswordResetLink(f.admin, userId, rid())).path);
    expect((await post({ token: first, newPassword: "elso-link-jelszo" })).status).toBe(410);
    expect(await resetLinkUsable(second)).toBe(true);

    const later = new Date(Date.now() + 25 * 3600_000);
    expect(await resetLinkUsable(second, later)).toBe(false);

    await updateUser(f.admin, userId, { requestId: rid(), active: false, reason: "teszt" });
    expect((await post({ token: second, newPassword: "inaktiv-jelszo-1" })).status).toBe(410);
    expect(await code(createPasswordResetLink(f.admin, userId, rid()))).toBe("INACTIVE");
  });
});
