import { describe, expect, it } from "vitest";
import { sheetColumnFeeds } from "@/lib/sheet-columns";

// barracuda on #104: a list keeps an animal with an item of a feed outside the list's feeds; the sheet still shows that item.
// WHAT TURNS RED: the given feeds dropped while a choice exists; "Egyéb" as a column; the chosen ones dropped.
const feeds = [{ id: "hal" }, { id: "kagylo" }, { id: "mysis" }, { id: "egyeb", isOther: true }];
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("the feeding sheet's columns", () => {
  it("the chosen feeds and the feeds already given, in the feeds' order", () => {
    expect(ids(sheetColumnFeeds(feeds, ["hal"], ["kagylo"]))).toEqual(["hal", "kagylo"]);
  });
  it("no choice: the given ones; nothing given: none", () => {
    expect(ids(sheetColumnFeeds(feeds, [], ["mysis"]))).toEqual(["mysis"]);
    expect(ids(sheetColumnFeeds(feeds, [], []))).toEqual([]);
  });
  it("never Egyéb, chosen or given", () => {
    expect(ids(sheetColumnFeeds(feeds, ["egyeb", "hal"], ["egyeb"]))).toEqual(["hal"]);
  });
});
