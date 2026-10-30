import { describe, expect, it } from "vitest";
import { stockStatus } from "@/lib/feed-intake";

// The feed stock runs out by the chemicals' rule (notices.ts runningOut): at or below zero, or at most 3 days at the
// average withdrawal of the last 30 days. A feed with no intake has no starting stock and never raises it.
describe("stockStatus", () => {
  it("estimates the days from the 30 day average", () => {
    expect(stockStatus({ level: 600, month: 3000, tracked: true, active: true })).toEqual({ daysLeft: 6, low: false });
    expect(stockStatus({ level: 300, month: 3000, tracked: true, active: true })).toEqual({ daysLeft: 3, low: true });
    expect(stockStatus({ level: 310, month: 3000, tracked: true, active: true }).low).toBe(false);
  });

  it("has no estimate without a withdrawal, and is low only at or below zero then", () => {
    expect(stockStatus({ level: 500, month: 0, tracked: true, active: true })).toEqual({ daysLeft: null, low: false });
    expect(stockStatus({ level: 0, month: 0, tracked: true, active: true }).low).toBe(true);
    expect(stockStatus({ level: -5, month: 0, tracked: true, active: true }).low).toBe(true);
  });

  it("never alerts a feed without intake", () => {
    expect(stockStatus({ level: -40, month: 40, tracked: false, active: true })).toEqual({ daysLeft: -30, low: false });
  });
});

describe("stockStatus, an inactive feed", () => {
  it("never runs out: a feed taken out of the list does not alert, whatever its level", () => {
    expect(stockStatus({ level: 0, month: 0, tracked: true, active: false }).low).toBe(false);
    expect(stockStatus({ level: 0, month: 0, tracked: true, active: true }).low).toBe(true);
  });
});
