import { describe, expect, it } from "vitest";
import { byFeedOrder, type FeedPlace } from "@/lib/feed-order";

// Lili 2026-10-28 (acrobot 37529): the feeds inside a type in the admin's order, everywhere; the types keep theirs.
type F = { name: string; place: FeedPlace | null };
const sort = (xs: F[]) => [...xs].sort(byFeedOrder<F>((x) => x.place, (a, b) => a.name.localeCompare(b.name, "hu"))).map((x) => x.name);

describe("the feeds' order", () => {
  it("by the type's order first, then the feed's own order, not by name", () => {
    expect(
      sort([
        { name: "Alfa", place: [2, 0] },
        { name: "Zöld", place: [1, 0] },
        { name: "Béta", place: [1, 1] },
      ]),
    ).toEqual(["Zöld", "Béta", "Alfa"]);
  });

  it("a feed without a known place goes after the placed ones; equal places by name", () => {
    expect(
      sort([
        { name: "Egyéb: tintahal-fej", place: [9, 0] },
        { name: "Ismeretlen", place: null },
        { name: "Egyéb: kagylóhéj", place: [9, 0] },
      ]),
    ).toEqual(["Egyéb: kagylóhéj", "Egyéb: tintahal-fej", "Ismeretlen"]);
  });
});
