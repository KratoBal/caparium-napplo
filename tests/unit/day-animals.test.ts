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

  // Lili 2026-10-26 (item 3): the pool's icon stands before its name; a pool without one has none
  it("carries the pool's icon to its line", () => {
    const withIcon = (id: string, name: string, poolName: string | null, poolEmoji: string | null): ChooserAnimal => ({ id, name, poolName, poolEmoji });
    const lines = chooserPools(sortDayAnimals([withIcon("1", "Anna", "Nagymedence", "🦈"), withIcon("2", "Béla", "Kismedence", null), withIcon("3", "Zita", "Nagymedence", "🦈"), withIcon("4", "Ádám", null, null)]));
    expect(lines.map((l) => [l.name, l.emoji])).toEqual([["Kismedence", null], ["Nagymedence", "🦈"], [NO_POOL, null]]);
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

// Lili 2026-10-27 22:15 UTC (acrobot 37086): the pool lines in the pools' own order, not by name
describe("the pools in their own order", () => {
  const p = (id: string, name: string, poolName: string | null, poolSortOrder: number | null, sortOrder: number | null = null): ChooserAnimal => ({
    id,
    name,
    poolName,
    poolSortOrder,
    sortOrder,
  });
  // the stage pools' places (Lili 2026-10-26, the water report): Nagymedence 0, Karantén 1, Kismedence 2, Ragadozós 3, Korallos 4, Inkubátor 5
  const list = [
    p("1", "Inka", "Inkubátor", 5),
    p("2", "Kori", "Korallos", 4),
    p("3", "Rozi", "Ragadozós", 3),
    p("4", "Kara", "Karantén", 1),
    p("5", "Nagy2", "Nagymedence", 0, 1),
    p("6", "Nagy1", "Nagymedence", 0, 0),
    p("7", "Uj", "Új medence", null),
    p("8", "Alma", "Aaa medence", null),
    p("9", "Senki", null, null),
  ];

  it("Nagymedence, Karantén, Ragadozós, Korallos, Inkubátor; an unplaced pool after them by name; the pool-less last", () => {
    expect(chooserPools(sortDayAnimals(list)).map((l) => l.name)).toEqual([
      "Nagymedence",
      "Karantén",
      "Ragadozós",
      "Korallos",
      "Inkubátor",
      "Aaa medence",
      "Új medence",
      NO_POOL,
    ]);
  });

  it("keeps the order inside a pool: the admin's order, then the name", () => {
    expect(chooserPools(sortDayAnimals(list))[0]!.animals.map((x) => x.name)).toEqual(["Nagy1", "Nagy2"]);
  });
});
