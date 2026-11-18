// THE IMPORT OF LILI'S SHEETS (card 01dcddeb, task t-20261117-caparium-forditas-import), on a made-up sheet the test writes itself. WHAT TURNS
// THIS RED: a {place} that differs between the Hungarian and the English passing unnamed; an empty English counted as translated; one text
// with two Englishes taken silently; a sheet name Excel refuses written into en.ts; the sheet's place names kept where the code has others.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { afterAll, describe, expect, it } from "vitest";
import { applyOverrides, applyProposals, buildDictionary, codeKeys, readSheet, renderEnTs, type CodeKey } from "../../scripts/i18n/core";
import { OVERRIDES } from "../../scripts/i18n/overrides";
import { PROPOSAL_FILES, PROPOSALS } from "../../scripts/i18n/proposals";

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

  // Lili's first sheet (t-20261118-caparium-angol-1): the sheet's extractor gave one generic name to two different places of the code
  // ("Kiürítés, {name}, {name}" for "Kiürítés, {pool}, {param}"). Renamed by name, both became the last one, silently.
  it("a sheet name standing for two of the code's places is renamed by position when the English keeps the Hungarian's order", () => {
    const r = buildDictionary(
      [key("Kiürítés, {pool}, {param}"), key("Ajánlott: {perDay} g (+{raise} {unit}), legfeljebb {max} {unit}")],
      [
        { sheet: "nagy", row: 215, hu: "Kiürítés, {name}, {name}", en: "Clear, {name}, {name}" },
        { sheet: "nagy", row: 677, hu: "Ajánlott: {format} g (+{format} {unit}), legfeljebb {format} {unit}", en: "Recommended: {format} g (+{format} {unit}), at most {format} {unit}" },
      ],
    );
    expect(r.errors).toEqual([]);
    // named in the report: the order is an assumption a person checks, not a fact the names prove
    expect(r.positional).toEqual(["nagy:215: \"Kiürítés, {pool}, {param}\"", "nagy:677: \"Ajánlott: {perDay} g (+{raise} {unit}), legfeljebb {max} {unit}\""]);
    expect(r.entries).toEqual({
      "Kiürítés, {pool}, {param}": "Clear, {pool}, {param}",
      "Ajánlott: {perDay} g (+{raise} {unit}), legfeljebb {max} {unit}": "Recommended: {perDay} g (+{raise} {unit}), at most {max} {unit}",
    });
  });

  it("a sheet name standing for two places, and an English that orders the places otherwise, is an error: nothing is guessed", () => {
    const r = buildDictionary(
      [key("{a} és {b}, {c} darab")],
      [{ sheet: "nagy", row: 9, hu: "{x} és {x}, {n} darab", en: "{n} pieces: {x} and {x}" }],
    );
    expect(r.entries).toEqual({});
    expect(r.errors[0]).toContain("nagy:9");
  });

  // Lili on the stage (acrobot 55602): the code keeps an arrow or a dash outside tr() ("‹ {tr("előző nap")}", "– {tr("válassz")} –"),
  // the sheet's row has them ("‹ előző nap"); the row matched no key, and the screen stayed Hungarian.
  it("a row with edge marks the code keeps outside tr() matches its bare key, and its English loses the same marks", () => {
    const r = buildDictionary(
      [key("előző nap"), key("következő nap"), key("válassz"), key("‹ vissza")],
      [
        { sheet: "nagy", row: 537, hu: "‹ előző nap", en: "‹ previous day" },
        { sheet: "nagy", row: 434, hu: "következő nap ›", en: "next day ›" },
        { sheet: "nagy", row: 536, hu: "– válassz –", en: "– select –" },
        { sheet: "nagy", row: 9, hu: "‹ vissza", en: "‹ back" },
      ],
    );
    expect(r.errors).toEqual([]);
    expect(r.entries).toEqual({ "előző nap": "previous day", "következő nap": "next day", "válassz": "select", "‹ vissza": "‹ back" });
    expect(r.unused).toEqual([]);
  });

  // Lili 2026-11-18 (acrobot 55615): the sheet says "Gy" -> "Gy", her later word says "Med". Without the override list the next import
  // writes "Gy" back.
  it("a decision given apart from the sheets wins over the sheet; one for a key the code no longer uses is stale, not written", () => {
    const o = applyOverrides({ Gy: "Gy", V: "V" }, { Gy: { en: "Med" }, régi: { en: "old" } }, [key("Gy"), key("V")]);
    expect(o.entries).toEqual({ Gy: "Med", V: "V" });
    expect(o.applied).toEqual(["Gy"]);
    expect(o.stale).toEqual(["régi"]);
  });

  // barracuda on #259: a proposal is my English until Lili gives her own, so it stands UNDER the sheet. Over it, her later row would
  // never reach en.ts, silently.
  it("a proposal fills only a key no sheet row gave an English; a sheet row wins over it, and the proposal is named as replaced", () => {
    const sheet = buildDictionary([key("A csoport nem található."), key("Nincs jogosultság.")], [
      { sheet: "kiegészítő", row: 4, hu: "Nincs jogosultság.", en: "Not allowed." },
    ]);
    const p = applyProposals(
      sheet.entries,
      { "A csoport nem található.": { en: "The group was not found." }, "Nincs jogosultság.": { en: "No permission." }, régi: { en: "old" } },
      [key("A csoport nem található."), key("Nincs jogosultság.")],
    );
    expect(p.entries).toEqual({ "A csoport nem található.": "The group was not found.", "Nincs jogosultság.": "Not allowed." });
    expect(p.applied).toEqual(["A csoport nem található."]);
    expect(p.replaced).toEqual(["Nincs jogosultság."]);
    expect(p.stale).toEqual(["régi"]);
  });

  // barracuda on #260: the files are spread together, so a key in two of them would let the last one win, silently
  it("a key stands in exactly one proposal file", () => {
    const where = new Map<string, string[]>();
    for (const [file, proposals] of Object.entries(PROPOSAL_FILES))
      for (const hu of Object.keys(proposals)) where.set(hu, [...(where.get(hu) ?? []), file]);
    expect([...where].filter(([, files]) => files.length > 1)).toEqual([]);
  });

  it("every proposal has its source, and no key is both a proposal and a decision", () => {
    for (const [hu, o] of Object.entries(PROPOSALS)) expect(o.source.length, hu).toBeGreaterThan(10);
    expect(Object.keys(PROPOSALS).filter((hu) => hu in OVERRIDES)).toEqual([]);
  });

  it("every override has its source", () => {
    for (const [hu, o] of Object.entries(OVERRIDES)) expect(o.source.length, hu).toBeGreaterThan(10);
  });

  // the server's messages the response translates (lib/api.ts errorResponse: tr(e.message), tr(issue.message)); they were no keys, so
  // the sheet's English for them never reached en.ts (t-20261118-caparium-angol-szerver)
  it("the server's messages are keys: an AppError's, requireReason's, a zod check's; a zod value and an empty text are not", () => {
    const src = `
      throw new AppError(404, "NOT_FOUND", "A csoport nem található.");
      throw new AppError(422, "X", ok ? "Első ág." : "Második ág.");
      await requireReason(tx, true, input.reason, "A javításhoz indoklás kell.");
      const s = z.object({ name: z.string().min(2, "A név legalább 2 karakter legyen."), kind: z.literal("WATER") });
      const t = z.string().refine((v) => v !== "", { message: "Válassz legalább egy napi vagy heti táblát." });
      throw new AppError(400, "Y", cond ? "" : "Nem üres.");
    `;
    expect(codeKeys([{ path: "src/lib/x.ts", src }]).map((k) => k.hu)).toEqual(
      ["A csoport nem található.", "A javításhoz indoklás kell.", "A név legalább 2 karakter legyen.", "Első ág.", "Második ág.", "Nem üres.", "Válassz legalább egy napi vagy heti táblát."],
    );
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
