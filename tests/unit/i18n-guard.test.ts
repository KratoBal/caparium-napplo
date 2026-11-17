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
      if (!isKey && !(codeSlot(node) && /^[a-z0-9_.:-]+$/.test(node.text)) && hungarian(node.text) && !inTr(node)) out.push(node.text);
    } else if (ts.isTemplateExpression(node) && codeLike(templateText(node))) {
      // a path built from parts (`/${weekly ? "heti" : "vizmeres"}?nap=${day}`): its parts are code too
      return;
    } else if (ts.isTemplateExpression(node) && hungarian(templateText(node)) && !inTr(node)) {
      // the template's own text, not its source: the source starts with a backtick, and that read as code, so no template was ever
      // checked (murena, 2026-11-17)
      out.push(templateText(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out.filter((t) => !TRANSLATED[file]!.allowed.includes(t));
}

describe("the guard's own rule", () => {
  it("counts a bare Hungarian word, accented or not, and a template's text", () => {
    expect(["igen", "nap", "Mentés", "{x} sor mentve.", "Napi mérés: {x}"].filter((t) => !hungarian(t))).toEqual([]);
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
