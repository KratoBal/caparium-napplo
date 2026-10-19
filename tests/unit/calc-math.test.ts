// KALK-01 arithmetic and the EGY-08 deviation rule (pure). The NY-15 / D-16 defaults are temporary:
// FR in steps of 0.5, a rough deviation beyond ±20 %.
import { describe, expect, it } from "vitest";
import { calculate, deviates } from "@/lib/calc-math";

describe("calculate (KALK-01: FR = F × N / (BW/100))", () => {
  it("BW 50 kg, FR 2 % a week, 4 feedings: 250 g a feeding, 1000 g a week, 0.2857 % a day", () => {
    expect(calculate(50, 2, 4)).toEqual({ frDayPct: 0.2857, fKg: 0.25, fG: 250, fwG: 1000 });
  });

  it("solves back to the description's formula for every allowed FR and N", () => {
    for (let fr = 1; fr <= 8; fr += 0.5) {
      for (let n = 1; n <= 7; n++) {
        const r = calculate(12.5, fr, n);
        expect((r.fKg * n) / (12.5 / 100)).toBeCloseTo(fr, 2);
      }
    }
  });

  it("refuses what the description's lists do not offer", () => {
    expect(() => calculate(50, 2.3, 4)).toThrow(/lépésköz/);
    expect(() => calculate(50, 0.5, 4)).toThrow(/1 és 8/);
    expect(() => calculate(50, 8.5, 4)).toThrow(/1 és 8/);
    expect(() => calculate(50, 2, 8)).toThrow(/1 és 7/);
    expect(() => calculate(50, 2, 2.5)).toThrow(/1 és 7/);
    expect(() => calculate(0, 2, 4)).toThrow(/testtömeg/);
  });
});

describe("deviates (EGY-08, ±20 %)", () => {
  it("within 20 % is fine, beyond is a deviation, both ways; no reference, no deviation", () => {
    expect(deviates(240, 200)).toBe(false);
    expect(deviates(241, 200)).toBe(true);
    expect(deviates(160, 200)).toBe(false);
    expect(deviates(159, 200)).toBe(true);
    expect(deviates(100, 0)).toBe(false);
  });
});
