// Lili 2026-11-01 12:24 UTC (acrobot 39592): the greeter changes every day among the six greeting pictures; until now a water
// user was greeted by Antennarius every day. WHAT TURNS THIS RED: the greeter read from anything but the day (the page's
// figure, a random draw), two days in a row bringing the same figure, one of the six never coming, or a picture that is not
// in public/segito.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GREETERS, GREETING_PICTURES, greetingFigure } from "@/lib/helper-notice";
import { addDays } from "@/lib/time";

const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

describe("greetingFigure: the day's greeter", () => {
  it("two days in a row never bring the same figure, across the DST change and a year end", () => {
    for (const start of ["2026-10-20", "2026-12-25", "2027-03-25"]) {
      const seen = days(start, 14).map(greetingFigure);
      for (let i = 1; i < seen.length; i++) expect(seen[i].slug, `${addDays(start, i - 1)} -> ${addDays(start, i)}`).not.toBe(seen[i - 1].slug);
    }
  });

  it("any six days in a row bring all six greeting pictures, once each", () => {
    for (const start of ["2026-11-01", "2026-11-04", "2027-02-27"]) {
      const six = days(start, GREETERS.length * GREETING_PICTURES).map((d) => {
        const g = greetingFigure(d);
        return `${g.slug}-udv-${g.picture}`;
      });
      expect(new Set(six).size).toBe(6);
    }
  });

  it("the same day gives the same greeter, and Lili's two days differ", () => {
    expect(greetingFigure("2026-11-01")).toEqual(greetingFigure("2026-11-01"));
    expect(greetingFigure("2026-11-02").slug).not.toBe(greetingFigure("2026-11-01").slug);
  });

  it("every greeter's picture is one of Lili's files", () => {
    for (const d of days("2026-11-01", 6)) {
      const g = greetingFigure(d);
      expect(existsSync(join(__dirname, "..", "..", "public", "segito", `${g.slug}-udv-${g.picture}.webp`)), `${g.slug}-udv-${g.picture}`).toBe(true);
    }
  });
});
