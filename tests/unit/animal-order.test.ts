import { describe, expect, it } from "vitest";
import { byAnimalOrder, moveBy, moveTo, orderAssignments } from "@/lib/animal-order";

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
