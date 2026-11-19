import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// THE 390 PX SIDEWAYS SCROLL (bug round 2026-11-19, cap-hibakor-stage.mjs): two tables stood outside the scrolling box the
// other tables have (Takarmányok 107 px, Adagolás 48 px past a 390 px screen), and the animal order row did not wrap
// (Állatok, 223 px). jsdom lays nothing out, so this reads the source: each table sits in its `table-scroll` box, and the
// order row may wrap. The proof on the page is the round's 390 px overflow measurement.
const src = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");

describe("narrow screen: nothing widens the page", () => {
  it.each([
    ["the feed tables (Takarmányok)", "src/app/takarmanyok/page.tsx", /className="table-scroll">\s*<table[\s\S]{0,300}?data-testid=\{`feeds-/],
    ["the stock table (Adagolás)", "src/app/adagolas/page.tsx", /className="table-scroll">\s*<table className="log-table" data-testid="stock">/],
    ["the animal's events (Állatok)", "src/app/allatok/page.tsx", /className="table-scroll">\s*<table className="log-table">\s*<thead><tr><th>\{tr\("Időpont"\)\}/],
  ])("%s scroll in their own box", (_name, file, shape) => {
    expect(src(file)).toMatch(shape);
  });

  it("the animal order row may wrap", () => {
    const rule = src("src/app/globals.css").match(/\n\.order-row \{([^}]*)\}/);
    expect(rule?.[1]).toMatch(/flex-wrap:\s*wrap/);
  });
});
