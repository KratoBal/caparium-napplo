// Lili 2026-11-01 (point 13): the Hanna readings and their rounding, exact (K8)
import { describe, expect, it } from "vitest";
import { convertReading, roundDecimal } from "@/lib/reading";

const HI755 = { factor: "0.056", decimals: 1 }; // KH, dKH
const HI736 = { factor: "0.003066", decimals: 3 }; // PO4, ppm

describe("a tester's reading", () => {
  it("converts Lili's two testers with their decimals", () => {
    expect(convertReading("125", HI755)).toBe("7"); // 7.000
    expect(convertReading("133", HI755)).toBe("7.4"); // 7.448
    expect(convertReading("142", HI755)).toBe("8"); // 7.952
    expect(convertReading("30", HI736)).toBe("0.092"); // 0.09198
    expect(convertReading("17", HI736)).toBe("0.052"); // 0.052122
    expect(convertReading("12,5", HI755)).toBe("0.7"); // a comma typed: 0.7
  });

  it("rounds half away from zero, on the exact product (no float error)", () => {
    expect(roundDecimal("0.05", 1)).toBe("0.1");
    expect(roundDecimal("0.0449999", 2)).toBe("0.04");
    expect(roundDecimal("2.675", 2)).toBe("2.68"); // 2.675 in binary floating point would round to 2.67
    expect(roundDecimal("-1.25", 1)).toBe("-1.3");
    expect(roundDecimal("-0.04", 1)).toBe("0");
    expect(roundDecimal("12", 0)).toBe("12");
    expect(roundDecimal("9.96", 1)).toBe("10");
  });

  it("is null for what is not a number", () => {
    expect(convertReading("", HI755)).toBeNull();
    expect(convertReading("12a", HI755)).toBeNull();
  });
});
