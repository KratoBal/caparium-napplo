// EGY-13 breakdown and EVE-08 week shading (pure).
import { describe, expect, it } from "vitest";
import { WEEK_FILLS, weekShade } from "@/lib/exports/feeding-excel";
import { breakdown } from "@/lib/reports";

describe("breakdown (EGY-13)", () => {
  const e = (day: string, recipient: string, feed: string, unit: string, value: number, group = false) => ({ day, recipient, feed, unit, value, group });
  it("by day (also a day with nothing) and by recipient, per feed and unit; pieces never add to grams", () => {
    const r = breakdown(
      [
        e("2026-11-02", "Teszt Egy", "Litopenaeus vannamei", "db", 6),
        e("2026-11-02", "Teszt Egy", "Litopenaeus vannamei", "g", 40),
        e("2026-11-02", "Teszt csoport (csoport)", "Teszt hal", "g", 300, true),
        e("2026-11-04", "Teszt Egy", "Teszt hal", "g", 100),
      ],
      ["2026-11-02", "2026-11-03", "2026-11-04"],
    );
    expect(r.columns.map((c) => c.key)).toEqual(["Litopenaeus vannamei|db", "Litopenaeus vannamei|g", "Teszt hal|g"]);
    expect(r.byDay.map((l) => [l.label, l.totals])).toEqual([
      ["2026-11-02", { db: 6, g: 340 }],
      ["2026-11-03", {}],
      ["2026-11-04", { g: 100 }],
    ]);
    expect(r.byRecipient.map((l) => [l.label, l.cells["Teszt hal|g"] ?? 0])).toEqual([
      ["Teszt csoport (csoport)", 300],
      ["Teszt Egy", 100],
    ]);
    expect(r.total.totals).toEqual({ db: 6, g: 440 });
  });
});

describe("weekShade (EVE-08)", () => {
  it("alternates by calendar week, Monday to Sunday", () => {
    expect(weekShade("2026-11-02", "2026-11-02")).toBe(WEEK_FILLS[0]); // Monday
    expect(weekShade("2026-11-02", "2026-11-08")).toBe(WEEK_FILLS[0]); // Sunday, same week
    expect(weekShade("2026-11-02", "2026-11-09")).toBe(WEEK_FILLS[1]); // next Monday
    expect(weekShade("2026-11-02", "2026-11-16")).toBe(WEEK_FILLS[0]);
    expect(weekShade("2026-11-05", "2026-11-08")).toBe(WEEK_FILLS[0]); // a period starting mid-week
    expect(weekShade("2026-11-05", "2026-11-09")).toBe(WEEK_FILLS[1]);
  });
});
