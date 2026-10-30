import { describe, expect, it } from "vitest";
import { stockHint, type StockInfo } from "@/lib/stock-hint";

const stock: StockInfo[] = [
  { feedId: "f1", otherName: null, dimension: "MASS", unit: "g", level: 1500 },
  { feedId: "f1", otherName: null, dimension: "COUNT", unit: "db", level: 20 },
  { feedId: "f2", otherName: "tinta hal", dimension: "MASS", unit: "g", level: 300 },
];

describe("stockHint", () => {
  it("shows the stock of the chosen feed per dimension, grams from 1000 as kilograms", () => {
    expect(stockHint(stock, "f1", null, []).map((h) => h.text)).toEqual(["Készlet: 1,50 kg", "Készlet: 20 db"]);
  });

  it("warns when the typed amount, in base units, is more than the stock; equal is fine", () => {
    const over = stockHint(stock, "f1", null, [{ dimension: "MASS", value: 2, factor: 1000 }]);
    expect(over[0]).toMatchObject({ over: true });
    expect(over[0].text).toContain("meghaladja a készletet");
    expect(stockHint(stock, "f1", null, [{ dimension: "MASS", value: 1.5, factor: 1000 }])[0].over).toBe(false);
    expect(stockHint(stock, "f1", null, [{ dimension: "COUNT", value: null, factor: 1 }])[1].over).toBe(false);
  });

  it("an other feed is found by its name whatever the case or the spaces; a feed without a stock row says nothing", () => {
    expect(stockHint(stock, "f2", " Tinta  Hal ", []).map((h) => h.text)).toEqual(["Készlet: 300 g"]);
    expect(stockHint(stock, "f2", "kagyló", [])).toEqual([]);
    expect(stockHint(stock, "f3", null, [])).toEqual([]);
  });
});
