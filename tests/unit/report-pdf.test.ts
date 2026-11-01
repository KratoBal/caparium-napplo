// Lili 2026-11-01 (point 8): the Kimutatások PDF's tables, one a feed group, a group too wide for the page cut into parts
import { describe, expect, it } from "vitest";
import { groupTables } from "@/lib/exports/report-pdf";
import type { Column } from "@/lib/reports";

const col = (feed: string, type: string, group = false): Column => ({ key: `${feed}|g`, feed, unit: "g", group, type });

describe("groupTables", () => {
  it("one table a feed type, the group items apart, in the page's order", () => {
    const t = groupTables([col("A", "Halak"), col("B", "Halak"), col("C", "Rákok"), col("A", "Halak", true)], 762);
    expect(t.map((x) => [x.label, x.columns.map((c) => c.feed)])).toEqual([
      ["Halak", ["A", "B"]],
      ["Rákok", ["C"]],
      ["Halak (csoportos tételek)", ["A"]],
    ]);
  });
  it("a group wider than the page goes on in parts, none lost", () => {
    const many = Array.from({ length: 25 }, (_, i) => col(`F${i}`, "Halak"));
    const t = groupTables(many, 762);
    expect(t.length).toBeGreaterThan(1);
    expect(t.flatMap((x) => x.columns.map((c) => c.feed))).toEqual(many.map((c) => c.feed));
    expect(t[0].label).toBe("Halak (1. rész)");
    // each part fits: the label column, its feed columns and one total column at the narrowest width
    for (const x of t) expect(120 + (x.columns.length + 1) * 58).toBeLessThanOrEqual(762);
  });
});
