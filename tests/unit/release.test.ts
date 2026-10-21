// The deployed commit in /api/health (acrobot 34597): only a full SHA the platform set counts; anything else is null.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { releaseCommit } from "@/lib/release";

const SHA = "222e9f8c4b1f0a9d3e7c6b5a4f3e2d1c0b9a8f7e";

describe("releaseCommit", () => {
  it("a full lowercase SHA is the commit", () => {
    expect(releaseCommit({ RELEASE_COMMIT_SHA: SHA })).toBe(SHA);
    expect(releaseCommit({ RELEASE_COMMIT_SHA: ` ${SHA}\n` })).toBe(SHA);
  });

  it.each([
    ["unset", undefined],
    ["empty (an unknown ${NAME} in Coolify resolves to empty)", ""],
    ["short", "222e9f8"],
    ["upper case", SHA.toUpperCase()],
    ["the literal placeholder", "${SOURCE_COMMIT}"],
  ])("%s is null, never a guess", (_label, value) => {
    expect(releaseCommit({ RELEASE_COMMIT_SHA: value })).toBeNull();
  });

  it("the compose file passes it from the platform's per-deploy commit, not a typed hash", () => {
    const compose = readFileSync(new URL("../../docker-compose.yml", import.meta.url), "utf8");
    expect(compose).toMatch(/^ {6}RELEASE_COMMIT_SHA: \$\{SOURCE_COMMIT:-\}$/m);
  });
});
