import { describe, expect, it } from "vitest";
import { intakeDefaultUnit } from "@/lib/intake-unit";

describe("intakeDefaultUnit (Lili 2026-10-30: kg at intake)", () => {
  it("starts a mass list on kg, wherever it stands in the list", () => {
    expect(intakeDefaultUnit([{ id: "g", symbol: "g" }, { id: "kg", symbol: "kg" }])).toBe("kg");
    expect(intakeDefaultUnit([{ id: "kg", symbol: "kg" }, { id: "g", symbol: "g" }])).toBe("kg");
  });

  it("a list with no kg (pieces, volume) starts on its first unit, as before", () => {
    expect(intakeDefaultUnit([{ id: "db", symbol: "db" }])).toBe("db");
    expect(intakeDefaultUnit([{ id: "ml", symbol: "ml" }, { id: "l", symbol: "l" }])).toBe("ml");
  });

  it("an empty list has no unit", () => {
    expect(intakeDefaultUnit([])).toBeUndefined();
  });
});
