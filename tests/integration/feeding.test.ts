// The daily list and the feeding items (adatmodell 8., 9.; EGY-01..EGY-12, TAK-07, R-3, R-7, R-8, T-21).
// Days in January 2026 (the seeded test animals arrived on 2026-01-01): no other file writes there.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { feedingDayView, finalizeList, invalidateFeedingItem, itemSchema, saveFeedingItem, setSelection } from "@/lib/feeding";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const a: Record<string, string> = {};
let groupId = "";
const feed: Record<string, string> = {};
const unit: Record<string, string> = {};

beforeAll(async () => {
  f = await fixtures();
  for (const n of await prisma.animalName.findMany()) a[n.name] = n.animalId;
  groupId = (await prisma.animalGroupName.findFirstOrThrow({ where: { name: "Teszt csoport" } })).groupId;
  for (const n of await prisma.feedName.findMany()) feed[n.name] = n.feedId;
  for (const u of await prisma.unit.findMany()) unit[u.symbol] = u.id;
});

const at = (d: string, t: string) => new Date(`${d}T${t}:00+01:00`);

async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e, `expected ${code}`).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
  return e as AppError;
}

const select = (d: string, names: string[], selected = true, actor = f?.aq1, extra = {}) =>
  setSelection(actor, { requestId: rid(), day: d, animalIds: names.map((n) => a[n]), selected, ...extra }, at(d, "08:00"));

describe("the daily list (EGY-01, T-01, R-7)", () => {
  it("is common: another aquarist may remove a row; finalizing an empty list needs a confirmation", async () => {
    const d = "2026-01-05";
    await select(d, ["Teszt Egy", "Teszt Kettő"]);
    await select(d, ["Teszt Kettő"], false, f.aq2);
    expect((await feedingDayView(d)).animals.filter((x) => x.selected).map((x) => x.name)).toEqual(["Teszt Egy"]);
    const empty = "2026-01-06";
    await expectCode(finalizeList(f.aq1, { requestId: rid(), day: empty }, at(empty, "09:00")), "EMPTY_LIST");
    await finalizeList(f.aq1, { requestId: rid(), day: empty, confirmEmpty: true }, at(empty, "09:00"));
    expect((await feedingDayView(empty)).listState).toBe("FINALIZED");
  });

  it("an earlier day is admin work with a reason", async () => {
    await expectCode(setSelection(f.aq1, { requestId: rid(), day: "2026-01-07", animalIds: [a["Teszt Egy"]], selected: true }, at("2026-01-08", "08:00")), "NOT_TODAY");
  });
});

describe("feeding items (EGY-02, EGY-06, TAK-07, T-08)", () => {
  it("only for a selected animal; pieces and grams in one item, never two of one dimension", async () => {
    const d = "2026-01-09";
    const base = { day: d, animalId: a["Teszt Három"], feedId: feed["Litopenaeus vannamei"] };
    await expectCode(saveFeedingItem(f.aq1, { requestId: rid(), ...base, quantities: [{ value: "5", unitId: unit.db }] }, at(d, "09:00")), "NOT_SELECTED");
    await select(d, ["Teszt Három"]);
    await expectCode(
      saveFeedingItem(f.aq1, { requestId: rid(), ...base, quantities: [{ value: "5", unitId: unit.g }, { value: "1", unitId: unit.kg }] }, at(d, "09:00")),
      "ONE_PER_DIMENSION",
    );
    await expectCode(saveFeedingItem(f.aq1, { requestId: rid(), ...base, quantities: [{ value: "5", unitId: unit.ml }] }, at(d, "09:00")), "UNIT_DIMENSION");
    const ok = await saveFeedingItem(f.aq1, { requestId: rid(), ...base, quantities: [{ value: "6", unitId: unit.db }, { value: "42,5", unitId: unit.g }] }, at(d, "09:00"));
    const v = await feedingDayView(d);
    expect(v.totals[a["Teszt Három"]]).toEqual({ db: 6, g: 42.5 });
    // a second item for the same cell is a conflict, not a silent duplicate
    await expectCode(saveFeedingItem(f.aq2, { requestId: rid(), ...base, quantities: [{ value: "1", unitId: unit.db }] }, at(d, "09:05")), "CELL_TAKEN");
    // edit with the version, then a stale version is a conflict
    await saveFeedingItem(f.aq1, { requestId: rid(), ...base, itemId: (ok as { itemId: string }).itemId, expectedVersion: 1, quantities: [{ value: "7", unitId: unit.db }] }, at(d, "09:10"));
    await expectCode(
      saveFeedingItem(f.aq1, { requestId: rid(), ...base, itemId: (ok as { itemId: string }).itemId, expectedVersion: 1, quantities: [{ value: "8", unitId: unit.db }] }, at(d, "09:11")),
      "VERSION_CONFLICT",
    );
  });

  it("a group item keeps who was selected (R-8); the same feed cannot come twice to one animal (T-21)", async () => {
    const d = "2026-01-12";
    await select(d, ["Teszt Egy"]);
    const r = await saveFeedingItem(f.aq1, { requestId: rid(), day: d, groupId, feedId: feed["Teszt hal"], quantities: [{ value: "300", unitId: unit.g }] }, at(d, "09:00"));
    const parts = await prisma.feedingParticipant.findMany({ where: { itemId: (r as { itemId: string }).itemId } });
    expect(parts.map((p) => p.animalId)).toEqual([a["Teszt Egy"]]);
    await expectCode(
      saveFeedingItem(f.aq1, { requestId: rid(), day: d, animalId: a["Teszt Egy"], feedId: feed["Teszt hal"], quantities: [{ value: "50", unitId: unit.g }] }, at(d, "09:05")),
      "DOUBLE_FEEDING",
    );
    // a later selection of another member does not rewrite the snapshot
    await select(d, ["Teszt Kettő"]);
    expect(await prisma.feedingParticipant.count({ where: { itemId: (r as { itemId: string }).itemId } })).toBe(1);
  });

  it("removing an animal with records needs a confirmation and invalidates them (R-3)", async () => {
    const d = "2026-01-13";
    await select(d, ["Teszt Három"]);
    const r = await saveFeedingItem(f.aq1, { requestId: rid(), day: d, animalId: a["Teszt Három"], feedId: feed["Teszt kagyló"], quantities: [{ value: "20", unitId: unit.g }] }, at(d, "09:00"));
    await expectCode(select(d, ["Teszt Három"], false), "HAS_RECORDS");
    await select(d, ["Teszt Három"], false, f.aq1, { confirmCascade: true });
    const it = await prisma.feedingItem.findUniqueOrThrow({ where: { id: (r as { itemId: string }).itemId } });
    expect(it).toMatchObject({ status: "INVALIDATED", invalidationReason: "kivéve a napi listából" });
  });

  it("an aquarist invalidates only an own item of today", async () => {
    const d = "2026-01-14";
    await select(d, ["Teszt Négy"]);
    const r = (await saveFeedingItem(f.aq1, { requestId: rid(), day: d, animalId: a["Teszt Négy"], feedId: feed["Teszt hal"], quantities: [{ value: "10", unitId: unit.g }] }, at(d, "09:00"))) as { itemId: string };
    await expectCode(invalidateFeedingItem(f.aq2, r.itemId, { requestId: rid(), expectedVersion: 1, reason: "nem az enyém" }, at(d, "10:00")), "NOT_OWN");
    await invalidateFeedingItem(f.aq1, r.itemId, { requestId: rid(), expectedVersion: 1, reason: "elírás" }, at(d, "10:00"));
    expect((await feedingDayView(d)).items).toHaveLength(0);
  });

  it("removing a member of a group item: counted in the confirmation, the item and its snapshot stay; a group left without a selected member is shown (R-8)", async () => {
    const d = "2026-01-15";
    await select(d, ["Teszt Egy", "Teszt Kettő"]);
    const r = (await saveFeedingItem(f.aq1, { requestId: rid(), day: d, groupId, feedId: feed["Teszt hal"], quantities: [{ value: "200", unitId: unit.g }] }, at(d, "09:00"))) as { itemId: string };
    const e = await expectCode(select(d, ["Teszt Egy"], false), "HAS_RECORDS");
    expect(e.details).toMatchObject({ items: 0, statuses: 0, groupItems: 1 });
    const first = (await select(d, ["Teszt Egy"], false, f.aq1, { confirmCascade: true })) as { groupsWithoutSelected: string[] };
    expect(first.groupsWithoutSelected).toEqual([]);
    expect(await prisma.feedingParticipant.count({ where: { itemId: r.itemId } })).toBe(2);
    const second = (await select(d, ["Teszt Kettő"], false, f.aq1, { confirmCascade: true })) as { groupsWithoutSelected: string[] };
    expect(second.groupsWithoutSelected).toEqual([r.itemId]);
    expect((await prisma.feedingItem.findUniqueOrThrow({ where: { id: r.itemId } })).status).toBe("VALID");
    expect((await feedingDayView(d)).items.find((i) => i.id === r.itemId)?.noSelectedMember).toBe(true);
  });

  it("the other feed's name cannot start like a formula (it goes to the Excel and may go to a CSV)", () => {
    const base = { requestId: rid(), day: "2026-01-15", animalId: a["Teszt Egy"], feedId: feed["Egyéb"], quantities: [{ value: "1", unitId: unit.g }] };
    expect(itemSchema.safeParse({ ...base, otherName: "=HYPERLINK(1)" }).success).toBe(false);
    expect(itemSchema.safeParse({ ...base, otherName: "tintahal-fej" }).success).toBe(true);
  });
});
