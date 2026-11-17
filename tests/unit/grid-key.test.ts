// card 7fdbf78f (task t-20261117-caparium-racs-banner): the day's first save creates round 1; the grid's key must not change
// with it, or the refresh after the save remounts the grid and its "Minden érték mentve." banner is gone. A real change of
// round still changes the key.
import { describe, expect, it } from "vitest";
import { gridKey } from "@/lib/grid-key";

describe("gridKey", () => {
  it("no round yet and round 1 are one key: the first save does not remount the grid", () => {
    expect(gridKey("g", "2026-11-17", undefined)).toBe(gridKey("g", "2026-11-17", 1));
    expect(gridKey("g", "2026-11-17", null)).toBe(gridKey("g", "2026-11-17", 1));
  });
  it("another round, another day or another group is another key: the grid starts again", () => {
    const one = gridKey("g", "2026-11-17", 1);
    expect([gridKey("g", "2026-11-17", 2), gridKey("g", "2026-11-18", 1), gridKey("h", "2026-11-17", 1)].filter((k) => k === one)).toEqual([]);
  });
});
