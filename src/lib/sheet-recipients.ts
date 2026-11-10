// The feeding sheet's rows (Lili 2026-10-30, msg 1565798789183447103 and 1565799264188371058, task caparium-csoport-sor; acrobot 38947).
//
// Every selected animal is a row of its own, and a group with at least one selected member is a row of its own (the group's one item,
// R-8). The sheet adds a rule: an animal that is in a group (by that day's membership) gets no row of its own, the group's row stands
// for it, so a group is fed as a group and not twice. Since 2026-11-10 (Lili, msg 1569694421069471836: "konkrét csoportnál csak azt
// lássam") the rule holds on an earlier day's sheet too, not only today's. One exception keeps it from hiding anything:
//  - an animal that already has an individual item that day keeps its row (it can still be corrected or invalidated there) with a short
//    note, so the server's double-feeding refusal (feeding.ts, DOUBLE_FEEDING) never comes from a row that cannot be seen.
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
  /** the day's valid items: those of an animal (animalId set) keep a group member on the sheet */
  items: { animalId: string | null }[];
  /** the sheet's rule on: group members have no row of their own; off (the item form's list): every selected animal has one */
  groupRule: boolean;
}): SheetRecipient[] {
  const hasOwnItem = new Set(input.items.flatMap((i) => (i.animalId ? [i.animalId] : [])));
  const groups = new Map<string, { name: string; selected: number; color: string | null }>();
  for (const a of input.animals) {
    if (!a.groupId) continue;
    const g = groups.get(a.groupId) ?? { name: a.groupName ?? "?", selected: 0, color: a.groupSheetColor };
    if (a.selected) g.selected += 1;
    groups.set(a.groupId, g);
  }
  const rows: SheetRecipient[] = [];
  for (const a of input.animals) {
    if (!a.selected) continue;
    const member = a.groupId !== null;
    if (input.groupRule && member && !hasOwnItem.has(a.id)) continue;
    rows.push({
      key: a.id,
      label: a.name,
      animalId: a.id,
      color: a.sheetColor,
      ...(input.groupRule && member ? { note: GROUP_MEMBER_NOTE } : {}),
    });
  }
  for (const [id, g] of groups) {
    if (g.selected > 0) rows.push({ key: `g:${id}`, label: `${g.name} (csoport)`, groupId: id, color: g.color });
  }
  return rows;
}
