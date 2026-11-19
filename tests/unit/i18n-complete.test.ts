// EVERY KEY THE CODE TRANSLATES HAS ITS ENGLISH (the Caparium bug round, 2026-11-19, t-20261119-caparium-angol-hiany). Until then
// nothing turned red when a tr() key had no English: 91 such keys showed in Hungarian in the English view, part of them because a
// concatenated key became a placeholder key and Lili's English stayed on the old one. This reads the code's keys the way the import
// does (codeKeys over src, with the guard's allowed lists) and asks en.ts for each. WHAT TURNS IT RED: a new or changed tr() text
// with no sheet row and no proposal; a proposal deleted while its key is still used.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codeKeys, readSources } from "../../scripts/i18n/core";
import { EN } from "../../src/lib/i18n/en";

const root = join(__dirname, "..", "..");
const sourcesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourcesUnder(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });

describe("the English dictionary is complete", () => {
  it("every key the code passes to tr() has an English in en.ts", () => {
    const keys = codeKeys(
      readSources(sourcesUnder(join(root, "src"))),
      readFileSync(join(root, "tests/unit/i18n-guard.test.ts"), "utf8"),
    );
    const missing = keys.map((k) => k.hu).filter((hu) => !EN[hu]);
    expect(keys.length).toBeGreaterThan(1000);
    expect(missing).toEqual([]);
  });
});
