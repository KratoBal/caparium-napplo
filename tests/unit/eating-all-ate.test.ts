import { describe, expect, it } from "vitest";
import { allAteTargets } from "@/lib/eating-all-ate";

// WHAT TURNS THIS RED: a filled row overwritten (saved or only picked), a row off the list marked, or an empty row missed.
describe("allAteTargets", () => {
  const rows = [
    { animalId: "empty", selected: true, manualStatus: false },
    { animalId: "saved", selected: true, manualStatus: true },
    { animalId: "picked", selected: true, manualStatus: false },
    { animalId: "off-list", selected: false, manualStatus: false },
    { animalId: "automatic", selected: true, manualStatus: false },
  ];

  it("fills only the empty rows of the day's list", () => {
    expect(allAteTargets(rows, { picked: { state: "PARTIAL" }, saved: { state: "NOT_EATEN" }, automatic: { state: "" } })).toEqual(["empty", "automatic"]);
  });

  it("a saved row stays even when its draft is empty", () => {
    expect(allAteTargets(rows, { saved: { state: "" } })).not.toContain("saved");
  });

  it("nothing to fill gives an empty list", () => {
    expect(allAteTargets([{ animalId: "a", selected: true, manualStatus: true }], {})).toEqual([]);
  });
});
