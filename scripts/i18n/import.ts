// Lili's filled-in sheets -> src/lib/i18n/en.ts (card 01dcddeb, task t-20261117-caparium-forditas-import). One command when they come back:
//
//   npx tsx scripts/i18n/import.ts <big.xlsx> [<supplement.xlsx>]           # check only: the report, nothing written
//   npx tsx scripts/i18n/import.ts <big.xlsx> [<supplement.xlsx>] --write   # the same, then en.ts, if there is no error
//
// The supplement may be left out while it is not back yet (acrobot 55517, 2026-11-18: Lili returned the first sheet only and wants to
// see its words in place): its keys then count as "not in the sheets" and stay Hungarian, as any unmatched key does.
//
// Exit 1 on any error (a {place} that differs, one text with two Englishes, a sheet name Excel refuses): the report names each one with its
// sheet and row, and nothing is written. Empty English cells and code keys no sheet holds are listed, not errors: they stay Hungarian.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyOverrides, applyProposals, buildDictionary, codeKeys, readSheet, readSources, renderEnTs } from "./core";
import { OVERRIDES } from "./overrides";
import { PROPOSALS } from "./proposals";
import { EN } from "../../src/lib/i18n/en";

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourcesUnder(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const sheets = args.filter((a) => a !== "--write");
  if (sheets.length < 1 || sheets.length > 2) {
    console.error("használat: npx tsx scripts/i18n/import.ts <nagy tábla.xlsx> [<kiegészítő.xlsx>] [--write]");
    return 2;
  }
  const rows = [
    ...(await readSheet(sheets[0]!, "nagy")),
    ...(sheets[1] ? await readSheet(sheets[1], "kiegészítő") : []),
  ];
  const keys = codeKeys(readSources(sourcesUnder("src")), readFileSync("tests/unit/i18n-guard.test.ts", "utf8"));
  const r = buildDictionary(keys, rows);
  console.log(`${keys.length} kulcs a kódban, ${rows.length} sor ${sheets.length === 2 ? "a két táblában" : "a nagy táblában (kiegészítő nélkül)"}`);
  console.log(`lefordítva: ${Object.keys(r.entries).length}; üres Angol cella: ${r.empty.length}; táblában nincs: ${r.unmatched.length}; kulcs nélküli kitöltött sor: ${r.unused.length}`);
  for (const [title, list] of [
    ["ÜRES ANGOL (magyarul marad)", r.empty],
    ["A TÁBLÁKBAN NINCS (a következő kiegészítőbe)", r.unmatched],
    ["KITÖLTÖTT SOR, AMIT KULCS NEM HASZNÁL", r.unused],
    ["SORREND SZERINT ÁTNEVEZETT HELYŐRZŐK (nézd meg, hogy az angol a magyar sorrendjét tartja-e)", r.positional],
  ] as const) {
    if (list.length) console.log(`\n${title}:\n${list.map((l) => `  - ${l}`).join("\n")}`);
  }
  // the sheets, then the proposals under them (only where a sheet has no English), then the decisions over everything
  const pr = applyProposals(r.entries, PROPOSALS, keys);
  console.log(`\njavaslat a táblák alatt (scripts/i18n/proposals.ts): ${pr.applied.length}`);
  if (pr.replaced.length) console.log(`JAVASLAT KIVÁLTVA (a tábla már ad angolt, a sora törölhető):\n${pr.replaced.map((k) => `  - ${k}`).join("\n")}`);
  if (pr.stale.length) console.log(`ELAVULT JAVASLAT (a kód már nem használja a kulcsot, nem íródik):\n${pr.stale.map((k) => `  - ${k}`).join("\n")}`);
  const o = applyOverrides(pr.entries, OVERRIDES, keys);
  console.log(`\nkézi döntés a táblák fölött (scripts/i18n/overrides.ts): ${o.applied.length}${o.applied.length ? ` (${o.applied.join(", ")})` : ""}`);
  if (o.stale.length) console.log(`ELAVULT KÉZI DÖNTÉS (a kód már nem használja a kulcsot, nem íródik):\n${o.stale.map((k) => `  - ${k}`).join("\n")}`);
  if (r.errors.length) {
    console.error(`\nHIBA (${r.errors.length}), semmi nem íródott:\n${r.errors.map((e) => `  - ${e}`).join("\n")}`);
    return 1;
  }
  if (write) {
    writeFileSync("src/lib/i18n/en.ts", renderEnTs(o.entries, EN));
    console.log("\nsrc/lib/i18n/en.ts megírva");
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
