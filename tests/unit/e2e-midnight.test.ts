import { describe, expect, it } from "vitest";
import { MIDNIGHT_WINDOW_MIN, waitBeforeRun } from "../support/e2e-midnight";

// card c94d26ba: the e2e run does not start close to Budapest midnight
describe("waitBeforeRun", () => {
  it("does not wait during the day, in winter and in summer time", () => {
    expect(waitBeforeRun(new Date("2026-10-27T21:00:00Z"))).toBe(0); // 22:00 CET
    expect(waitBeforeRun(new Date("2026-07-01T20:30:00Z"))).toBe(0); // 22:30 CEST
    expect(waitBeforeRun(new Date("2026-10-27T23:01:00Z"))).toBe(0); // 00:01 CET, just past
  });

  it("waits until one minute past midnight inside the window, by the zone's offset", () => {
    // 23:55 CET (UTC+1): 5 minutes to midnight, wait 6
    expect(waitBeforeRun(new Date("2026-10-27T22:55:00Z"))).toBe(6 * 60_000);
    // 23:55 CEST (UTC+2): the same wall clock, an hour earlier in UTC
    expect(waitBeforeRun(new Date("2026-07-01T21:55:00Z"))).toBe(6 * 60_000);
    // the window's edge: exactly MIDNIGHT_WINDOW_MIN minutes before waits, one more does not
    expect(waitBeforeRun(new Date(Date.parse("2026-10-27T23:00:00Z") - MIDNIGHT_WINDOW_MIN * 60_000))).toBe((MIDNIGHT_WINDOW_MIN + 1) * 60_000);
    expect(waitBeforeRun(new Date(Date.parse("2026-10-27T23:00:00Z") - (MIDNIGHT_WINDOW_MIN + 1) * 60_000))).toBe(0);
  });
});
