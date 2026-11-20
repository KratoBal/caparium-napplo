import { describe, expect, it } from "vitest";
import { differencePercent, plainNumber, rowForDisplay, summaryCell } from "@/lib/mass-display";

describe("the taken-given row in g or kg (Lili 2026-10-27)", () => {
  it("a gram row with any value at 1000 g or more is shown in kg as a whole, two decimals", () => {
    expect(rowForDisplay("g", [7670, 650, 7020])).toEqual({ unit: "kg", values: ["7,67", "0,65", "7,02"] });
    // the difference alone reaching 1000 is enough, and a negative one counts by its size
    expect(rowForDisplay("g", [200, 1400, -1200])).toEqual({ unit: "kg", values: ["0,20", "1,40", "-1,20"] });
  });
  it("a difference rounding to zero is shown without a sign", () => {
    expect(rowForDisplay("g", [1500, 1503, -3])).toEqual({ unit: "kg", values: ["1,50", "1,50", "0,00"] });
    expect(rowForDisplay("g", [1500, 1497, 3]).values[2]).toBe("0,00");
  });
  it("exactly 1000 g turns the row; 999,9 g does not", () => {
    expect(rowForDisplay("g", [1000, 0, 1000]).unit).toBe("kg");
    expect(rowForDisplay("g", [999.9, 0, 999.9])).toEqual({ unit: "g", values: ["999,9", "0", "999,9"] });
  });
  it("a piece row is untouched, however large", () => {
    expect(rowForDisplay("db", [1500, 1200, 300])).toEqual({ unit: "db", values: ["1500", "1200", "300"] });
  });
  it("the plain form keeps at most four decimals with a comma", () => {
    expect(plainNumber(12.345678)).toBe("12,3457");
  });
});

describe("summaryCell (Lili's package, item 12 follow-up)", () => {
  it("a gram value from 1000 g up reads in kg with its unit, below it stays plain; other units are never converted", () => {
    expect(summaryCell("g", 7670)).toBe("7,67 kg");
    expect(summaryCell("g", 1000)).toBe("1,00 kg");
    expect(summaryCell("g", 999)).toBe("999");
    expect(summaryCell("g", 12.5)).toBe("12,5");
    expect(summaryCell("db", 2500)).toBe("2500");
    expect(summaryCell("ml", 1500)).toBe("1500");
  });
});

describe("differencePercent: (taken - given) / taken * 100 for the taken-given table (Lili via acrobot 58211)", () => {
  it("one decimal, a Hungarian comma and a percent sign", () => {
    expect(differencePercent(200, 150)).toBe("25,0%");
    expect(differencePercent(8, 7)).toBe("12,5%");
    expect(differencePercent(3, 2)).toBe("33,3%");
    // taken and given equal: no difference
    expect(differencePercent(40, 40)).toBe("0,0%");
  });
  it("more given than taken stays negative", () => {
    expect(differencePercent(100, 125)).toBe("-25,0%");
    expect(differencePercent(3, 4)).toBe("-33,3%");
  });
  it("nothing given is a hundred percent, whatever the unit's size", () => {
    expect(differencePercent(7670, 0)).toBe("100,0%");
    expect(differencePercent(12, 0)).toBe("100,0%");
  });
  it("nothing taken has no percentage (no division by zero), not even with something given", () => {
    expect(differencePercent(0, 0)).toBeNull();
    expect(differencePercent(0, 12)).toBeNull();
    expect(differencePercent(Number.NaN, 5)).toBeNull();
  });
  it("a value rounding to zero has no sign", () => {
    expect(differencePercent(10000, 10004)).toBe("0,0%");
    expect(differencePercent(10000, 9996)).toBe("0,0%");
  });
});
