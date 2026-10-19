// JAV-08 weekday, DAT-03 icon validation (pure).
import { describe, expect, it } from "vitest";
import { weekdayOf } from "@/lib/feeding-plan";
import { iconSchema } from "@/lib/icons";

describe("weekdayOf (JAV-08)", () => {
  it("1 = Monday .. 7 = Sunday", () => {
    expect(["2026-11-02", "2026-11-03", "2026-11-07", "2026-11-08"].map(weekdayOf)).toEqual([1, 2, 6, 7]);
  });
});

describe("the icon (DAT-03)", () => {
  const ok = (emoji: string) => iconSchema.safeParse({ requestId: "req-12345678", target: "pool", id: "00000000-0000-4000-8000-000000000000", emoji }).success;
  it("one emoji, with its joiners and modifiers, or nothing; never text", () => {
    expect(["🐠", "🪸", "🦈", "👩🏽‍🔬", "🇭🇺", ""].map(ok)).toEqual([true, true, true, true, true, true]);
    expect(["abc", "=1+1", "🐠 hal", "<b>"].map(ok)).toEqual([false, false, false, false]);
  });
});
