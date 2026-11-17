// Lili's filled-in sheets -> src/lib/i18n/en.ts (card 01dcddeb, task t-20261117-caparium-forditas-import). One command when they come back:
//
//   npx tsx scripts/i18n/import.ts <big.xlsx> <supplement.xlsx>           # check only: the report, nothing written
//   npx tsx scripts/i18n/import.ts <big.xlsx> <supplement.xlsx> --write   # the same, then en.ts, if there is no error
//
// Exit 1 on any error (a {place} that differs, one text with two Englishes, a sheet name Excel refuses): the report names each one with its
// sheet and row, and nothing is written. Empty English cells and code keys no sheet holds are listed, not errors: they stay Hungarian.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildDictionary, codeKeys, readSheet, readSources, renderEnTs } from "./core";
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
  if (sheets.length !== 2) {
    console.error("használat: npx tsx scripts/i18n/import.ts <nagy tábla.xlsx> <kiegészítő.xlsx> [--write]");
    return 2;
  }
  const rows = [...(await readSheet(sheets[0]!, "nagy")), ...(await readSheet(sheets[1]!, "kiegészítő"))];
  const keys = codeKeys(readSources(sourcesUnder("src")), readFileSync("tests/unit/i18n-guard.test.ts", "utf8"));
  const r = buildDictionary(keys, rows);
  console.log(`${keys.length} kulcs a kódban, ${rows.length} sor a két táblában`);
  console.log(`lefordítva: ${Object.keys(r.entries).length}; üres Angol cella: ${r.empty.length}; táblában nincs: ${r.unmatched.length}; kulcs nélküli kitöltött sor: ${r.unused.length}`);
  for (const [title, list] of [
    ["ÜRES ANGOL (magyarul marad)", r.empty],
    ["A TÁBLÁKBAN NINCS (a következő kiegészítőbe)", r.unmatched],
    ["KITÖLTÖTT SOR, AMIT KULCS NEM HASZNÁL", r.unused],
  ] as const) {
    if (list.length) console.log(`\n${title}:\n${list.map((l) => `  - ${l}`).join("\n")}`);
  }
  if (r.errors.length) {
    console.error(`\nHIBA (${r.errors.length}), semmi nem íródott:\n${r.errors.map((e) => `  - ${e}`).join("\n")}`);
    return 1;
  }
  if (write) {
    writeFileSync("src/lib/i18n/en.ts", renderEnTs(r.entries, EN));
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
