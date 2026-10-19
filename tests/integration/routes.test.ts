// API-level tests: the real route handlers with real Requests (cookie, origin, JSON) on a real database.
import { beforeAll, describe, expect, it } from "vitest";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { GET as gridRoute } from "@/app/api/grid/route";
import { POST as createRoute } from "@/app/api/measurements/route";
import { PATCH as updateRoute } from "@/app/api/measurements/[id]/route";
import { POST as roundRoute } from "@/app/api/rounds/route";
import { hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { businessDayOf } from "@/lib/time";
import { fixtures, rid } from "./fixtures";
import { TEST_PASSWORD } from "./global-setup";

const BASE = "http://napplo.test";
let f: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => {
  f = await fixtures();
});

function form(fields: Record<string, string>, origin = BASE): Request {
  return new Request(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { origin, host: "napplo.test", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

async function loginAs(loginId: string, password = TEST_PASSWORD): Promise<string> {
  const res = await loginRoute(form({ loginId, password }));
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/");
  const cookie = res.headers.get("set-cookie") ?? "";
  expect(cookie).toMatch(/HttpOnly/);
  expect(cookie).toMatch(/SameSite=Lax/);
  return cookie.split(";")[0];
}

function json(url: string, method: string, body: unknown, cookie?: string, origin = BASE): Request {
  return new Request(`${BASE}${url}`, {
    method,
    headers: {
      host: "napplo.test",
      origin,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("login", () => {
  it("a wrong password redirects back with an error and writes LOGIN_FAILED", async () => {
    const res = await loginRoute(form({ loginId: "teszt.akvarista2", password: "rossz-jelszo" }));
    expect(res.headers.get("location")).toBe("/belepes?hiba=adat");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await prisma.auditEntry.count({ where: { action: "LOGIN_FAILED", userId: f.aq2.id } })).toBeGreaterThan(0);
  });

  it("an unknown user gets the same answer", async () => {
    const res = await loginRoute(form({ loginId: "nincs.ilyen", password: "akarmi-akarmi" }));
    expect(res.headers.get("location")).toBe("/belepes?hiba=adat");
  });

  it("a cross-site login form is refused", async () => {
    const res = await loginRoute(form({ loginId: "teszt.akvarista1", password: TEST_PASSWORD }, "https://evil.example"));
    expect(res.headers.get("location")).toBe("/belepes?hiba=forras");
  });

  it("locks after repeated failures, even with the right password", async () => {
    const u = await prisma.user.create({
      data: { loginId: `zar-${Date.now()}`, fullName: "Zárolás Teszt", role: "AQUARIST", passwordHash: await hashPassword("helyes-jelszo-1") },
    });
    for (let i = 0; i < 10; i++) await loginRoute(form({ loginId: u.loginId, password: "rossz" }));
    const res = await loginRoute(form({ loginId: u.loginId, password: "helyes-jelszo-1" }));
    expect(res.headers.get("location")).toBe("/belepes?hiba=zarolva");
  });

  it("logout ends the session", async () => {
    const cookie = await loginAs("teszt.akvarista2");
    const out = await logoutRoute(new Request(`${BASE}/api/auth/logout`, { method: "POST", headers: { host: "napplo.test", origin: BASE, cookie } }));
    expect(out.headers.get("location")).toBe("/belepes");
    const res = await gridRoute(new Request(`${BASE}/api/grid?groupId=${f.group("NAPI_NAGY")}&day=2026-06-01`, { headers: { cookie } }));
    expect(res.status).toBe(401);
  });
});

describe("module access (R-17, review of PR #1 point A)", () => {
  it("an explicit NONE on the water module closes reading too: the grid answers 403", async () => {
    const u = await prisma.user.create({
      data: { loginId: `nincs-viz-${Date.now()}`, fullName: "Nincs Víz", role: "AQUARIST", passwordHash: await hashPassword(TEST_PASSWORD) },
    });
    await prisma.modulePermission.create({ data: { userId: u.id, module: "WATER", level: "NONE" } });
    const cookie = await loginAs(u.loginId);
    const res = await gridRoute(new Request(`${BASE}/api/grid?groupId=${f.group("NAPI_NAGY")}&day=2026-06-01`, { headers: { cookie } }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NO_ACCESS");
    // a normal aquarist still reads it
    const ok = await gridRoute(new Request(`${BASE}/api/grid?groupId=${f.group("NAPI_NAGY")}&day=2026-06-01`, { headers: { cookie: await loginAs("teszt.akvarista2") } }));
    expect(ok.status).toBe(200);
  });
});

describe("measurement API", () => {
  it("refuses without a session (401) and from another origin (403)", async () => {
    const body = { requestId: rid(), groupId: f.group("NAPI_NAGY"), poolId: f.pool("NAGY"), parameterId: f.param("PH"), value: "8.1" };
    expect((await createRoute(json("/api/measurements", "POST", body))).status).toBe(401);
    const cookie = await loginAs("teszt.akvarista1");
    expect((await createRoute(json("/api/measurements", "POST", body, cookie, "https://evil.example"))).status).toBe(403);
  });

  it("validates the body on the server (400)", async () => {
    const cookie = await loginAs("teszt.akvarista1");
    const res = await createRoute(json("/api/measurements", "POST", { requestId: "x", value: 8 }, cookie));
    expect(res.status).toBe(400);
  });

  it("full flow: save, read back in the grid, edit with the version, conflict on a stale version", async () => {
    const cookie = await loginAs("teszt.akvarista1");
    const today = businessDayOf(new Date());
    const r1 = await roundRoute(json("/api/rounds", "POST", { requestId: rid(), groupId: f.group("NAPI_KIS"), day: today }, cookie));
    expect(r1.status).toBe(200);
    const { round } = (await r1.json()) as { round: { id: string; seq: number } };

    const created = await createRoute(
      json(
        "/api/measurements",
        "POST",
        {
          requestId: rid(),
          clientTimestamp: new Date().toISOString(),
          groupId: f.group("NAPI_KIS"),
          roundId: round.id,
          poolId: f.pool("KORALLOS"),
          parameterId: f.param("TEMP"),
          value: "24,6",
        },
        cookie,
      ),
    );
    expect(created.status).toBe(200);
    const { measurement } = (await created.json()) as { measurement: { id: string; value: string; version: number } };
    expect(measurement.value).toBe("24.6");

    const grid = await gridRoute(new Request(`${BASE}/api/grid?groupId=${f.group("NAPI_KIS")}&day=${today}&round=${round.seq}`, { headers: { cookie } }));
    const g = (await grid.json()) as { cells: Record<string, { value: string; reference: string }> };
    expect(g.cells[`${f.pool("KORALLOS")}:${f.param("TEMP")}`]).toMatchObject({ value: "24.6", reference: "IN_RANGE" });

    const edit = await updateRoute(json(`/api/measurements/${measurement.id}`, "PATCH", { requestId: rid(), expectedVersion: 1, value: "24.8" }, cookie), {
      params: Promise.resolve({ id: measurement.id }),
    });
    expect(edit.status).toBe(200);
    const stale = await updateRoute(json(`/api/measurements/${measurement.id}`, "PATCH", { requestId: rid(), expectedVersion: 1, value: "25" }, cookie), {
      params: Promise.resolve({ id: measurement.id }),
    });
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as { error: { code: string; current: { value: string } } };
    expect(body.error.code).toBe("VERSION_CONFLICT");
    expect(body.error.current.value).toBe("24.8");
  });
});
