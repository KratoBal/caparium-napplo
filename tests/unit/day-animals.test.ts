import { describe, expect, it } from "vitest";
import { chooserPools, NO_POOL, sortDayAnimals, type ChooserAnimal } from "@/lib/day-animals";

// Lili 2026-10-26 (card f67b1a06, item 2): the "Ki eszik ma" list is by pool.
const a = (id: string, name: string, poolName: string | null, sortOrder: number | null = null): ChooserAnimal => ({ id, name, poolName, sortOrder });

describe("the day's animals by pool", () => {
  const unsorted = [a("1", "Zita", "Nagymedence"), a("2", "Ádám", null), a("3", "Béla", "Kismedence"), a("4", "Anna", "Nagymedence")];

  it("sorts by pool, the pool-less last, then by name (Hungarian collation)", () => {
    expect(sortDayAnimals(unsorted).map((x) => x.name)).toEqual(["Béla", "Anna", "Zita", "Ádám"]);
  });

  it("does not reorder its input", () => {
    const copy = [...unsorted];
    sortDayAnimals(unsorted);
    expect(unsorted).toEqual(copy);
  });

  it("makes one line per pool, in order, the pool-less one named", () => {
    const lines = chooserPools(sortDayAnimals(unsorted));
    expect(lines.map((l) => [l.name, l.animals.map((x) => x.name)])).toEqual([
      ["Kismedence", ["Béla"]],
      ["Nagymedence", ["Anna", "Zita"]],
      [NO_POOL, ["Ádám"]],
    ]);
    expect(new Set(lines.map((l) => l.key)).size).toBe(lines.length);
  });

  it("makes no lines for no animals", () => {
    expect(chooserPools([])).toEqual([]);
  });
});

// item 4 of the same card: inside a pool the admin's order comes before the name
describe("the admin's order inside a pool", () => {
  it("places the ordered animals first within their pool, the pools still alphabetical and the pool-less last", () => {
    const list = [
      a("1", "Anna", "Nagymedence"),
      a("2", "Zita", "Nagymedence", 0),
      a("3", "Béla", "Kismedence"),
      a("4", "Ádám", null, 0),
      a("5", "Cili", "Nagymedence", 1),
    ];
    expect(sortDayAnimals(list).map((x) => x.name)).toEqual(["Béla", "Zita", "Cili", "Anna", "Ádám"]);
  });
});

