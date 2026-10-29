// The chemical calculator's daily raise limit (Lili 2026-10-29, package item 5b; Balázs's limits, 18:59 UTC). WHAT TURNS
// THIS RED: a limit changed from his numbers; a raise at the limit taking two days; nothing to raise giving a plan.
import { describe, expect, it } from "vitest";
import { DAILY_MAX, dailyPlan } from "@/lib/daily-limit";

describe("the daily raise limit (package item 5b)", () => {
  it("Balázs's numbers, per parameter and system", () => {
    expect(DAILY_MAX).toEqual({ CA: { CORAL: 10, FISH: 20 }, KH: { CORAL: 0.5, FISH: 1 }, MG: { CORAL: 20, FISH: 40 } });
  });
  it("as few days as the limit allows, the same amount each day", () => {
    expect(dailyPlan("CA", "CORAL", 380, 420, 146.7)).toEqual({ days: 4, perDayGrams: 146.7 / 4, perDayRaise: 10, max: 10 });
    expect(dailyPlan("CA", "FISH", 380, 420, 146.7)?.days).toBe(2);
    expect(dailyPlan("KH", "CORAL", 7, 7.5, 30)?.days).toBe(1); // exactly the limit: one day
    expect(dailyPlan("KH", "CORAL", 7, 8.6, 30)?.days).toBe(4); // 1.6 / 0.5 = 3.2 -> 4
    expect(dailyPlan("MG", "FISH", 1300, 1350, 400)?.days).toBe(2);
  });
  it("nothing to raise: no plan", () => {
    expect([dailyPlan("CA", "CORAL", 420, 420, 0), dailyPlan("CA", "CORAL", 430, 420, 10)]).toEqual([null, null]);
  });
});
