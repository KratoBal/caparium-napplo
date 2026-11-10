// The feeding sheet's rows (Lili 2026-10-30, msg 1565798789183447103 and 1565799264188371058, task caparium-csoport-sor; acrobot 38947).
//
// Every selected animal is a row of its own, and a group with at least one selected member is a row of its own (the group's one item,
// R-8). The sheet adds a rule: a group stands as ONE row only when EVERY member of it (by that day's membership) is selected (Lili
// 2026-11-10 14:03 UTC, msg 1569714193307799583); then its members get no row of their own, so a group is fed as a group and not twice.
// When only some members are selected, there is no group row and the selected members stand one by one, each in its own row (Lili:
// "ha csak egy része, a kijelölt tagok egyenként"). The rule holds on every day, today's and earlier (msg 1569694421069471836).
// Two exceptions keep it from hiding anything:
//  - a member that already has an individual item that day keeps its row beside a group row, with a short note, so the server's
//    double-feeding refusal (feeding.ts, DOUBLE_FEEDING) never comes from a row that cannot be seen;
//  - a group that already has a group item that day keeps its row even when not every member is selected any more, so the item can
//    still be seen, corrected or invalidated.
// The rule off is what the item form and the "Mai tételek" list use: every selected animal is a recipient there.
// An animal outside every group is a row of its own, as ever. The eating list is not built here: it stays per animal.

export const GROUP_MEMBER_NOTE = "csoporttag, egyedi tétellel";

export type SheetRecipient = {
  key: string;
  label: string;
  animalId?: string;
  groupId?: string;
  color?: string | null;
  /** a short note shown beside the name (a group member kept on the sheet by an individual item) */
  note?: string;
};

type DayAnimalLike = {
  id: string;
  name: string;
  groupId: string | null;
  groupName: string | null;
  selected: boolean;
  sheetColor: string | null;
  groupSheetColor: string | null;
};

export function sheetRecipients(input: {
  animals: DayAnimalLike[];
  /** the day's valid items: an animal's (animalId) keeps a member's row, a group's (groupId) keeps the group's row */
  items: { animalId: string | null; groupId?: string | null }[];
  /** the sheet's rule on: group members have no row of their own; off (the item form's list): every selected animal has one */
  groupRule: boolean;
}): SheetRecipient[] {
  const hasOwnItem = new Set(input.items.flatMap((i) => (i.animalId ? [i.animalId] : [])));
  const hasGroupItem = new Set(input.items.flatMap((i) => (i.groupId ? [i.groupId] : [])));
  const groups = new Map<string, { name: string; members: number; selected: number; color: string | null }>();
  for (const a of input.animals) {
    if (!a.groupId) continue;
    const g = groups.get(a.groupId) ?? { name: a.groupName ?? "?", members: 0, selected: 0, color: a.groupSheetColor };
    g.members += 1;
    if (a.selected) g.selected += 1;
    groups.set(a.groupId, g);
  }
  // with the rule on, a group is a row when all its members are selected (or it already has a group item); off (the item form's list),
  // when any member is, as ever
  const groupRow = (id: string) => {
    const g = groups.get(id)!;
    if (g.selected === 0) return false;
    return input.groupRule ? g.selected === g.members || hasGroupItem.has(id) : true;
  };
  // ... and a member stands in for itself unless its group's row is the whole group's (all members selected)
  const wholeGroup = (id: string) => {
    const g = groups.get(id)!;
    return g.selected === g.members;
  };
  const rows: SheetRecipient[] = [];
  for (const a of input.animals) {
    if (!a.selected) continue;
    const coveredByGroup = input.groupRule && a.groupId !== null && wholeGroup(a.groupId);
    if (coveredByGroup && !hasOwnItem.has(a.id)) continue;
    rows.push({
      key: a.id,
      label: a.name,
      animalId: a.id,
      color: a.sheetColor,
      ...(coveredByGroup ? { note: GROUP_MEMBER_NOTE } : {}),
    });
  }
  for (const [id, g] of groups) {
    if (groupRow(id)) rows.push({ key: `g:${id}`, label: `${g.name} (csoport)`, groupId: id, color: g.color });
  }
  return rows;
}
