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
};

const ACCENT = /[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/;
// Hungarian words without an accent that the screens use: a text holding one is Hungarian too
const WORDS = new Set(["sor", "mentve", "evett", "mindenki", "nap", "napi", "heti", "medence", "csoport", "igen", "nem", "vissza", "rendben", "hiba", "nincs", "van", "kell", "csak", "egy", "lista", "kilepes"]);
// a path, a query or an identifier ("/heti", "heti", "nap=...") is code, not a text a person reads
const codeLike = (text: string) => /^[`/]/.test(text.trim()) || /^[a-z0-9_.:-]+$/.test(text.trim());
const hungarian = (text: string) => !codeLike(text) && (ACCENT.test(text) || text.toLowerCase().split(/[^a-z]+/).some((w) => WORDS.has(w)));

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

function leftOut(file: string): string[] {
  const src = readFileSync(join(process.cwd(), file), "utf8");
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
      if (!isKey && hungarian(node.text) && !inTr(node)) out.push(node.text);
    } else if (ts.isTemplateExpression(node) && hungarian(node.getText()) && !inTr(node)) {
      out.push(node.getText());
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out.filter((t) => !TRANSLATED[file]!.allowed.includes(t));
}

describe("the translated files hold no Hungarian text outside tr()", () => {
  for (const file of Object.keys(TRANSLATED)) {
    it(file, () => {
      expect(leftOut(file)).toEqual([]);
    });
  }
});
