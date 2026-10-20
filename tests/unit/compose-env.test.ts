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
    const named = [...read("src/lib/mail.ts").matchAll(/"(CAPARIUM_[A-Z_]+)"/g)].map((m) => m[1]);
    const names = [...new Set(named)];
    expect(names).toEqual(expect.arrayContaining(["CAPARIUM_SMTP_HOST", "CAPARIUM_SMTP_PASSWORD", "CAPARIUM_MAIL_FROM"]));
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
