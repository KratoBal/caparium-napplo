// THE DATA PLACES OF A TEXT AND THE DATA GIVEN FOR THEM AGREE (t-20261117-caparium-angol-adagolas; the dosing and the feed-calculator
// modules). A tr("... {n} ...", { n }) whose {name} and whose object keys differ would show a brace in the screen, or drop the data:
// translate() fills only the names the vars carry (lib/i18n/translate.ts), and leaves the rest as typed. The English text keeps the same
// places (tests/unit/i18n.test.ts), so the Hungarian key is the place to check: for every tr() or translate() call with a string literal
// as its first argument, the {names} in the text are exactly the keys of the object given as the second argument (none, when there is none).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { placeholdersOf } from "../../src/lib/i18n/translate";

const FILES = [
  "src/app/adagolas/page.tsx",
  "src/components/DosingForms.tsx",
  "src/components/ChemistryCalculator.tsx",
  "src/lib/chemistry-calc.ts",
  "src/lib/exports/dosing-pdf.ts",
  "src/app/kalkulator/page.tsx",
  "src/components/CalculatorForms.tsx",
  "src/app/api/exports/dosing/route.ts",
  // Fagyasztó
  "src/app/takarmanyhuto/page.tsx",
  "src/components/IntakeForms.tsx",
  "src/lib/exports/intake-pdf.ts",
  "src/lib/exports/intake-excel.ts",
  "src/lib/exports/intake-report-text.ts",
];

type Call = { text: string; keys: string[]; line: number };

function callsOf(file: string): Call[] {
  const src = readFileSync(join(process.cwd(), file), "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Call[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ["tr", "translate"].includes(node.expression.getText())) {
      // translate(lang, text, vars) takes the text second; tr(text, vars) first
      const textIndex = node.expression.getText() === "translate" ? 1 : 0;
      const text = node.arguments[textIndex];
      const vars = node.arguments[textIndex + 1];
      if (text && (ts.isStringLiteral(text) || ts.isNoSubstitutionTemplateLiteral(text))) {
        const keys = vars && ts.isObjectLiteralExpression(vars)
          ? vars.properties.map((p) => (ts.isShorthandPropertyAssignment(p) || ts.isPropertyAssignment(p) ? p.name.getText() : "?"))
          : vars
            ? ["?"] // vars given as a variable: its keys cannot be read here, so the call is not judged
            : [];
        out.push({ text: text.text, keys: keys.sort(), line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("a tr() text names exactly the data it is given", () => {
  for (const file of FILES) {
    it(file, () => {
      const calls = callsOf(file);
      expect(calls.length).toBeGreaterThan(0);
      const wrong = calls
        .filter((c) => !c.keys.includes("?"))
        .filter((c) => JSON.stringify(placeholdersOf(c.text)) !== JSON.stringify(c.keys))
        .map((c) => `${file}:${c.line} "${c.text}" names ${JSON.stringify(placeholdersOf(c.text))} but is given ${JSON.stringify(c.keys)}`);
      expect(wrong).toEqual([]);
    });
  }
});
