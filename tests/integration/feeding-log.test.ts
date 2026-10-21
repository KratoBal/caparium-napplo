// The feeding log on screen (TAK-04): a period filtered by pool and animal, totals in base units, a
// group item counted for its participants, the eating pattern of the same filter. Days in June 2026.
import { beforeAll, describe, expect, it } from "vitest";
import { renamePool } from "@/lib/admin";
import { createLifecycleEvent } from "@/lib/animals";
import { prisma } from "@/lib/db";
import { setEatingStatus } from "@/lib/eating";
import { saveFeedingItem, setSelection } from "@/lib/feeding";
import { feedingLog } from "@/lib/feeding-log";
import { pickValid } from "@/lib/master";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const a: Record<string, string> = {};
const feed: Record<string, string> = {};
const unit: Record<string, string> = {};
let groupId = "";
const at = (d: string, t: string) => new Date(`${d}T${t}:00+02:00`);

beforeAll(async () => {
  f = await fixtures();
  for (const n of await prisma.animalName.findMany()) a[n.name] = n.animalId;
  for (const n of await prisma.feedName.findMany()) feed[n.name] = n.feedId;
  for (const u of await prisma.unit.findMany()) unit[u.symbol] = u.id;
  groupId = (await prisma.animalGroupName.findFirstOrThrow({ where: { name: "Teszt csoport" } })).groupId;
  const d1 = "2026-06-01";
  const now = at(d1, "09:00");
  await setSelection(f.aq1, { requestId: rid(), day: d1, animalIds: [a["Teszt Egy"], a["Teszt Négy"]], selected: true }, now);
  const item = (body: Record<string, unknown>) => saveFeedingItem(f.aq1, { requestId: rid(), day: d1, ...body } as Parameters<typeof saveFeedingItem>[1], now);
  await item({ animalId: a["Teszt Egy"], feedId: feed["Teszt hal"], quantities: [{ value: "1", unitId: unit.kg }] });
  await item({ animalId: a["Teszt Négy"], feedId: feed["Teszt hal"], quantities: [{ value: "100", unitId: unit.g }] });
  await item({ groupId, feedId: feed["Teszt kagyló"], quantities: [{ value: "300", unitId: unit.g }] });
  const d2 = "2026-06-02";
  await setSelection(f.aq1, { requestId: rid(), day: d2, animalIds: [a["Teszt Egy"]], selected: true }, at(d2, "09:00"));
  await setEatingStatus(f.aq1, { requestId: rid(), day: d2, animalId: a["Teszt Egy"], state: "EATEN", vitamin: true }, at(d2, "09:00"));
});

const period = { from: "2026-06-01", to: "2026-06-02" };

describe("the feeding log (TAK-04)", () => {
  it("all items of the period, totals in base units (1 kg is 1000 g)", async () => {
    const log = await feedingLog({ ...period, poolId: null, animalId: null });
    expect(log.rows.map((r) => r.recipient).sort()).toEqual(["Teszt Egy", "Teszt Négy", "Teszt csoport (csoport)"].sort());
    expect([log.filtered, log.totals]).toEqual([false, { g: 1400 }]);
    expect(log.days).toEqual(["2026-06-01", "2026-06-02"]);
  });

  it("by animal: its own items and the group items it took part in", async () => {
    const egy = await feedingLog({ ...period, poolId: null, animalId: a["Teszt Egy"] });
    expect(egy.rows.map((r) => r.recipient).sort()).toEqual(["Teszt Egy", "Teszt csoport (csoport)"].sort());
    // the group's whole amount stays apart (R-8 invents no split), the animal's own is 1000 g
    expect([egy.filtered, egy.own, egy.group]).toEqual([true, { g: 1000 }, { g: 300 }]);
    const negy = await feedingLog({ ...period, poolId: null, animalId: a["Teszt Négy"] });
    expect(negy.rows.map((r) => r.recipient)).toEqual(["Teszt Négy"]);
  });

  it("by pool: where the animal was that day", async () => {
    const log = await feedingLog({ ...period, poolId: f.pool("RAGADOZOS"), animalId: null });
    expect(log.rows.map((r) => r.recipient)).toEqual(["Teszt Négy"]);
    // the name valid that day (another file renames this pool from April: the order of files must not matter)
    const names = await prisma.poolName.findMany({ where: { poolId: f.pool("RAGADOZOS") } });
    expect(log.rows[0].pools).toBe(pickValid(names, new Date("2026-06-01T00:00:00+02:00"))?.displayName);
  });

  it("the pool's name is the one valid on the day, not today's (review of #11: a rename after the day)", async () => {
    // its own animal and its own rename, in a pool no other file renames: the file order cannot matter
    const species = (await prisma.species.findFirstOrThrow({ where: { active: true } })).id;
    const lako = (
      await createLifecycleEvent(
        f.admin,
        { requestId: rid(), type: "ARRIVAL", newAnimal: { speciesId: species, name: "Inkubátor Lakó", sex: "MALE" }, toPoolId: f.pool("INKUBATOR"), occurredAtLocal: "2026-06-04T09:00", reason: "teszt" },
        at("2026-06-04", "10:00"),
      )
    ).animalId;
    const d = "2026-06-05";
    await setSelection(f.aq1, { requestId: rid(), day: d, animalIds: [lako], selected: true }, at(d, "09:00"));
    await saveFeedingItem(f.aq1, { requestId: rid(), day: d, animalId: lako, feedId: feed["Teszt hal"], quantities: [{ value: "10", unitId: unit.g }] }, at(d, "09:00"));
    const before = (await prisma.poolName.findMany({ where: { poolId: f.pool("INKUBATOR") } })).find((n) => n.validTo === null)!.displayName;
    await renamePool(f.admin, { requestId: rid(), poolId: f.pool("INKUBATOR"), name: "Inkubátor (átnevezve)", mode: "change" }, at("2026-06-10", "08:00"));
    const log = await feedingLog({ from: d, to: d, poolId: null, animalId: lako });
    expect(log.rows.map((r) => r.pools)).toEqual([before]);
    expect(before).not.toBe("Inkubátor (átnevezve)");
  });

  it("the eating pattern of the same filter; a period over the limit is refused", async () => {
    const log = await feedingLog({ ...period, poolId: null, animalId: a["Teszt Egy"] });
    expect(log.pattern.map((p) => [p.name, p.cells["2026-06-02"]])).toEqual([["Teszt Egy", { state: "EATEN", vitamin: true, medicine: false }]]);
    await expect(feedingLog({ from: "2026-01-01", to: "2026-12-31", poolId: null, animalId: null })).rejects.toMatchObject({ code: "PERIOD_TOO_LONG" });
  });

  it("a day without data and not on the list is a fasting day on screen too; on the list without a status stays empty (DN-03)", async () => {
    const fasting = { state: "FASTING", vitamin: false, medicine: false };
    const negy = await feedingLog({ ...period, poolId: null, animalId: a["Teszt Négy"] });
    // 06-01 on the list, fed, no eating status: empty; 06-02 not on the list: fasting, without a stored row
    expect(negy.pattern.map((p) => [p.name, p.cells["2026-06-01"], p.cells["2026-06-02"]])).toEqual([["Teszt Négy", undefined, fasting]]);
    // an animal with no status in the whole period is listed at all, both days fasting
    const ketto = await feedingLog({ ...period, poolId: null, animalId: a["Teszt Kettő"] });
    expect(ketto.pattern.map((p) => [p.name, p.cells["2026-06-01"], p.cells["2026-06-02"]])).toEqual([["Teszt Kettő", fasting, fasting]]);
    const egy = await feedingLog({ ...period, poolId: null, animalId: a["Teszt Egy"] });
    expect(egy.pattern[0]!.cells["2026-06-01"]).toBeUndefined();
  });
});
