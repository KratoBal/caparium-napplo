// EVERY TABLE IN ITS SCROLLING BOX (the three bug rounds of 2026-11-19: at 390 px a table outside its box widened the whole page,
// here on Takarmányok, Adagolás and Állatok, #274; the same shape stood in seven more places). This reads every .tsx under src
// through the TypeScript AST and asks of each <table> whether an ancestor in the same file carries the `table-scroll` class.
// WHAT TURNS IT RED: a new table, or one moved, without its box. The narrow-screen test pins three of them by shape; this one
// covers all, so a table added tomorrow is caught too. A table that must not scroll would need its own decision here.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const tsxUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? tsxUnder(p) : name.endsWith(".tsx") ? [p] : [];
  });

const tagOf = (n: ts.Node): string | null =>
  ts.isJsxElement(n) ? n.openingElement.tagName.getText() : ts.isJsxSelfClosingElement(n) ? n.tagName.getText() : null;
const classOf = (n: ts.Node): string => {
  const attrs = ts.isJsxElement(n) ? n.openingElement.attributes : ts.isJsxSelfClosingElement(n) ? n.attributes : null;
  const a = attrs?.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === "className");
  return a?.initializer ? a.initializer.getText() : "";
};

/** "file:line" of every <table> with no `table-scroll` ancestor in its own file, and the number of tables seen */
function unboxedTables(): { unboxed: string[]; total: number } {
  const unboxed: string[] = [];
  let total = 0;
  for (const file of tsxUnder(join(root, "src"))) {
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (n: ts.Node) => {
      if (tagOf(n) === "table") {
        total += 1;
        let boxed = false;
        for (let p = n.parent; p && !boxed; p = p.parent) boxed = tagOf(p) !== null && /\btable-scroll\b/.test(classOf(p));
        if (!boxed) unboxed.push(`${relative(root, file)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { unboxed, total };
}

describe("every table sits in its scrolling box", () => {
  it("no <table> in src without a table-scroll ancestor", () => {
    const { unboxed, total } = unboxedTables();
    expect(total).toBeGreaterThan(30);
    expect(unboxed).toEqual([]);
  });
});
