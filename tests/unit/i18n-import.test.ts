// THE IMPORT OF LILI'S SHEETS (card 01dcddeb, task t-20261117-caparium-forditas-import), on a made-up sheet the test writes itself. WHAT TURNS
// THIS RED: a {place} that differs between the Hungarian and the English passing unnamed; an empty English counted as translated; one text
// with two Englishes taken silently; a sheet name Excel refuses written into en.ts; the sheet's place names kept where the code has others.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { afterAll, describe, expect, it } from "vitest";
import { buildDictionary, codeKeys, readSheet, renderEnTs, type CodeKey } from "../../scripts/i18n/core";

const dir = mkdtempSync(join(tmpdir(), "i18n-import-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function sheetFile(name: string, rows: [string, string][]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Feliratok");
  ws.columns = [{ header: "Modul" }, { header: "Hol látszik" }, { header: "Magyar szöveg" }, { header: "Angol" }, { header: "Megjegyzés" }];
  for (const [hu, en] of rows) ws.addRow(["Napi etetés", "felirat; x.tsx:1", hu, en, ""]);
  const path = join(dir, name);
  await wb.xlsx.writeFile(path);
  return path;
}

const key = (hu: string, sheetName = false): CodeKey => ({ hu, files: ["src/x.tsx"], sheetName });

describe("the import of the filled-in sheets", () => {
  it("reads both sheets, pairs the code's keys, renames the sheet's places to the code's, and names every fault with its sheet and row", async () => {
    const big = await readSheet(
      await sheetFile("nagy.xlsx", [
        ["Mentés", "Save"],
        ["{saved} sor mentve.", "{saved} rows saved."], // the code says {n}: renamed by position
        ["Ki eszik ma ({n} állat)", "Who eats today"], // the place is lost: an error
        ["Napi etetés", ""], // empty English: listed, stays Hungarian
        ["Hűtő", "Fridge"],
      ]),
      "nagy",
    );
    const supplement = await readSheet(
      await sheetFile("kieg.xlsx", [
        ["Hűtő", "Refrigerator"], // the same text, another English: an error naming both places
        ["Egyenleg", "Balance: stock, intake and withdrawal per month"], // a sheet name over 31 characters
        ["Bevételek", "Intake"],
      ]),
      "kiegészítő",
    );
    const r = buildDictionary(
      [key("Mentés"), key("{n} sor mentve."), key("Ki eszik ma ({n} állat)"), key("Napi etetés"), key("Hűtő"), key("Egyenleg", true), key("Bevételek", true), key("Új kulcs")],
      [...big, ...supplement],
    );
    expect(r.entries).toEqual({ Mentés: "Save", "{n} sor mentve.": "{n} rows saved.", Bevételek: "Intake" });
    expect(r.empty).toEqual(["Napi etetés"]);
    expect(r.unmatched).toEqual(["Új kulcs"]);
    expect(r.errors).toHaveLength(3);
    expect(r.errors.find((e) => e.startsWith("helyőrző-eltérés"))).toContain("nagy:4");
    expect(r.errors.find((e) => e.startsWith("duplikált kulcs"))).toMatch(/nagy:6.*kiegészítő:2|kiegészítő:2.*nagy:6/);
    expect(r.errors.find((e) => e.startsWith("Excel-lapnév"))).toContain("Egyenleg");
  });

  it("a place renamed in the English (same count, other name) is an error too, not a silent brace on the screen", () => {
    const r = buildDictionary([key("{n} sor mentve.")], [{ sheet: "nagy", row: 7, hu: "{n} sor mentve.", en: "{count} rows saved." }]);
    expect(r.entries).toEqual({});
    expect(r.errors[0]).toContain("nagy:7");
  });

  it("a sheet-name key with a character Excel refuses is an error", () => {
    const r = buildDictionary([key("Egyenleg", true)], [{ sheet: "nagy", row: 2, hu: "Egyenleg", en: "Balance [stock]" }]);
    expect(r.errors[0]).toMatch(/^Excel-lapnév/);
  });

  it("the code's keys: tr() and translate() texts, both sides of a conditional, a sheet name, and the guard's data tables", () => {
    const keys = codeKeys(
      [
        {
          path: "src/a.tsx",
          src: 'const a = tr("Mentés"); const b = translate(lang, ok ? "Igen" : "Nem"); const s = sheet(wb, tr("Bevételek"), [1]); const w = wb.addWorksheet(tr("Egyenleg"));',
        },
      ],
      'const TRANSLATED = { "src/b.ts": { allowed: ["hűtő"], why: "translated where shown" }, "src/c.tsx": { allowed: ["Zebracápa"], why: "the figure\'s name" } };',
    );
    expect(keys.map((k) => k.hu)).toEqual(["Bevételek", "Egyenleg", "hűtő", "Igen", "Mentés", "Nem"]);
    expect(keys.filter((k) => k.sheetName).map((k) => k.hu)).toEqual(["Bevételek", "Egyenleg"]);
  });

  it("en.ts keeps the entries already there, the sheets' win, one sorted line each", () => {
    const out = renderEnTs({ Mentés: "Save", Nyelv: "Language (new)" }, { Nyelv: "Language", "Angol nyelv": "English" });
    expect(out).toContain('  "Angol nyelv": "English",\n  "Mentés": "Save",\n  "Nyelv": "Language (new)",');
    expect(out).toContain("export const EN: Readonly<Record<string, string>> = {");
  });
});
