// Lili 2026-11-17: a save whose every row was refused left the stale versions; the page now refreshes after every save,
// and a refused row keeps what was typed into it across that refresh
import { describe, expect, it } from "vitest";
import { refusedNote, rowsToReset } from "@/lib/eating-drafts";

describe("rowsToReset", () => {
  it("a changed row starts again from the server, a refused one keeps its typed values", () => {
    expect(rowsToReset(["a", "b", "c"], new Set(["b"]))).toEqual(["a", "c"]);
    expect(rowsToReset(["a"], new Set())).toEqual(["a"]);
  });
});

describe("refusedNote", () => {
  it("says the typed values stayed only when a row was refused", () => {
    expect(refusedNote(0)).toBeNull();
    expect(refusedNote(4)).toMatch(/beírt érték megmaradt/);
  });
});
