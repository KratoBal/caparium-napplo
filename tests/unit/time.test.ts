import { describe, expect, it } from "vitest";
import { addDays, businessDayOf, formatDayLong, localTimeOf, resolveLocalDateTime } from "@/lib/time";

describe("business day (K2: Europe/Budapest, midnight boundary)", () => {
  it("summer: 23:59 local is still the same day, 00:00 local is the next", () => {
    expect(businessDayOf(new Date("2026-07-15T21:59:00Z"))).toBe("2026-07-15");
    expect(businessDayOf(new Date("2026-07-15T22:00:00Z"))).toBe("2026-07-16");
  });
  it("winter: the offset is one hour", () => {
    expect(businessDayOf(new Date("2026-01-15T22:59:00Z"))).toBe("2026-01-15");
    expect(businessDayOf(new Date("2026-01-15T23:00:00Z"))).toBe("2026-01-16");
  });
  it("local time is the wall clock", () => {
    expect(localTimeOf(new Date("2026-10-15T06:06:00Z"))).toBe("08:06");
  });
});

describe("local wall clock -> instant", () => {
  it("normal time", () => {
    const r = resolveLocalDateTime("2026-10-15T08:06")!;
    expect(r.instant.toISOString()).toBe("2026-10-15T06:06:00.000Z");
    expect(r.ambiguous).toBe(false);
  });
  it("autumn fall-back hour is flagged ambiguous and resolves to the earlier instant (R-18)", () => {
    const r = resolveLocalDateTime("2026-10-25T02:30")!;
    expect(r.ambiguous).toBe(true);
    expect(r.instant.toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });
  it("spring-forward gap is moved past the gap", () => {
    const r = resolveLocalDateTime("2026-03-29T02:30")!;
    expect(r.skipped).toBe(true);
    expect(businessDayOf(r.instant)).toBe("2026-03-29");
    expect(localTimeOf(r.instant)).toBe("03:30");
  });
  it("rejects malformed and impossible dates", () => {
    expect(resolveLocalDateTime("2026-02-30T10:00")).toBeNull();
    expect(resolveLocalDateTime("tegnap")).toBeNull();
    expect(resolveLocalDateTime("2026-10-15T24:00")).toBeNull();
  });
  it("round trip on the 25-hour day", () => {
    for (const t of ["2026-10-25T00:30", "2026-10-25T01:59", "2026-10-25T03:00", "2026-10-25T23:59"]) {
      const r = resolveLocalDateTime(t)!;
      expect(`${businessDayOf(r.instant)}T${localTimeOf(r.instant)}`).toBe(t);
    }
  });
});

describe("day helpers", () => {
  it("addDays crosses month ends", () => expect(addDays("2026-02-28", 1)).toBe("2026-03-01"));
  it("Hungarian long date", () => expect(formatDayLong("2026-10-15")).toBe("2026. október 15."));
});
