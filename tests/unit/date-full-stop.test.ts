// A DAY SHOWN IN A SENTENCE HAS ONE FULL STOP, NOT TWO (found 2026-11-23 on Lili's guide pictures: "utoljára mérve 12,4 kg, 2026.11.23..").
// formatDay and formatPeriod end with a full stop ("2026.11.23."), so a text that puts such a value in front of its own full stop
// ("{value}.") ends in two. The date's stop is dropped where the value goes into the text (.replace(/\.$/, "")); this test finds the places that
// do not: for every tr("... {name}. ...", { name: <value> }) in src whose value is made with formatDay or formatPeriod and does not drop the stop.
// A value passed as a variable or a shorthand is not judged (its source is not here), so the scan is a floor, not a proof; the controls below
// show the rule fires on the wrong shape and keeps quiet on the right one.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type Verdict = { judged: number; wrong: string[] };

export function doubleStops(file: string, src: string): Verdict {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Verdict = { judged: 0, wrong: [] };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText() === "tr") {
      const text = node.arguments[0];
      const vars = node.arguments[1];
      if (text && (ts.isStringLiteral(text) || ts.isNoSubstitutionTemplateLiteral(text)) && vars && ts.isObjectLiteralExpression(vars)) {
        for (const m of text.text.matchAll(/\{(\w+)\}\./g)) {
          const prop = vars.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText() === m[1]);
          if (!prop || !ts.isPropertyAssignment(prop)) continue;
          out.judged += 1;
          const value = prop.initializer.getText();
          if (/formatDay|formatPeriod/.test(value) && !/replace\(\/\\\.\$\//.test(value))
            out.wrong.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1} "${text.text.slice(0, 60)}" puts ${m[1]} (${value.slice(0, 50)}) before its own full stop`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "i18n" ? [] : sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

describe("a day in a sentence has one full stop", () => {
  it("control: the wrong shape is found, the right shape and an unrelated text are not", () => {
    expect(doubleStops("a.tsx", 'tr("Ennyi: {d}.", { d: formatDay(x) })').wrong).toHaveLength(1);
    expect(doubleStops("a.tsx", 'tr("Ennyi: {d}.", { d: days.map(formatDay).join(", ") })').wrong).toHaveLength(1);
    expect(doubleStops("a.tsx", 'tr("Ennyi: {d}.", { d: formatDay(x).replace(/\\.$/, "") })').wrong).toEqual([]);
    expect(doubleStops("a.tsx", 'tr("Ennyi: {d} napon.", { d: formatDay(x) })').wrong).toEqual([]);
    expect(doubleStops("a.tsx", 'tr("Ennyi: {n}.", { n: count })').wrong).toEqual([]);
    expect(doubleStops("a.tsx", 'tr("Ennyi: {d}.", { d: formatDay(x).replace(/\\.$/, "") })').judged).toBe(1);
  });

  it("src: no text puts a formatDay or formatPeriod value before its own full stop", () => {
    const all = sourceFiles(join(process.cwd(), "src")).map((f) => doubleStops(f.slice(process.cwd().length + 1), readFileSync(f, "utf8")));
    // the scan looked at something: the templates with a placeholder before a full stop, today a couple of dozen
    expect(all.reduce((n, v) => n + v.judged, 0)).toBeGreaterThan(15);
    expect(all.flatMap((v) => v.wrong)).toEqual([]);
  });
});
