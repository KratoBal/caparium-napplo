// The feeding sheet's rows (src/lib/sheet-recipients.ts; Lili 2026-10-30, task caparium-csoport-sor): today a group member has no row of its
// own unless it already has an individual item; an animal outside every group is a row of its own; an earlier day is as it was.
import { describe, expect, it } from "vitest";
import { GROUP_MEMBER_NOTE, sheetRecipients } from "@/lib/sheet-recipients";

const animal = (id: string, name: string, groupId: string | null, selected = true) => ({
  id,
  name,
  groupId,
  groupName: groupId ? "Hímek" : null,
  selected,
  sheetColor: null,
  groupSheetColor: groupId ? "BLUE" : null,
});
const ANIMALS = [animal("a1", "Gnocchi", "g1"), animal("a2", "Nokedli", "g1"), animal("a3", "Philleas", null), animal("a4", "Tango", null, false)];

const keys = (rows: { key: string }[]) => rows.map((r) => r.key);

describe("the feeding sheet's rows", () => {
  it("today a group member has no row of its own: the group's row stands for it, a lone animal keeps its row", () => {
    const rows = sheetRecipients({ animals: ANIMALS, items: [], groupRule: true });
    expect(keys(rows)).toEqual(["a3", "g:g1"]);
    expect(rows.map((r) => r.label)).toEqual(["Philleas", "Hímek (csoport)"]);
    expect(rows.every((r) => r.note === undefined)).toBe(true);
  });

  it("a group member that already has an individual item keeps its row, with the note; the others of the group do not", () => {
    const rows = sheetRecipients({ animals: ANIMALS, items: [{ animalId: "a2" }, { animalId: null }], groupRule: true });
    expect(keys(rows)).toEqual(["a2", "a3", "g:g1"]);
    expect(rows[0]!.note).toBe(GROUP_MEMBER_NOTE);
    expect(GROUP_MEMBER_NOTE).toBe("csoporttag, egyedi tétellel");
    expect(rows[1]!.note).toBeUndefined();
  });

  it("an earlier day (the rule off) is as it was: every selected animal has its row, and the group's row after them", () => {
    const rows = sheetRecipients({ animals: ANIMALS, items: [{ animalId: "a2" }], groupRule: false });
    expect(keys(rows)).toEqual(["a1", "a2", "a3", "g:g1"]);
    expect(rows.every((r) => r.note === undefined)).toBe(true);
  });

  it("the group's row needs at least one selected member, as before", () => {
    const none = ANIMALS.map((a) => (a.groupId ? { ...a, selected: false } : a));
    expect(keys(sheetRecipients({ animals: none, items: [], groupRule: true }))).toEqual(["a3"]);
    const one = ANIMALS.map((a) => (a.id === "a2" ? { ...a, selected: false } : a));
    expect(keys(sheetRecipients({ animals: one, items: [], groupRule: true }))).toEqual(["a3", "g:g1"]);
  });

  it("an animal that is not selected has no row, in a group or out of it", () => {
    const rows = sheetRecipients({ animals: ANIMALS, items: [{ animalId: "a4" }], groupRule: true });
    expect(keys(rows)).not.toContain("a4");
  });

  it("the rows as the item form and the list know them (rule off) are what the page built before: key, label, ids and colours", () => {
    const rows = sheetRecipients({ animals: [{ ...animal("a1", "Gnocchi", "g1"), sheetColor: "GREEN" }], items: [], groupRule: false });
    expect(rows).toEqual([
      { key: "a1", label: "Gnocchi", animalId: "a1", color: "GREEN" },
      { key: "g:g1", label: "Hímek (csoport)", groupId: "g1", color: "BLUE" },
    ]);
  });
});
