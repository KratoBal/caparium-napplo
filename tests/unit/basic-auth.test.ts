// The public test site's gate: every path behind it, the exact health path excepted, closed when
// half-configured, rate-limited per client address.
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { checkCredentials, clientIp, FailureLimiter, gateConfig, parseBasic } from "@/lib/basic-auth";
import { proxy } from "@/proxy";

const PASS = "nagyon-hosszu-teszt-jelszo-42";
const SHA = createHash("sha256").update(PASS).digest("hex");
const basic = (u: string, p: string) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");

describe("gate configuration", () => {
  it("off when nothing is set, on when both are, closed when only one is", () => {
    expect(gateConfig({}).mode).toBe("off");
    expect(gateConfig({ BASIC_AUTH_USER: "lilian", BASIC_AUTH_SHA256: SHA }).mode).toBe("on");
    expect(gateConfig({ BASIC_AUTH_USER: "lilian" }).mode).toBe("misconfigured");
    expect(gateConfig({ BASIC_AUTH_SHA256: SHA }).mode).toBe("misconfigured");
    expect(gateConfig({ BASIC_AUTH_USER: "lilian", BASIC_AUTH_SHA256: "nem-hex" }).mode).toBe("misconfigured");
    expect(gateConfig({ BASIC_AUTH_USER: "lilian", BASIC_AUTH_PASSWORD: PASS }).mode).toBe("on");
    expect(gateConfig({ BASIC_AUTH_PASSWORD: PASS }).mode).toBe("misconfigured");
    expect(gateConfig({ BASIC_AUTH_USER: "lilian", BASIC_AUTH_PASSWORD: "rovid" }).mode).toBe("misconfigured");
  });

  it("the password form checks the same way as the hash form", async () => {
    const cfg = { user: "lilian", password: PASS };
    expect(await checkCredentials(basic("lilian", PASS), cfg)).toBe(true);
    expect(await checkCredentials(basic("lilian", PASS.slice(1)), cfg)).toBe(false);
  });
});

describe("credentials", () => {
  const cfg = { user: "lilian", sha256: SHA };
  it("accepts the right pair only", async () => {
    expect(await checkCredentials(basic("lilian", PASS), cfg)).toBe(true);
    expect(await checkCredentials(basic("lilian", PASS + "x"), cfg)).toBe(false);
    expect(await checkCredentials(basic("Lilian", PASS), cfg)).toBe(false);
    expect(await checkCredentials(null, cfg)).toBe(false);
    expect(await checkCredentials("Bearer abc", cfg)).toBe(false);
  });
  it("a password may contain a colon; a header without one is refused", () => {
    expect(parseBasic(basic("a", "b:c"))).toEqual({ user: "a", pass: "b:c" });
    expect(parseBasic("Basic " + Buffer.from("nincs-kettospont").toString("base64"))).toBeNull();
  });
});

describe("client address and limiter", () => {
  it("takes the address the proxy appended (the last one), not one the client wrote", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }))).toBe("9.9.9.9");
  });
  it("blocks after the maximum failures within the window, and frees after it", () => {
    const l = new FailureLimiter(3, 1000);
    for (let i = 0; i < 3; i++) l.fail("a", 0);
    expect(l.blocked("a", 10)).toBe(true);
    expect(l.blocked("b", 10)).toBe(false);
    expect(l.blocked("a", 1001)).toBe(false);
  });
});

describe("the proxy: every path is behind the gate", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  // the tests set the variables themselves; whatever the shell had is not part of them
  delete env.BASIC_AUTH_USER;
  delete env.BASIC_AUTH_SHA256;
  delete env.BASIC_AUTH_PASSWORD;
  delete env.BASIC_AUTH;
  delete env.COOKIE_SECURE;
  const req = (path: string, auth?: string, ip = "10.0.0.1") =>
    new NextRequest(`https://caparium-teszt.example${path}`, {
      headers: { ...(auth ? { authorization: auth } : {}), "x-forwarded-for": ip },
    });

  it.each(["/", "/belepes", "/vizmeres", "/api/grid?groupId=x&day=2026-10-19", "/api/measurements", "/_next/static/chunks/main.js", "/api/health/", "/API/HEALTH", "/fuggo"])(
    "%s: 401 without credentials, through with them",
    async (path) => {
      process.env.BASIC_AUTH_USER = "lilian";
      process.env.BASIC_AUTH_SHA256 = SHA;
      const no = await proxy(req(path, undefined, `10.1.${path.length}.1`));
      expect(no.status).toBe(401);
      expect(no.headers.get("www-authenticate")).toMatch(/^Basic /);
      const yes = await proxy(req(path, basic("lilian", PASS), `10.2.${path.length}.1`));
      expect(yes.headers.get("x-middleware-next")).toBe("1");
    },
  );

  it("only the exact /api/health passes without credentials", async () => {
    process.env.BASIC_AUTH_USER = "lilian";
    process.env.BASIC_AUTH_SHA256 = SHA;
    expect((await proxy(req("/api/health"))).headers.get("x-middleware-next")).toBe("1");
  });

  // Lili 2026-10-31 (task caparium-webapp-ikon): a phone asks for the manifest and the icons without the site's credentials
  it.each([
    "/manifest.webmanifest",
    "/icons/apple-touch-icon.png",
    "/icons/icon-32.png",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/maskable-512.png",
  ])("the web app's file %s passes without credentials for a read, and only for a read", async (path) => {
    process.env.BASIC_AUTH_USER = "lilian";
    process.env.BASIC_AUTH_SHA256 = SHA;
    expect((await proxy(req(path, undefined, "10.5.5.1"))).headers.get("x-middleware-next")).toBe("1");
    const head = await proxy(new NextRequest(`https://caparium-teszt.example${path}`, { method: "HEAD", headers: { "x-forwarded-for": "10.5.5.2" } }));
    expect(head.headers.get("x-middleware-next")).toBe("1");
    const post = await proxy(new NextRequest(`https://caparium-teszt.example${path}`, { method: "POST", headers: { "x-forwarded-for": "10.5.5.3" } }));
    expect(post.status).toBe(401);
  });

  it.each([
    "/icons",
    "/icons/",
    "/icons/other.png",
    "/icons/icon-192.png/",
    "/icons/icon-192.png/x",
    "/icons/ICON-192.png",
    "/manifest.webmanifest/x",
    "/manifest.json",
    "/icons/../api/grid",
    "/icons/%2e%2e/api/grid",
    "/icons/icon-192.png%2fx",
    "/api/icons/icon-192.png",
  ])("%s, a neighbour of the web app's files, stays behind the gate", async (path) => {
    process.env.BASIC_AUTH_USER = "lilian";
    process.env.BASIC_AUTH_SHA256 = SHA;
    const r = await proxy(req(path, undefined, `10.6.${path.length}.1`));
    expect(r.status, path).toBe(401);
  });

  it("a half configuration closes the site instead of opening it", async () => {
    process.env.BASIC_AUTH_USER = "lilian";
    delete process.env.BASIC_AUTH_SHA256;
    expect((await proxy(req("/", basic("lilian", PASS)))).status).toBe(503);
  });

  it("after 20 wrong attempts from one address: 429, even with the right password", async () => {
    process.env.BASIC_AUTH_USER = "lilian";
    process.env.BASIC_AUTH_SHA256 = SHA;
    for (let i = 0; i < 20; i++) expect((await proxy(req("/", basic("lilian", "rossz"), "10.9.9.9"))).status).toBe(401);
    expect((await proxy(req("/", basic("lilian", PASS), "10.9.9.9"))).status).toBe(429);
    expect((await proxy(req("/", basic("lilian", PASS), "10.9.9.8"))).headers.get("x-middleware-next")).toBe("1");
  });

  it.each([
    ["COOKIE_SECURE=true", { COOKIE_SECURE: "true" }, {}],
    ["X-Forwarded-Proto: https", {}, { "x-forwarded-proto": "https" }],
  ])("a missing gate on a public site (%s) closes every path but /api/health (review of #5)", async (_l, envAdd, headers) => {
    Object.assign(process.env, envAdd);
    for (const path of ["/", "/belepes", "/api/grid", "/_next/static/chunks/main.js"]) {
      const r = await proxy(new NextRequest(`https://caparium-teszt.example${path}`, { headers }));
      expect(r.status, path).toBe(503);
    }
    const h = await proxy(new NextRequest("https://caparium-teszt.example/api/health", { headers }));
    expect(h.headers.get("x-middleware-next")).toBe("1");
  });

  it("only an explicit BASIC_AUTH=off runs a public site without the gate", async () => {
    process.env.COOKIE_SECURE = "true";
    process.env.BASIC_AUTH = "off";
    expect((await proxy(req("/"))).headers.get("x-middleware-next")).toBe("1");
  });

  it("an explicit BASIC_AUTH=off wins over a password Coolify generated for the compose (first public deploy)", async () => {
    // the compose names SERVICE_PASSWORD_BASICAUTH, so Coolify fills BASIC_AUTH_PASSWORD even with no gate user
    process.env.COOKIE_SECURE = "true";
    process.env.BASIC_AUTH = " Off ";
    process.env.BASIC_AUTH_PASSWORD = "coolify-altal-generalt-jelszo-32-karakter";
    delete process.env.BASIC_AUTH_USER;
    delete process.env.BASIC_AUTH_SHA256;
    for (const path of ["/", "/api/grid"]) {
      const r = await proxy(new NextRequest(`https://caparium-teszt.example${path}`, { headers: { "x-forwarded-proto": "https" } }));
      expect(r.headers.get("x-middleware-next"), path).toBe("1");
    }
    // any other value is not the switch: the half configuration stays closed
    process.env.BASIC_AUTH = "false";
    expect((await proxy(req("/"))).status).toBe(503);
  });

  it("BASIC_AUTH=off next to a gate user is a contradiction: closed, never silently open (review of #8)", async () => {
    // the gate turned back on in Coolify, the old "off" line left behind
    process.env.COOKIE_SECURE = "true";
    process.env.BASIC_AUTH = "off";
    process.env.BASIC_AUTH_USER = "lilian";
    process.env.BASIC_AUTH_SHA256 = SHA;
    expect((await proxy(req("/", basic("lilian", PASS)))).status).toBe(503);
    process.env.BASIC_AUTH_PASSWORD = PASS;
    delete process.env.BASIC_AUTH_SHA256;
    expect((await proxy(req("/", basic("lilian", PASS)))).status).toBe(503);
  });

  it("off without configuration (local development, CI)", async () => {
    delete process.env.BASIC_AUTH_USER;
    delete process.env.BASIC_AUTH_SHA256;
    expect((await proxy(req("/"))).headers.get("x-middleware-next")).toBe("1");
  });
});

describe("FailureLimiter.succeed", () => {
  it("gives one counted attempt back, never below zero, and not after the window", () => {
    const l = new FailureLimiter(2, 1000);
    l.fail("a", 0);
    l.fail("a", 0);
    expect(l.blocked("a", 1)).toBe(true);
    l.succeed("a", 1);
    expect(l.blocked("a", 1)).toBe(false);
    l.succeed("a", 1);
    l.succeed("a", 1);
    l.fail("a", 2);
    l.fail("a", 2);
    expect(l.blocked("a", 3)).toBe(true);
  });
});
