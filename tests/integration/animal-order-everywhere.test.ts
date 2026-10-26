// The admin's animal order is the order of every list (Lili 2026-10-26, Caparium channel msg 1564402506396598303; memory 2496
// "a sorrendet minden lista követi"): the day's animals (the feeding sheet, the items, the eating log, the timetable), the feeding
// log's rows and the reports' recipients. Across pools: an animal of a later pool may stand before an animal of an earlier one.
// December 2027, a month no other spec uses (the shared database); the positions are taken off again at the end.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAnimalOrder } from "@/lib/animals";
import { prisma } from "@/lib/db";
import { feedingDayView, saveFeedingItem, setSelection } from "@/lib/feeding";
import { feedingLog } from "@/lib/feeding-log";
import { breakdown } from "@/lib/reports";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const a: Record<string, string> = {};
const feed: Record<string, string> = {};
const unit: Record<string, string> = {};
const day = "2027-12-06";
const at = (t: string) => new Date(`${day}T${t}:00+01:00`);
const MINE = ["Teszt Egy", "Teszt Három", "Teszt Kettő", "Teszt Négy"];

beforeAll(async () => {
  f = await fixtures();
  for (const n of await prisma.animalName.findMany()) a[n.name] = n.animalId;
  for (const n of await prisma.feedName.findMany()) feed[n.name] = n.feedId;
  for (const u of await prisma.unit.findMany()) unit[u.symbol] = u.id;
  // an item is given only to an animal on the day's list
  await setSelection(f.aq1, { requestId: rid(), day, animalIds: MINE.map((n) => a[n]), selected: true }, at("07:50"));
  // the items in the DEFAULT order, so the order of the lists cannot be the order they were entered in
  for (const [i, n] of MINE.entries()) {
    await saveFeedingItem(f.aq1, { requestId: rid(), day, animalId: a[n], feedId: feed["Teszt hal"], quantities: [{ value: "10", unitId: unit.g }] } as Parameters<typeof saveFeedingItem>[1], at(`${String(8 + i).padStart(2, "0")}:00`));
  }
});
afterAll(async () => {
  await prisma.animal.updateMany({ data: { sortOrder: null } });
});

const mineIn = <T extends { name: string }>(list: T[]) => list.filter((x) => MINE.includes(x.name)).map((x) => x.name);

describe("the admin's animal order in every list", () => {
  it("nothing placed: every list is by name, as before the feature", async () => {
    await prisma.animal.updateMany({ data: { sortOrder: null } });
    expect(mineIn((await feedingDayView(day)).animals)).toEqual(["Teszt Egy", "Teszt Három", "Teszt Kettő", "Teszt Négy"]);
    expect((await feedingLog({ from: day, to: day, poolId: null, animalId: null })).rows.map((r) => r.recipient)).toEqual(["Teszt Egy", "Teszt Három", "Teszt Kettő", "Teszt Négy"]);
  });

  it("placed: the day's animals, the log's rows and the reports' recipients all follow the admin's order, across pools", async () => {
    const order = ["Teszt Négy", "Teszt Egy", "Teszt Három", "Teszt Kettő"];
    await setAnimalOrder(f.admin, { requestId: rid(), ids: order.map((n) => a[n]) });

    // the day's animals: the sheet's rows, the items, the eating log and the timetable read this one list; a pool does not come first
    const view = await feedingDayView(day);
    expect(mineIn(view.animals)).toEqual(order);
    const pools = view.animals.filter((x) => MINE.includes(x.name)).map((x) => x.poolName);
    expect(new Set(pools).size, "the animals sit in more than one pool, so this is not a pool order").toBeGreaterThan(1);

    // the feeding log: the rows of the day by the animals' order, not by the time they were entered
    const log = await feedingLog({ from: day, to: day, poolId: null, animalId: null });
    expect(log.rows.map((r) => r.recipient)).toEqual(order);
    // the reports: the by-recipient table
    expect(breakdown(log.entries, log.days, false, log.recipientOrder).byRecipient.map((r) => r.label)).toEqual(order);
    // the eating pattern's rows
    expect(mineIn(log.pattern)).toEqual(order);
  });
});
