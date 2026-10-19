import { describe, expect, it } from "vitest";
import { canonicalDecimal, compareDecimal, formatDecimalHu, multiplyDecimal, parseDecimalInput } from "@/lib/decimal";

describe("decimal input (JAV-02, K8)", () => {
  it("accepts comma and dot", () => {
    expect(parseDecimalInput("8,12")).toBe("8.12");
    expect(parseDecimalInput(" 8.12 ")).toBe("8.12");
    expect(parseDecimalInput("305")).toBe("305");
    expect(parseDecimalInput("-12,5")).toBe("-12.5");
  });
  it("rejects non-numbers and too many decimals", () => {
    for (const bad of ["", "abc", "8,1,2", "1e3", "8.12345", "NaN", "12345678901"]) expect(parseDecimalInput(bad)).toBeNull();
  });
  it("compares exactly, not in floating point", () => {
    expect(compareDecimal("0.3", "0.30")).toBe(0);
    expect(compareDecimal("8.4", "8.40001")).toBe(-1);
    expect(compareDecimal("-1", "0")).toBe(-1);
  });
  it("multiplies exactly", () => {
    expect(multiplyDecimal("35.2", "1000")).toBe("35200");
    expect(multiplyDecimal("0.1", "0.2")).toBe("0.02");
  });
  it("formats with a Hungarian comma and fixed decimals", () => {
    expect(formatDecimalHu("35", 1)).toBe("35,0");
    expect(formatDecimalHu("8.125", 2)).toBe("8,13");
    expect(formatDecimalHu("305", 0)).toBe("305");
  });
  it("canonical form drops trailing zeros", () => {
    expect(canonicalDecimal("8.1200")).toBe("8.12");
    expect(canonicalDecimal("305.0000")).toBe("305");
  });
});
