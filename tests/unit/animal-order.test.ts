import { describe, expect, it } from "vitest";
import { byAnimalOrder, moveBy, moveTo, orderAssignments, parsePlace, rowAt } from "@/lib/animal-order";

type A = { name: string; sortOrder: number | null };
const byName = (a: A, b: A) => a.name.localeCompare(b.name, "hu");
const names = (list: A[]) => list.map((a) => a.name);

describe("byAnimalOrder", () => {
  it("with nothing placed it is the fallback order, exactly as before the feature", () => {
    const list: A[] = [{ name: "Zéta", sortOrder: null }, { name: "Álfa", sortOrder: null }, { name: "Béta", sortOrder: null }];
    expect(names([...list].sort(byAnimalOrder(byName)))).toEqual(["Álfa", "Béta", "Zéta"]);
  });

  it("placed animals first by their position, the never-placed after them by the fallback", () => {
    const list: A[] = [
      { name: "Álfa", sortOrder: null },
      { name: "Zéta", sortOrder: 0 },
      { name: "Béta", sortOrder: 1 },
      { name: "Gamma", sortOrder: null },
    ];
    expect(names([...list].sort(byAnimalOrder(byName)))).toEqual(["Zéta", "Béta", "Álfa", "Gamma"]);
  });

  it("position 0 is a position, not 'missing'", () => {
    const list: A[] = [{ name: "Álfa", sortOrder: null }, { name: "Zéta", sortOrder: 0 }];
    expect(names([...list].sort(byAnimalOrder(byName)))).toEqual(["Zéta", "Álfa"]);
  });

  it("an equal position falls back to the name", () => {
    const list: A[] = [{ name: "Béta", sortOrder: 2 }, { name: "Álfa", sortOrder: 2 }];
    expect(names([...list].sort(byAnimalOrder(byName)))).toEqual(["Álfa", "Béta"]);
  });
});

describe("moveBy / moveTo", () => {
  const ids = ["a", "b", "c", "d"];
  it("moves one step, and leaves the edges alone", () => {
    expect(moveBy(ids, "c", -1)).toEqual(["a", "c", "b", "d"]);
    expect(moveBy(ids, "b", 1)).toEqual(["a", "c", "b", "d"]);
    expect(moveBy(ids, "a", -1)).toEqual(ids);
    expect(moveBy(ids, "d", 1)).toEqual(ids);
  });
  it("does not touch the input", () => {
    const copy = [...ids];
    moveBy(copy, "c", -1);
    moveTo(copy, "a", 3);
    expect(copy).toEqual(ids);
  });
  it("moveTo lands the animal on the index, the others keep their relative order", () => {
    expect(moveTo(ids, "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveTo(ids, "d", 0)).toEqual(["d", "a", "b", "c"]);
  });
  it("moveTo clamps an index outside the list, and ignores an unknown animal", () => {
    expect(moveTo(ids, "a", 99)).toEqual(["b", "c", "d", "a"]);
    expect(moveTo(ids, "a", -5)).toEqual(ids);
    expect(moveTo(ids, "zzz", 1)).toEqual(ids);
  });
});

describe("orderAssignments", () => {
  it("the submitted order first, the others after it in their own order, no gaps", () => {
    expect(orderAssignments(["c", "a"], ["b", "a", "d", "c"])).toEqual([
      { id: "c", sortOrder: 0 },
      { id: "a", sortOrder: 1 },
      { id: "b", sortOrder: 2 },
      { id: "d", sortOrder: 3 },
    ]);
  });
  it("with nothing else it is just the submitted list", () => {
    expect(orderAssignments(["x", "y"], [])).toEqual([{ id: "x", sortOrder: 0 }, { id: "y", sortOrder: 1 }]);
  });
});

// Lili 2026-10-26 (msg 1564366437148270735): the drag handle and the place number
describe("rowAt: the row under the pointer", () => {
  const centers = [20, 60, 100, 140];
  it("is the row with the nearest center, through the gaps and past both ends", () => {
    expect(rowAt(centers, 61)).toBe(1);
    expect(rowAt(centers, 79)).toBe(1);
    expect(rowAt(centers, 81)).toBe(2);
    expect(rowAt(centers, -300)).toBe(0);
    expect(rowAt(centers, 900)).toBe(3);
  });
  it("is -1 for no rows", () => {
    expect(rowAt([], 10)).toBe(-1);
  });
});

describe("parsePlace: the place typed into a row", () => {
  it("takes a whole number from 1 to the count, as a zero-based index", () => {
    expect(parsePlace("1", 5)).toBe(0);
    expect(parsePlace(" 5 ", 5)).toBe(4);
  });
  it("takes nothing else: a typo moves no animal", () => {
    for (const bad of ["", "0", "6", "-1", "2,5", "2.5", "két", "1e1", "12345"]) expect(parsePlace(bad, 5), `"${bad}"`).toBeNull();
  });
});
