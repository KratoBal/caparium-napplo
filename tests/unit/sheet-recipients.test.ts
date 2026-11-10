// The feeding sheet's rows (src/lib/sheet-recipients.ts; Lili 2026-10-30, task caparium-csoport-sor; 2026-11-10 msg 1569714193307799583):
// a group is one row only when every member is selected, and then a member has no row of its own unless it has an individual item; a
// group with only some members selected has no row, its selected members stand one by one (a group item that day keeps the group's
// row); on every day; an animal outside every group is a row of its own; the rule off is the item form's list.
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

  it("the rule off (the item form's list) has every selected animal, and the group's row after them", () => {
    const rows = sheetRecipients({ animals: ANIMALS, items: [{ animalId: "a2" }], groupRule: false });
    expect(keys(rows)).toEqual(["a1", "a2", "a3", "g:g1"]);
    expect(rows.every((r) => r.note === undefined)).toBe(true);
  });

  it("no member selected: no group row", () => {
    const none = ANIMALS.map((a) => (a.groupId ? { ...a, selected: false } : a));
    expect(keys(sheetRecipients({ animals: none, items: [], groupRule: true }))).toEqual(["a3"]);
  });

  it("only some members selected: no group row, the selected members one by one, without the note (Lili 2026-11-10)", () => {
    const one = ANIMALS.map((a) => (a.id === "a2" ? { ...a, selected: false } : a));
    const rows = sheetRecipients({ animals: one, items: [], groupRule: true });
    expect(keys(rows)).toEqual(["a1", "a3"]);
    expect(rows.every((r) => r.note === undefined)).toBe(true);
  });

  it("only some members selected, but the group already has a group item that day: its row stays, beside the selected member's", () => {
    const one = ANIMALS.map((a) => (a.id === "a2" ? { ...a, selected: false } : a));
    const rows = sheetRecipients({ animals: one, items: [{ animalId: null, groupId: "g1" }], groupRule: true });
    expect(keys(rows)).toEqual(["a1", "a3", "g:g1"]);
  });

  it("an unselected member that is not on the day's list still counts as a member: the group is not whole without it", () => {
    // three members, two selected
    const three = [...ANIMALS, animal("a5", "Galuska", "g1", false)];
    expect(keys(sheetRecipients({ animals: three, items: [], groupRule: true }))).toEqual(["a1", "a2", "a3"]);
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
