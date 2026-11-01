// Lili 2026-11-01 (point 11): every user changes their own display name and password; the monogram and the ZIMS name
// stay with the admin. Through the real route, with real session cookies.
import { beforeAll, describe, expect, it } from "vitest";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { PATCH as profileRoute } from "@/app/api/profile/route";
import { hashPassword, userForToken } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { pickValid } from "@/lib/master";
import { rid } from "./fixtures";

const BASE = "http://napplo.test";
const OLD = "regi-jelszo-1234";
let addr = 0;

async function login(loginId: string, password: string): Promise<string | null> {
  addr += 1;
  const res = await loginRoute(
    new Request(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { origin: BASE, host: "napplo.test", "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": `10.88.0.${addr}` },
      body: new URLSearchParams({ loginId, password }).toString(),
    }),
  );
  return res.headers.get("location") === "/" ? (res.headers.get("set-cookie") ?? "").split(";")[0] : null;
}

const token = (cookie: string) => decodeURIComponent(cookie.split("=").slice(1).join("="));

function patch(cookie: string, body: Record<string, unknown>) {
  return profileRoute(
    new Request(`${BASE}/api/profile`, {
      method: "PATCH",
      headers: { host: "napplo.test", origin: BASE, "content-type": "application/json", cookie },
      body: JSON.stringify({ requestId: rid("own"), ...body }),
    }),
  );
}

let loginId: string;
let userId: string;
beforeAll(async () => {
  loginId = `sajat-${Date.now()}`;
  const u = await prisma.user.create({
    data: {
      loginId,
      fullName: "Saját Próba",
      role: "AQUARIST",
      passwordHash: await hashPassword(OLD),
      monograms: { create: { monogram: "SP", validFrom: new Date("2020-01-01T00:00:00Z") } },
      zimsNames: { create: { zimsName: "Own Test", validFrom: new Date("2020-01-01T00:00:00Z") } },
    },
  });
  userId = u.id;
});

describe("own profile", () => {
  it("changes the own display name, and nothing the admin owns: a monogram or a role in the request is ignored", async () => {
    const cookie = (await login(loginId, OLD))!;
    const res = await patch(cookie, { fullName: "  Új Megjelenő Név ", monogram: "XX", role: "ADMIN", zimsName: "Other" });
    expect(res.status).toBe(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { monograms: true, zimsNames: true } });
    expect(u.fullName).toBe("Új Megjelenő Név");
    expect(u.role).toBe("AQUARIST");
    expect(u.monograms.map((m) => m.monogram)).toEqual(["SP"]);
    expect(pickValid(u.zimsNames, new Date())?.zimsName).toBe("Own Test");
    const audit = await prisma.auditEntry.findFirst({ where: { entityId: userId, action: "MASTER_CHANGE" }, orderBy: { at: "desc" } });
    expect(audit?.userId).toBe(userId);
    expect(audit?.changes).toMatchObject({ fullName: { before: "Saját Próba", after: "Új Megjelenő Név" } });
  });

  // Lili 2026-11-01 (point 17): the helper's greeting name, the user's own; empty clears it
  it("sets and clears the own nickname, audited; the session carries it", async () => {
    const cookie = (await login(loginId, OLD))!;
    expect((await patch(cookie, { nickname: " Sajti " })).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).nickname).toBe("Sajti");
    expect((await userForToken(token(cookie)))?.nickname).toBe("Sajti");
    expect((await patch(cookie, { nickname: "" })).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).nickname).toBeNull();
    const audits = await prisma.auditEntry.findMany({ where: { entityId: userId, action: "MASTER_CHANGE" }, orderBy: { at: "asc" } });
    expect(audits.slice(-2).map((a) => a.changes)).toEqual([{ nickname: { before: null, after: "Sajti" } }, { nickname: { before: "Sajti", after: null } }]);
  });

  it("refuses a formula-like name and an unchanged one", async () => {
    const cookie = (await login(loginId, OLD))!;
    expect((await patch(cookie, { fullName: "=SUM(A1)" })).status).toBe(400);
    const same = await patch(cookie, { fullName: "Új Megjelenő Név" });
    expect(same.status).toBe(422);
  });

  it("a new password needs the right current one; a wrong one counts as a failed login and changes nothing", async () => {
    const cookie = (await login(loginId, OLD))!;
    expect((await patch(cookie, { newPassword: "uj-jelszo-12345" })).status).toBe(400);
    const before = await prisma.auditEntry.count({ where: { action: "LOGIN_FAILED", entityId: userId } });
    const wrong = await patch(cookie, { currentPassword: "nem-ez-a-jelszo", newPassword: "uj-jelszo-12345" });
    expect(wrong.status).toBe(422);
    expect(((await wrong.json()) as { error: { code: string } }).error.code).toBe("WRONG_PASSWORD");
    expect(await prisma.auditEntry.count({ where: { action: "LOGIN_FAILED", entityId: userId } })).toBe(before + 1);
    expect(await login(loginId, OLD)).not.toBeNull();
    expect((await patch(cookie, { currentPassword: OLD, newPassword: "rovid" })).status).toBe(400);
  });

  it("the right one changes it: this session stays, the user's other sessions end, the old password no longer logs in", async () => {
    const here = (await login(loginId, OLD))!;
    const other = (await login(loginId, OLD))!;
    expect(await userForToken(token(other))).not.toBeNull();
    const res = await patch(here, { currentPassword: OLD, newPassword: "uj-jelszo-12345" });
    expect(res.status).toBe(200);
    expect(await userForToken(token(here))).not.toBeNull();
    expect(await userForToken(token(other))).toBeNull();
    expect(await login(loginId, OLD)).toBeNull();
    expect(await login(loginId, "uj-jelszo-12345")).not.toBeNull();
  });

  it("without a session there is nothing to change", async () => {
    const res = await profileRoute(
      new Request(`${BASE}/api/profile`, { method: "PATCH", headers: { host: "napplo.test", origin: BASE, "content-type": "application/json" }, body: JSON.stringify({ requestId: rid("own"), fullName: "Valaki" }) }),
    );
    expect(res.status).toBe(401);
  });
});
