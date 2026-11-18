// THE ENGLISH DICTIONARY FROM LILI'S SHEETS (card 01dcddeb, task t-20261117-caparium-forditas-import). Two sheets come back filled in:
// the big one (exchange/caparium/forditas-napi-modulok-2026-11-17.xlsx) and the supplement (forditas-kiegeszito-2026-11-17.xlsx). A row's
// Hungarian text was extracted from the code before the modules were wrapped, so a key of the code (the first argument of tr()) may be in a
// sheet word for word, or with other names in its {places}. This module pairs the two, checks what a person filled in, and writes en.ts.
// Pure but for the file reads, so the tests run it on a made-up sheet.
import { readFileSync } from "node:fs";
import ts from "typescript";
import ExcelJS from "exceljs";

export type SheetRow = { sheet: string; row: number; hu: string; en: string };
export type CodeKey = { hu: string; files: string[]; sheetName: boolean };
export type ImportResult = {
  /** key (the code's Hungarian) -> English, with the code's {place} names */
  entries: Record<string, string>;
  /** what stops the import: each names the text and where it is */
  errors: string[];
  /** keys whose row has no English yet: they stay Hungarian on an English device */
  empty: string[];
  /** keys no sheet holds: for the next supplement */
  unmatched: string[];
  /** filled rows no key uses: a text the code does not pass through tr() yet, a label translated from a data table, or an older fragment */
  unused: string[];
  /** keys whose places were renamed by position (one sheet name for two of the code's places): right if the English keeps the order */
  positional: string[];
};

const PLACE = /\{(\w+)\}/g;
const placesInOrder = (text: string) => [...text.matchAll(PLACE)].map((m) => m[1]!);
const normal = (text: string) => text.replace(PLACE, "{}").replace(/\s+/g, " ").trim();
// The marks the code keeps OUTSIDE tr() ("‹ {tr("előző nap")}", "– {tr("válassz")} –"), while the sheet's extractor took the visible
// text with them ("‹ előző nap"; Lili on the stage, 2026-11-18, acrobot 55602): a row matches its key without them, and its English
// loses the same marks, or the screen would show them twice.
const EDGE = /^[‹«–—]\s+|\s+[›»–—]$/g;
const bare = (text: string) => text.replace(EDGE, "").trim();
const where = (r: SheetRow) => `${r.sheet}:${r.row}`;

// An Excel sheet name: at most 31 characters, none of : \ / ? * [ ] (ExcelJS cuts or drops it otherwise; barracuda on #238)
const SHEET_NAME_MAX = 31;
const SHEET_NAME_BAD = /[:\\/?*[\]]/;

/** The rows of one filled-in sheet: the "Feliratok" sheet, its "Magyar szöveg" and "Angol" columns found by their header. */
export async function readSheet(path: string, label: string): Promise<SheetRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.getWorksheet("Feliratok");
  if (!ws) throw new Error(`${label}: no "Feliratok" sheet`);
  const head = (ws.getRow(1).values as unknown[]).map((v) => String(v ?? "").trim());
  const huCol = head.indexOf("Magyar szöveg");
  const enCol = head.indexOf("Angol");
  if (huCol < 1 || enCol < 1) throw new Error(`${label}: the header has no "Magyar szöveg" or "Angol" column`);
  const text = (v: ExcelJS.CellValue) =>
    v == null ? "" : typeof v === "object" && "richText" in v ? v.richText.map((p) => p.text).join("") : String(v);
  const rows: SheetRow[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const hu = text(row.getCell(huCol).value).trim();
    if (hu) rows.push({ sheet: label, row: n, hu, en: text(row.getCell(enCol).value).trim() });
  });
  return rows;
}

/** The string leaves of an argument: "a", cond ? "a" : "b", ("a"). */
function leaves(node: ts.Node): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isConditionalExpression(node)) return [...leaves(node.whenTrue), ...leaves(node.whenFalse)];
  if (ts.isParenthesizedExpression(node)) return leaves(node.expression);
  return [];
}

/**
 * The server's messages the response translates (lib/api.ts, errorResponse: tr(e.message), tr(issue.message)); without them as keys the
 * sheet's English for them never reached en.ts (t-20261118-caparium-angol-szerver). An AppError's message, a helper that throws its
 * message argument as one (requireReason), and a zod check's message (a string argument of a z. chain, or its { message }).
 */
const MESSAGE_ARG: Record<string, number> = { requireReason: 3 };

function serverMessages(node: ts.Node, addAny: (text: string) => void): void {
  const add = (text: string) => {
    if (text.trim()) addAny(text);
  };
  if (ts.isNewExpression(node) && node.expression.getText() === "AppError" && node.arguments?.[2]) {
    for (const t of leaves(node.arguments[2])) add(t);
    return;
  }
  if (!ts.isCallExpression(node)) return;
  const callee = node.expression.getText().replace(/\s+/g, "");
  const at = MESSAGE_ARG[callee];
  if (at !== undefined && node.arguments[at]) for (const t of leaves(node.arguments[at])) add(t);
  // a check's message, not a value: z.literal("WATER"), z.enum, a default or a description are data
  if (/^z\./.test(callee) && ts.isPropertyAccessExpression(node.expression) && !/^(literal|enum|nativeEnum|default|describe)$/.test(node.expression.name.text))
    for (const arg of node.arguments) {
      for (const t of leaves(arg)) add(t);
      if (ts.isObjectLiteralExpression(arg))
        for (const p of arg.properties)
          if (ts.isPropertyAssignment(p) && p.name.getText() === "message") for (const t of leaves(p.initializer)) add(t);
    }
}

/**
 * The keys of the code: every tr(text) and translate(lang, text) with a string text, plus the data tables the guard allows as "translated
 * where shown" (tests/unit/i18n-guard.test.ts). A key passed to a call that makes a worksheet (addWorksheet, or a helper whose name says
 * sheet) is a sheet name, and its English must fit Excel's rule.
 */
export function codeKeys(files: { path: string; src: string }[], guardSrc?: string): CodeKey[] {
  const keys = new Map<string, { files: Set<string>; sheetName: boolean }>();
  const add = (hu: string, file: string, sheetName = false) => {
    const k = keys.get(hu) ?? { files: new Set<string>(), sheetName: false };
    k.files.add(file);
    k.sheetName ||= sheetName;
    keys.set(hu, k);
  };
  for (const { path, src } of files) {
    const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node) => {
      serverMessages(node, (t) => add(t, path));
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText();
        const arg = callee === "tr" ? node.arguments[0] : callee === "translate" ? node.arguments[1] : undefined;
        if (arg) {
          const parent = node.parent;
          const sheetName = ts.isCallExpression(parent) && /(^|\.)(addWorksheet|sheet)$/i.test(parent.expression.getText());
          for (const t of leaves(arg)) add(t, path, sheetName);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  if (guardSrc) {
    const sf = ts.createSourceFile("guard.ts", guardSrc, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && node.name.text.startsWith("src/") && ts.isObjectLiteralExpression(node.initializer)) {
        const props = new Map(node.initializer.properties.filter(ts.isPropertyAssignment).map((p) => [p.name.getText(), p.initializer]));
        const why = props.get("why");
        const allowed = props.get("allowed");
        if (why && ts.isStringLiteral(why) && /translated/.test(why.text) && allowed && ts.isArrayLiteralExpression(allowed))
          for (const e of allowed.elements) if (ts.isStringLiteral(e)) add(e.text.trim(), node.name.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return [...keys].map(([hu, k]) => ({ hu, files: [...k.files].sort(), sheetName: k.sheetName })).sort((a, b) => a.hu.localeCompare(b.hu, "hu"));
}

/** The same multiset of names: a place lost would show no data, a place added would show a brace. */
function sameMultiset(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000");
}

export function buildDictionary(keys: CodeKey[], rows: SheetRow[]): ImportResult {
  const errors: string[] = [];
  const empty: string[] = [];
  const unmatched: string[] = [];
  const positional: string[] = [];
  const entries: Record<string, string> = {};

  // one Hungarian text, two different Englishes (in one sheet or across the two): a person must choose, the import does not
  const byHu = new Map<string, SheetRow[]>();
  for (const r of rows) byHu.set(r.hu, [...(byHu.get(r.hu) ?? []), r]);
  const conflicted = new Set<string>();
  for (const [hu, rs] of byHu) {
    const filled = rs.filter((r) => r.en);
    if (new Set(filled.map((r) => r.en)).size > 1) conflicted.add(hu);
    if (conflicted.has(hu))
      errors.push(`duplikált kulcs, eltérő angollal: "${hu}" (${filled.map((r) => `${where(r)}: "${r.en}"`).join("; ")})`);
  }
  const byNormal = new Map<string, SheetRow[]>();
  for (const r of rows) byNormal.set(normal(r.hu), [...(byNormal.get(normal(r.hu)) ?? []), r]);
  const byBare = new Map<string, SheetRow[]>();
  for (const r of rows) if (bare(r.hu) !== r.hu.trim()) byBare.set(normal(bare(r.hu)), [...(byBare.get(normal(bare(r.hu))) ?? []), r]);

  const used = new Set<SheetRow>();
  for (const key of keys) {
    const exact = byHu.get(key.hu);
    const loose = exact ? undefined : byNormal.get(normal(key.hu));
    const marked = exact || loose ? undefined : byBare.get(normal(key.hu));
    const candidates = exact ?? loose ?? marked ?? [];
    if (candidates.length === 0) {
      unmatched.push(key.hu);
      continue;
    }
    candidates.forEach((r) => used.add(r));
    // already an error above: neither English is taken
    if (candidates.some((r) => conflicted.has(r.hu))) continue;
    const filled = candidates.filter((r) => r.en);
    if (filled.length === 0) {
      empty.push(key.hu);
      continue;
    }
    if (!exact && new Set(filled.map((r) => r.en)).size > 1) {
      errors.push(`több sor illik ugyanarra a kulcsra, eltérő angollal: "${key.hu}" (${filled.map(where).join(", ")})`);
      continue;
    }
    const row = filled[0]!;
    const english = marked ? bare(row.en) : row.en;
    const rowPlaces = placesInOrder(row.hu);
    const enPlaces = placesInOrder(english);
    if (!sameMultiset(rowPlaces, enPlaces)) {
      errors.push(
        `helyőrző-eltérés: "${row.hu}" (${where(row)}): a magyarban {${rowPlaces.join("}, {")}}, az angolban {${enPlaces.join("}, {")}}`.replace(/\{\}/g, "nincs"),
      );
      continue;
    }
    const keyPlaces = placesInOrder(key.hu);
    if (keyPlaces.length !== rowPlaces.length) {
      errors.push(`a sor és a kód helyőrzői nem párosíthatók: "${row.hu}" (${where(row)}) és a kódban "${key.hu}"`);
      continue;
    }
    // the sheet's names to the code's, by their order in the Hungarian (the sheet may say {saved} where the code says {n})
    const rename = new Map<string, string>();
    let shared = false;
    rowPlaces.forEach((name, i) => {
      const to = keyPlaces[i]!;
      if (rename.has(name) && rename.get(name) !== to) shared = true;
      else rename.set(name, to);
    });
    let en: string;
    if (!shared) en = english.replace(PLACE, (_, name: string) => `{${rename.get(name) ?? name}}`);
    else if (rowPlaces.join("\u0000") === enPlaces.join("\u0000")) {
      // one sheet name for two of the code's places ("Kiürítés, {name}, {name}" for "{pool}, {param}"; Lili's first sheet): renamed by
      // name, every one became the last; by position it is right if the English keeps the Hungarian's order, which the report names
      let i = 0;
      en = english.replace(PLACE, () => `{${keyPlaces[i++]!}}`);
      positional.push(`${where(row)}: "${key.hu}"`);
    } else {
      errors.push(`a tábla egy helyőrző-neve a kód több helyét jelöli, és az angol más sorrendben használja: "${row.hu}" (${where(row)}); kézzel kell eldönteni`);
      continue;
    }
    if (key.sheetName && (en.length > SHEET_NAME_MAX || SHEET_NAME_BAD.test(en)))
      errors.push(`Excel-lapnév nem lehet: "${en}" ("${key.hu}", ${where(row)}): legfeljebb ${SHEET_NAME_MAX} karakter, és nem lehet benne : \\ / ? * [ ]`);
    else entries[key.hu] = en;
  }
  const unused = rows.filter((r) => r.en && !used.has(r)).map((r) => `${where(r)}: "${r.hu}"`);
  return { entries, errors, empty, unmatched, unused, positional };
}

/**
 * Proposals (scripts/i18n/proposals.ts): my English for keys the sheets have no English for, UNDER the sheets (barracuda on #259). One
 * is written only where no sheet row gave an English; a key a sheet row has filled since is reported as replaced, so its line can go,
 * and one whose key the code no longer uses as stale. Neither is written.
 */
export function applyProposals(
  entries: Record<string, string>,
  proposals: Readonly<Record<string, { en: string }>>,
  keys: CodeKey[],
): { entries: Record<string, string>; applied: string[]; replaced: string[]; stale: string[] } {
  const known = new Set(keys.map((k) => k.hu));
  const out = { ...entries };
  const applied: string[] = [];
  const replaced: string[] = [];
  const stale: string[] = [];
  for (const [hu, { en }] of Object.entries(proposals)) {
    if (!known.has(hu)) stale.push(hu);
    else if (hu in entries) replaced.push(hu);
    else {
      out[hu] = en;
      applied.push(hu);
    }
  }
  return { entries: out, applied, replaced, stale };
}

/**
 * The decisions given apart from the sheets (scripts/i18n/overrides.ts) over the sheets' entries. One whose key the code no longer uses is
 * returned as stale and not written: a dictionary line for no key would only hide that the decision has lost its place.
 */
export function applyOverrides(
  entries: Record<string, string>,
  overrides: Readonly<Record<string, { en: string }>>,
  keys: CodeKey[],
): { entries: Record<string, string>; applied: string[]; stale: string[] } {
  const known = new Set(keys.map((k) => k.hu));
  const out = { ...entries };
  const applied: string[] = [];
  const stale: string[] = [];
  for (const [hu, { en }] of Object.entries(overrides)) {
    if (!known.has(hu)) {
      stale.push(hu);
      continue;
    }
    out[hu] = en;
    applied.push(hu);
  }
  return { entries: out, applied, stale };
}

/** en.ts: the entries of the sheets over the ones already there (the language switch's own words stay), sorted, one per line. */
export function renderEnTs(entries: Record<string, string>, keep: Record<string, string>): string {
  const all = { ...keep, ...entries };
  const lines = Object.keys(all)
    .sort((a, b) => a.localeCompare(b, "hu"))
    .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(all[k])},`);
  return [
    "// The English of the screens, keyed by the Hungarian text (lib/i18n/translate.ts). GENERATED by scripts/i18n/import.ts from Lili's",
    "// filled-in sheets: change a translation in the sheet and run the import again, not here. A text with no English shows in Hungarian.",
    "export const EN: Readonly<Record<string, string>> = {",
    ...lines,
    "};",
    "",
  ].join("\n");
}

/** The source files of the code keys (src/**\/*.ts, *.tsx). */
export function readSources(paths: string[]): { path: string; src: string }[] {
  return paths.map((path) => ({ path, src: readFileSync(path, "utf8") }));
}
