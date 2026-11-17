// Lili 2026-11-17: Tab on the feeding sheet goes to the next animal's first field; after the last one, to the save
import { describe, expect, it } from "vitest";
import { isPlainTab, nextRowKey } from "@/lib/sheet-tab";

describe("nextRowKey", () => {
  it("the next animal, and none after the last one or for an unknown row", () => {
    const keys = ["a1", "g:g1", "a2"];
    expect([nextRowKey(keys, "a1"), nextRowKey(keys, "g:g1"), nextRowKey(keys, "a2"), nextRowKey(keys, "x")]).toEqual(["g:g1", "a2", null, null]);
  });
});

describe("isPlainTab", () => {
  const input = { tagName: "INPUT" };
  it("a plain Tab from a field; not Shift+Tab, not a modified Tab, not another key, not from a button", () => {
    expect([
      isPlainTab({ key: "Tab", target: input }),
      isPlainTab({ key: "Tab", shiftKey: true, target: input }),
      isPlainTab({ key: "Tab", ctrlKey: true, target: input }),
      isPlainTab({ key: "Enter", target: input }),
      isPlainTab({ key: "Tab", target: { tagName: "BUTTON" } }),
    ]).toEqual([true, false, false, false, false]);
  });
});
