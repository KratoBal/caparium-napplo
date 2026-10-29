// Every variable the gate reads must reach the app container: a value set in Coolify that the
// compose file does not pass is silently absent (the BASIC_AUTH=off of the first public deploy).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

function appEnvironmentKeys(compose: string): Set<string> {
  const start = compose.indexOf("\n  app:\n");
  if (start < 0) throw new Error("no app service in docker-compose.yml");
  const rest = compose.slice(start + 1);
  const next = rest.slice(1).search(/\n(  [a-z][\w-]*:|[a-z][\w-]*:)\n/);
  const block = next < 0 ? rest : rest.slice(0, next + 1);
  return new Set([...block.matchAll(/^ {6}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]));
}

describe("docker-compose app environment", () => {
  it("passes every SMTP variable src/lib/mail.ts reads (caparium-hibak-4)", () => {
    const named = [...read("src/lib/mail.ts").matchAll(/"(CAPARIUM_[A-Z_]+)"/g), ...read("src/lib/zims-mail.ts").matchAll(/env\.(CAPARIUM_[A-Z_]+)/g)].map((m) => m[1]);
    const names = [...new Set(named)];
    expect(names).toEqual(expect.arrayContaining(["CAPARIUM_SMTP_HOST", "CAPARIUM_SMTP_PASSWORD", "CAPARIUM_MAIL_FROM", "CAPARIUM_MONTHLY_ZIMS_MAIL"]));
    const passed = appEnvironmentKeys(read("docker-compose.yml"));
    expect(names.filter((n) => !passed.has(n))).toEqual([]);
  });

  it("passes every variable src/lib/basic-auth.ts reads", () => {
    const read_ = [...read("src/lib/basic-auth.ts").matchAll(/env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]);
    const names = [...new Set(read_)];
    expect(names).toEqual(expect.arrayContaining(["BASIC_AUTH", "BASIC_AUTH_USER", "COOKIE_SECURE"]));
    const passed = appEnvironmentKeys(read("docker-compose.yml"));
    expect(names.filter((n) => !passed.has(n))).toEqual([]);
  });
});

// 2026-10-29 (acrobot 37810): the db service's backup script came in by a relative bind mount, and the Coolify app,
// deployed from git, has no repository files beside its compose file: Docker made an empty directory there and every
// scheduled backup failed at once. No service may take a file of the repository by a relative bind mount.
describe("docker-compose volumes", () => {
  it("bind-mount no file of the repository: what a service needs is in its image", () => {
    const relative = [...read("docker-compose.yml").matchAll(/^\s*-\s*["']?(\.{1,2}\/[^:"'\s]+):/gm)].map((m) => m[1]);
    expect(relative).toEqual([]);
  });

  it("the db image carries the backup script, executable, where the scheduled task calls it", () => {
    const docker = read("Dockerfile.db");
    expect(docker).toMatch(/^FROM postgres:17$/m);
    expect(docker).toMatch(/^COPY scripts\/db-backup\.sh \/usr\/local\/bin\/caparium-backup$/m);
    expect(docker).toMatch(/^RUN chmod 0755 \/usr\/local\/bin\/caparium-backup$/m);
    expect(read("docker-compose.yml")).toMatch(/dockerfile: Dockerfile\.db/);
  });
});
