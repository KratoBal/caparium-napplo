import { describe, expect, it } from "vitest";
import { sheetName } from "@/lib/exports/excel";
import { csvField, fileName, inRepeatedHour, monthlyFileName, rowHash, zimsDate, zimsTime, zimsValue } from "@/lib/exports/zims";

const TZ = "Europe/Budapest";

describe("ZIMS formats (profile v1, VIZ-18)", () => {
  it("date like the sample: English month, unpadded day, comma, year; the local day", () => {
    expect(zimsDate(new Date("2026-09-20T10:00:00Z"), TZ)).toBe("Sep 20, 2026");
    expect(zimsDate(new Date("2026-10-06T08:00:00Z"), TZ)).toBe("Oct 6, 2026");
    // 23:30 local on Oct 15 is 21:30 UTC: the ZIMS date is the local one
    expect(zimsDate(new Date("2026-10-15T21:30:00Z"), TZ)).toBe("Oct 15, 2026");
    expect(zimsDate(new Date("2026-10-15T22:30:00Z"), TZ)).toBe("Oct 16, 2026");
  });
  it("24-hour local time without offset", () => {
    expect(zimsTime(new Date("2026-10-06T15:08:00Z"), TZ)).toBe("17:08");
    expect(zimsTime(new Date("2026-01-06T16:08:00Z"), TZ)).toBe("17:08");
  });
  it("value with the parameter's decimals and a dot, exactly", () => {
    expect(zimsValue("8", 2)).toBe("8.00");
    expect(zimsValue("8.125", 2)).toBe("8.13");
    expect(zimsValue("305", 0)).toBe("305");
    expect(zimsValue("0.1", 2)).toBe("0.10");
  });
  it("RFC 4180 quoting: the date with its comma is quoted, plain fields are not", () => {
    expect(csvField("Sep 20, 2026")).toBe('"Sep 20, 2026"');
    expect(csvField("Nitrate (NO₃⁻)")).toBe("Nitrate (NO₃⁻)");
    expect(csvField('say "x"')).toBe('"say ""x"""');
  });
  it("the row hash changes with any field", () => {
    const a = rowHash(["Sep 20, 2026", "12:00", "pH", "8.00", "pH", "Test Admin"]);
    expect(rowHash(["Sep 20, 2026", "12:00", "pH", "8.01", "pH", "Test Admin"])).not.toBe(a);
    expect(rowHash(["Sep 20, 2026", "12:00", "pH", "8.00", "pH", "Test Admin"])).toBe(a);
  });
  it("the repeated autumn hour is detected (R-18)", () => {
    expect(inRepeatedHour(new Date("2026-10-25T00:30:00Z"), TZ)).toBe(true);
    expect(inRepeatedHour(new Date("2026-10-25T02:30:00Z"), TZ)).toBe(false);
  });
  it("ascii file names per system and period", () => {
    expect(fileName("Karantén", "2026-10-01", "2026-10-31")).toBe("ZIMS-Karanten-2026-10-01_2026-10-31.csv");
    expect(fileName("Nagymedence", "2026-10-15", "2026-10-15")).toBe("ZIMS-Nagymedence-2026-10-15.csv");
  });
  it("the monthly package's file name: year, pool without accents, two-digit month, ZIMSimport (Lili 2026-10-29)", () => {
    expect(monthlyFileName("Nagymedence", "2026-10-01")).toBe("2026_Nagymedence_10_ZIMSimport.csv");
    expect(monthlyFileName("Karantén medence", "2027-01-01")).toBe("2027_Karanten-medence_01_ZIMSimport.csv");
    expect(monthlyFileName("???", "2026-03-01")).toBe("2026_medence_03_ZIMSimport.csv");
  });
});

describe("Excel sheet names", () => {
  it("are at most 31 characters, without forbidden characters, and unique", () => {
    const taken = new Set<string>();
    expect(sheetName("Vízmérés teljes", taken)).toBe("Vízmérés teljes");
    expect(sheetName("a/b:c", taken)).toBe("a b c");
    expect(sheetName("vízmérés teljes", taken)).toBe("vízmérés teljes 2");
    expect(sheetName("x".repeat(40), taken)).toHaveLength(31);
  });
});
