// A draft whose row has gone from the sheet (src/lib/sheet-drafts.ts; Lili 2026-10-30, task caparium-csoport-sor, b): dropped, and said.
import { describe, expect, it } from "vitest";
import { vanishedDrafts } from "@/lib/sheet-drafts";

const base = {
  labelOf: (row: string) => ({ a1: "Gnocchi", "g:g1": "Hímek (csoport)" })[row] ?? "?",
  feedName: (feedId: string) => ({ f1: "Mysis", f2: "Szardínia" })[feedId] ?? "?",
};

describe("drafts of rows that are gone", () => {
  it("a typed draft of a vanished row is dropped and named, with its feeds, in one sentence per row", () => {
    const r = vanishedDrafts({ ...base, draftKeys: ["a1|f1", "a1|f2", "a3|f1"], present: new Set(["a3"]), dirty: () => true });
    expect(r.drop).toEqual(["a1|f1", "a1|f2"]);
    expect(r.message).toBe("Gnocchi sor piszkozata a csoportváltás miatt elveszett: Mysis, Szardínia.");
  });

  it("a draft that equals what is saved is dropped without a word: nothing was lost", () => {
    const r = vanishedDrafts({ ...base, draftKeys: ["a1|f1"], present: new Set(), dirty: () => false });
    expect(r).toEqual({ drop: ["a1|f1"], message: null });
  });

  it("a group row's key (g:...) is cut at the last bar, and two rows give two sentences", () => {
    const r = vanishedDrafts({ ...base, draftKeys: ["g:g1|f1", "a1|f2"], present: new Set(), dirty: () => true });
    expect(r.drop).toEqual(["g:g1|f1", "a1|f2"]);
    expect(r.message).toBe("Hímek (csoport) sor piszkozata a csoportváltás miatt elveszett: Mysis. Gnocchi sor piszkozata a csoportváltás miatt elveszett: Szardínia.");
  });

  it("drafts of rows that are still there are left alone", () => {
    const r = vanishedDrafts({ ...base, draftKeys: ["a1|f1"], present: new Set(["a1"]), dirty: () => true });
    expect(r).toEqual({ drop: [], message: null });
  });

  it("only the dirty feed of a vanished row is named", () => {
    const r = vanishedDrafts({ ...base, draftKeys: ["a1|f1", "a1|f2"], present: new Set(), dirty: (_row, feed) => feed === "f2" });
    expect(r.message).toBe("Gnocchi sor piszkozata a csoportváltás miatt elveszett: Szardínia.");
    expect(r.drop).toEqual(["a1|f1", "a1|f2"]);
  });
});
