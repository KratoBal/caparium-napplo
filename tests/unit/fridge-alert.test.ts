import { describe, expect, it } from "vitest";
import { fridgeAlert, fridgeAlertText } from "@/lib/fridge-alert";

// Lili 2026-11-03 (task caparium-fagyaszto-csempe): the tile's corner mark. What turns this red: a missing reading not marked,
// a closed fridge counted as missing, an out-of-range reading not marked, or a mark on a day with every reading in range.
const kis = { id: "kis", active: true };
const nagy = { id: "nagy", active: true };
const regi = { id: "regi", active: false };

describe("the fridge tile's corner mark", () => {
  it("marks an active fridge with no reading on the day", () => {
    expect(fridgeAlert([kis, nagy], [{ fridgeId: "kis", outOfRange: false }])).toEqual({ missing: 1, out: 0 });
  });

  it("does not count a closed fridge as missing", () => {
    expect(fridgeAlert([kis, regi], [{ fridgeId: "kis", outOfRange: false }])).toBeNull();
  });

  it("marks an out-of-range reading, also of a closed fridge", () => {
    expect(fridgeAlert([kis, regi], [{ fridgeId: "kis", outOfRange: false }, { fridgeId: "regi", outOfRange: true }])).toEqual({ missing: 0, out: 1 });
  });

  it("has no mark when every active fridge is read and in range, or there is no fridge at all", () => {
    expect(fridgeAlert([kis, nagy], [{ fridgeId: "kis", outOfRange: false }, { fridgeId: "nagy", outOfRange: false }])).toBeNull();
    expect(fridgeAlert([], [])).toBeNull();
  });

  it("says what is wrong, the out-of-range part first", () => {
    expect(fridgeAlertText({ missing: 2, out: 1 })).toBe("1 tartományon kívüli érték, 2 még nincs beírva");
    expect(fridgeAlertText({ missing: 1, out: 0 })).toBe("1 még nincs beírva");
  });
});
