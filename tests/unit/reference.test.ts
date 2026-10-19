import { describe, expect, it } from "vitest";
import { evaluateReference } from "@/lib/reference";

const ph = { id: "ph", dimension: "DIMENSIONLESS", factorToBase: null };
const ppt = { id: "ppt", dimension: "CONCENTRATION", factorToBase: "1000" };
const ppm = { id: "ppm", dimension: "CONCENTRATION", factorToBase: "1" };
const mv = { id: "mv", dimension: "VOLTAGE", factorToBase: "1" };

describe("reference evaluation (VIZ-02, DN-08)", () => {
  it("inside, below and above; the bounds themselves are inside", () => {
    const r = { min: "8", max: "8.4", unit: ph };
    expect(evaluateReference("8.12", ph, r)).toBe("IN_RANGE");
    expect(evaluateReference("7.88", ph, r)).toBe("LOW");
    expect(evaluateReference("8.41", ph, r)).toBe("HIGH");
    expect(evaluateReference("8", ph, r)).toBe("IN_RANGE");
    expect(evaluateReference("8.4", ph, r)).toBe("IN_RANGE");
  });
  it("one-sided range", () => {
    expect(evaluateReference("12", ppm, { min: null, max: "10", unit: ppm })).toBe("HIGH");
    expect(evaluateReference("0", ppm, { min: null, max: "10", unit: ppm })).toBe("IN_RANGE");
  });
  it("no range: no colouring", () => {
    expect(evaluateReference("1", ph, null)).toBe("NO_RANGE");
  });
  it("converts within a dimension", () => {
    expect(evaluateReference("35", ppt, { min: "33000", max: "36000", unit: ppm })).toBe("IN_RANGE");
    expect(evaluateReference("37", ppt, { min: "33000", max: "36000", unit: ppm })).toBe("HIGH");
  });
  it("never compares across dimensions", () => {
    expect(evaluateReference("300", mv, { min: "8", max: "9", unit: ph })).toBe("INCOMPARABLE");
  });
});
