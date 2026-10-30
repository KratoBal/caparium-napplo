import { describe, expect, it } from "vitest";
import { addDays, businessDayOf, EXCEL_DATE_FORMAT, formatDateTime, formatDay, formatPeriod, localTimeOf, resolveLocalDateTime, weekdayLetter } from "@/lib/time";

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
});

// Lili 2026-10-30 (acrobot 38840): one shape for every date a person reads, 2026.10.30., except ZIMS and the date inputs
describe("the dotted date (formatDay, formatPeriod, formatDateTime)", () => {
  it("a day is year.month.day. with a closing dot", () => {
    expect(formatDay("2026-10-30")).toBe("2026.10.30.");
    expect(formatDay("2026-01-05")).toBe("2026.01.05.");
  });

  it("anything that is not a day is returned as it came, not turned into a made-up date", () => {
    for (const v of ["", "nincs", "2026-1-5", "2026-10-30T09:05", "2026.10.30."]) expect(formatDay(v), v).toBe(v);
  });

  it("a period is two dates with an en dash, one date when it is one day, and never a double dot", () => {
    expect(formatPeriod("2026-10-01", "2026-10-30")).toBe("2026.10.01. – 2026.10.30.");
    expect(formatPeriod("2026-10-01", "2026-10-01")).toBe("2026.10.01.");
    expect(formatPeriod("2026-10-01", "2026-10-30")).not.toMatch(/\.\./);
  });

  it("an instant is the Budapest date and time: summer time, winter time, and the day boundary", () => {
    // summer time ends on 2026-10-25: the 20th is +02:00, the 30th and the month after are +01:00
    expect(formatDateTime(new Date("2026-10-20T07:05:00Z"))).toBe("2026.10.20. 09:05");
    expect(formatDateTime(new Date("2026-11-30T07:05:00Z"))).toBe("2026.11.30. 08:05");
    expect(formatDateTime(new Date("2026-10-30T22:30:00Z"))).toBe("2026.10.30. 23:30");
    expect(formatDateTime(new Date("2026-10-30T23:30:00Z"))).toBe("2026.10.31. 00:30");
    expect(formatDateTime("2026-10-30T07:05:00.000Z")).toBe("2026.10.30. 08:05");
    expect(formatDateTime("nem idő")).toBe("nem idő");
  });

  it("the Excel format quotes the dots, so the month is not read as minutes", () => {
    expect(EXCEL_DATE_FORMAT).toBe('yyyy"."mm"."dd"."');
  });
});

describe("the day's letter (Lili 2026-10-29, package item 7)", () => {
  it("as the timetable writes it, Monday first", () => {
    expect(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"].map(weekdayLetter)).toEqual(["H", "K", "Sze", "Cs", "P", "Szo", "V"]);
  });
});
