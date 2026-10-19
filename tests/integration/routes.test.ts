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

// every call from its own address unless a test says otherwise, so the per-address limiter of
// the login route does not carry failures from one test into the next
let addr = 0;
function form(fields: Record<string, string>, origin = BASE, ip = `10.77.${Math.floor(++addr / 250)}.${addr % 250}`): Request {
  return new Request(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { origin, host: "napplo.test", "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ip },
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

  it("locks after repeated failures, even with the right password, with the answer of a wrong password (32580)", async () => {
    const u = await prisma.user.create({
      data: { loginId: `zar-${Date.now()}`, fullName: "Zárolás Teszt", role: "AQUARIST", passwordHash: await hashPassword("helyes-jelszo-1") },
    });
    for (let i = 0; i < 10; i++) await loginRoute(form({ loginId: u.loginId, password: "rossz" }));
    const locked = await loginRoute(form({ loginId: u.loginId, password: "helyes-jelszo-1" }));
    const unknown = await loginRoute(form({ loginId: "nincs.ilyen.felhasznalo", password: "helyes-jelszo-1" }));
    // the locked id and an id that does not exist cannot be told apart from the answer
    for (const r of [locked, unknown]) {
      expect(r.status).toBe(303);
      expect(r.headers.get("location")).toBe("/belepes?hiba=adat");
      expect(r.headers.get("set-cookie")).toBeNull();
    }
    expect(await prisma.auditEntry.count({ where: { action: "LOGIN_FAILED", entityId: u.id } })).toBeGreaterThanOrEqual(10);
  });

  it("20 failed logins from one address pause that address, also for the right password; another address is not affected", async () => {
    const ip = "203.0.113.9";
    for (let i = 0; i < 20; i++) {
      const r = await loginRoute(form({ loginId: `ismeretlen-${i}`, password: "akarmi-akarmi" }, BASE, `198.51.100.1, ${ip}`));
      expect(r.headers.get("location")).toBe("/belepes?hiba=adat");
    }
    const blocked = await loginRoute(form({ loginId: "teszt.akvarista1", password: TEST_PASSWORD }, BASE, ip));
    expect(blocked.headers.get("location")).toBe("/belepes?hiba=sok");
    expect(blocked.headers.get("set-cookie")).toBeNull();
    // the first X-Forwarded-For entry is the client's own text: it does not move the key
    const forged = await loginRoute(form({ loginId: "teszt.akvarista1", password: TEST_PASSWORD }, BASE, `203.0.113.77, ${ip}`));
    expect(forged.headers.get("location")).toBe("/belepes?hiba=sok");
    const other = await loginRoute(form({ loginId: "teszt.akvarista1", password: TEST_PASSWORD }, BASE, "203.0.113.10"));
    expect(other.headers.get("location")).toBe("/");
  });

  it("parallel attempts from one address: exactly 20 get to the password check, the rest are paused (review 32585)", async () => {
    const ip = "203.0.113.21";
    const answers = await Promise.all(
      Array.from({ length: 25 }, (_, i) => loginRoute(form({ loginId: `parhuzamos-${i}`, password: "akarmi-akarmi" }, BASE, ip))),
    );
    const where = answers.map((r) => r.headers.get("location"));
    expect(where.filter((l) => l === "/belepes?hiba=adat")).toHaveLength(20);
    expect(where.filter((l) => l === "/belepes?hiba=sok")).toHaveLength(5);
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
