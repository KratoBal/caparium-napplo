// THE GUARD AGAINST A HUNGARIAN TEXT LEFT OUT (t-20261117-caparium-angol-alap, plan: exchange/caparium/angol-forditas-terv-2026-11-17.md).
// A translated file must not hold Hungarian text outside tr(): every JSX text and every string literal that reads as Hungarian
// is the first argument of tr() or translate(), or it is on the file's list below with the reason why (a data table that is
// translated where it is shown, a proper name). A file joins TRANSLATED when its module is done; then a new text that skips
// tr() turns this red, and the English view cannot be left with a Hungarian label nobody saw.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const TRANSLATED: Record<string, { allowed: string[]; why: string }> = {
  "src/app/etetes/page.tsx": { allowed: [], why: "" },
  "src/app/etetes/rend/page.tsx": { allowed: [], why: "" },
  "src/app/evesi-naplo/page.tsx": { allowed: [], why: "" },
  "src/app/kivetel/page.tsx": { allowed: [], why: "" },
  "src/app/takarmany-naplo/page.tsx": { allowed: [], why: "" },
  "src/components/FeedingForms.tsx": {
    allowed: ["Merüléses etetés (M)", "Felszíni etetés (F)", "Koplalónap (K)", "tömeg", "térfogat", "Van még nem mentett sor az evési naplóban. Ha most továbblépsz, elveszik. Továbblépsz mentés nélkül?"],
    why: "the feeding modes, the dimensions and the leave warning, translated where shown (tr(FEEDING_MODE_LABEL[m]), tr(DIM[d]), tr(EATING_LEAVE_WARNING))",
  },
  "src/components/FeedingDay.tsx": { allowed: [], why: "" },
  "src/components/FeedingSheet.tsx": {
    allowed: ["Van még nem mentett érték a takarmánylapon. Ha most továbblépsz, elveszik. Továbblépsz mentés nélkül?"],
    why: "the leave warning, translated where used (tr(LEAVE_WARNING))",
  },
  "src/components/FeedingLists.tsx": { allowed: [], why: "" },
  "src/components/DayRestore.tsx": {
    allowed: ["kijelölés le", "kijelölés vissza", "tétel le", "tétel vissza", "evési állapot le", "evési állapot vissza"],
    why: "the operation kinds, translated where shown (tr(KIND[k]))",
  },
  "src/lib/sheet-drafts.ts": { allowed: [], why: "" },
  "src/components/Timetable.tsx": { allowed: [], why: "" },
  "src/components/DayNav.tsx": { allowed: [], why: "" },
  "src/components/PrintButton.tsx": { allowed: [], why: "" },
  "src/components/InactiveListFilter.tsx": { allowed: [], why: "" },
  "src/lib/eating-labels.ts": { allowed: ["evett", "nem evett meg mindent", "nem evett", "koplalónap"], why: "the eating states, translated where shown (tr(EAT_LABEL[state]))" },
  "src/lib/eating-drafts.ts": {
    allowed: [" A frissebb állapot betöltve; a be nem mentett sorokban a beírt érték megmaradt, újra mentve azt írja be."],
    why: "translated where shown (EatingTable: tr(note.trim()))",
  },
  "src/lib/stock-hint.ts": { allowed: [], why: "" },
  "src/components/MeasurementPage.tsx": {
    allowed: ["Kis Akváriumok", "Fagyasztók hőmérséklete"],
    why: "the tiles' captions, translated where shown (tr(look.label), tr(FRIDGE_TILE.label))",
  },
  "src/components/MeasurementGrid.tsx": {
    allowed: ["Visszamosás", "Rátöltés", "Vízcsere", "Van még nem mentett mérési érték. Ha most továbblépsz, elveszik. Továbblépsz mentés nélkül?"],
    why: "the tick names and the leave warning, translated where shown (tr(TICK_TEXT[kind]), tr(LEAVE_WARNING))",
  },
  "src/components/FridgeCard.tsx": { allowed: ["hűtő", "fagyasztó"], why: "the kind names, translated where shown (tr(KIND[kind]))" },
  "src/components/DayControls.tsx": { allowed: [], why: "" },
  "src/components/ReasonSwitch.tsx": { allowed: [], why: "" },
  "src/components/ClearX.tsx": { allowed: [], why: "" },
  "src/components/SignButton.tsx": { allowed: [], why: "" },
  "src/lib/fridge-alert.ts": { allowed: [], why: "" },
  "src/app/vizmeres/page.tsx": { allowed: ["Napi vízmérések"], why: "the title, translated where shown (MeasurementPage: tr(title))" },
  "src/app/heti/page.tsx": { allowed: ["Heti vízmérések"], why: "the title, translated where shown (MeasurementPage: tr(title))" },
  "src/components/ShellView.tsx": { allowed: ["CÁPÁRIUM", "nAPPló"], why: "the app's name" },
  "src/components/TopbarUser.tsx": { allowed: [], why: "" },
  "src/components/NavSub.tsx": { allowed: [], why: "" },
  "src/components/LangSwitch.tsx": { allowed: ["Magyar nyelv", "Angol nyelv"], why: "passed to tr() through a conditional" },
  "src/app/belepes/page.tsx": {
    allowed: [
      "Sikertelen belépés. Ellenőrizd a felhasználónevet és a jelszót; sok hibás próba után a fiók 15 percig nem léptethető be.",
      "Erről a címről túl sok sikertelen belépés érkezett. Próbáld újra 15 perc múlva.",
      "A belépési kérés nem ebből az alkalmazásból jött. Töltsd újra az oldalt.",
      "Cápárium nAPPló",
    ],
    why: "the error table is translated where it is shown (tr(ERRORS[hiba])); the app's name",
  },
  "src/app/page.tsx": {
    allowed: ["NAPI VÍZMÉRÉS", "Nagy medencék", "Kis Akváriumok", "HETI VÍZMÉRÉS", "Vegyszeradagolás", "Fagyasztó", "Takarmány kalkulátor", "Takarmánykivétel", "Napi etetés", "Evési napló"],
    why: "the cards' captions, a data table translated where it is shown (tr(line))",
  },
  // murena: Vegyszeradagolás, Takarmánykalkulátor
  "src/app/adagolas/page.tsx": { allowed: [], why: "" },
  "src/components/DosingForms.tsx": { allowed: [], why: "" },
  "src/components/ChemistryCalculator.tsx": { allowed: [], why: "" },
  "src/lib/chemistry-calc.ts": { allowed: [], why: "" },
  "src/lib/exports/dosing-pdf.ts": { allowed: [], why: "" },
  "src/app/kalkulator/page.tsx": { allowed: [], why: "" },
  "src/components/CalculatorForms.tsx": { allowed: [], why: "" },
  "src/app/api/exports/dosing/route.ts": { allowed: [], why: "" },
  // murena: Fagyasztó
  "src/app/takarmanyhuto/page.tsx": { allowed: [], why: "" },
  "src/components/IntakeForms.tsx": { allowed: [], why: "" },
  "src/lib/exports/intake-pdf.ts": { allowed: ["Cápárium nAPPló"], why: "the app's name (the PDF's author)" },
  "src/lib/exports/intake-excel.ts": { allowed: [], why: "" },
  "src/lib/exports/intake-report-text.ts": { allowed: [], why: "" },
  "src/lib/exports/intake-report.ts": { allowed: ["Az időszak vége nem lehet a kezdete előtt."], why: "a defensive check, not a shown text: the only caller (the feeding export route) rejects from > to first (route.ts), and returns an AppError message raw, not through errorResponse" },
};

const ACCENT = /[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/;
// Hungarian words without an accent that the screens use: a text holding one is Hungarian too
// (murena, 2026-11-17: "Szer", "mind", "Napig" slipped through; the list grows as the modules come in)
const WORDS = new Set(["sor", "mentve", "evett", "mindenki", "nap", "napi", "heti", "medence", "csoport", "igen", "nem", "vissza", "rendben", "hiba", "nincs", "van", "kell", "csak", "egy", "lista", "kilepes", "szer", "mind", "napig", "korallos", "halas", "adag", "napra", "napon", "minden", "egyik", "kesz", "uj", "mentes", "mentese"]);
// a path, a link or an identifier ("/heti", "{x}?csoport={x}&nap={x}", "napplo-queue-v1-{x}") is code, not a text a person
// reads. A bare lowercase word is NOT code (murena, 2026-11-17: "igen" passed as one): it needs a character only code has.
const codeLike = (text: string) => /^[`/]/.test(text.trim()) || /^(?=.*[_.:=?&{}/0-9-])[a-z0-9_.:=?&{}/-]+$/.test(text.trim());
const hungarian = (text: string) => !codeLike(text) && (ACCENT.test(text) || text.toLowerCase().split(/[^a-z]+/).some((w) => WORDS.has(w)));

// a value under one of these names is an identifier, a path or a test hook, never a text a person reads ({ id: "heti" },
// name="nap"): a bare lowercase word there is code since a bare word counts as Hungarian
const CODE_NAMES = new Set(["id", "key", "href", "module", "kind", "code", "name", "type", "value", "role", "method", "action", "inputMode", "autoComplete", "className", "data-testid"]);
function codeSlot(node: ts.Node): boolean {
  const p = node.parent;
  if (p && ts.isPropertyAssignment(p) && p.initializer === node) return CODE_NAMES.has(p.name.getText().replace(/["']/g, ""));
  if (p && ts.isJsxAttribute(p)) return CODE_NAMES.has(p.name.getText());
  return false;
}

function inTr(node: ts.Node): boolean {
  // the text's nearest call takes it as its first argument, and that call is tr() or translate()
  for (let n: ts.Node = node, p = node.parent; p; n = p, p = p.parent) {
    if (ts.isCallExpression(p)) {
      const callee = p.expression.getText();
      return (callee === "tr" || callee === "translate") && (p.arguments[0] === n || p.arguments[1] === n);
    }
    if (ts.isJsxElement(p) || ts.isJsxSelfClosingElement(p) || ts.isBlock(p) || ts.isSourceFile(p)) return false;
  }
  return false;
}

/** A template's literal parts, its ${...} places as {x}: what a person reads of it. */
function templateText(node: ts.TemplateExpression): string {
  return node.head.text + node.templateSpans.map((s) => "{x}" + s.literal.text).join("");
}

/** The Hungarian texts of a source outside tr() (the source passed in, so the rule itself is testable). */
function scan(file: string, src: string): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isJsxText(node)) {
      const t = node.text.replace(/\s+/g, " ").trim();
      if (t && hungarian(t)) out.push(t);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const p = node.parent;
      const isKey = p && ts.isPropertyAssignment(p) && p.name === node;
      if (!isKey && !(codeSlot(node) && /^[a-z0-9_.:-]+$/.test(node.text)) && hungarian(node.text) && !inTr(node)) out.push(node.text);
    } else if (ts.isTemplateExpression(node) && /[/?=&]/.test(templateText(node)) && codeLike(templateText(node))) {
      // a path or a link built from parts (`/${weekly ? "heti" : "vizmeres"}?nap=${day}`): its parts are code too. Only with
      // a path or query character: `${name}${alert ? ", figyelmeztetés" : ""}` reads "{x}{x}", and its parts are text
      return;
    } else if (ts.isTemplateExpression(node) && hungarian(templateText(node)) && !inTr(node)) {
      // the template's own text, not its source: the source starts with a backtick, and that read as code, so no template was ever
      // checked (murena, 2026-11-17)
      out.push(templateText(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function leftOut(file: string): string[] {
  const src = readFileSync(join(process.cwd(), file), "utf8");
  return scan(file, src).filter((t) => !TRANSLATED[file]!.allowed.includes(t));
}

describe("the guard's own rule", () => {
  it("counts a bare Hungarian word, accented or not, and a template's text", () => {
    expect(["igen", "nap", "Mentés", "{x} sor mentve.", "Napi mérés: {x}"].filter((t) => !hungarian(t))).toEqual([]);
  });
  it("reads into a template made only of places, and not into a path built from parts", () => {
    expect(scan("x.tsx", 'const a = <b aria-label={`${n}${on ? ", figyelmeztetés" : ""}`} />;')).toEqual([", figyelmeztetés"]);
    expect(scan("x.tsx", 'const h = `/${weekly ? "heti" : "vizmeres"}?nap=${day}`;')).toEqual([]);
  });
  it("leaves code alone: a path, a link with a query, an identifier", () => {
    expect(["/heti", "{x}?csoport={x}&nap={x}", "{x}?nap={x}", "napplo-queue-v1-{x}", "nap=2026-11-17", "save-all", "hu-HU"].filter(hungarian)).toEqual([]);
  });
});

describe("the translated files hold no Hungarian text outside tr()", () => {
  for (const file of Object.keys(TRANSLATED)) {
    it(file, () => {
      expect(leftOut(file)).toEqual([]);
    });
  }
});
