// The feeding log on screen (TAK-04): a period filtered by pool and animal, totals in base units, a
// group item counted for its participants, the eating pattern of the same filter. Days in June 2026.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { setEatingStatus } from "@/lib/eating";
import { saveFeedingItem, setSelection } from "@/lib/feeding";
import { feedingLog } from "@/lib/feeding-log";
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
    expect(log.totals).toEqual({ g: 1400 });
    expect(log.days).toEqual(["2026-06-01", "2026-06-02"]);
  });

  it("by animal: its own items and the group items it took part in", async () => {
    const egy = await feedingLog({ ...period, poolId: null, animalId: a["Teszt Egy"] });
    expect(egy.rows.map((r) => r.recipient).sort()).toEqual(["Teszt Egy", "Teszt csoport (csoport)"].sort());
    expect(egy.totals).toEqual({ g: 1300 });
    const negy = await feedingLog({ ...period, poolId: null, animalId: a["Teszt Négy"] });
    expect(negy.rows.map((r) => r.recipient)).toEqual(["Teszt Négy"]);
  });

  it("by pool: where the animal was that day", async () => {
    const log = await feedingLog({ ...period, poolId: f.pool("RAGADOZOS"), animalId: null });
    expect(log.rows.map((r) => r.recipient)).toEqual(["Teszt Négy"]);
    expect(log.rows[0].pools).toBe("Ragadozós");
  });

  it("the eating pattern of the same filter; a period over the limit is refused", async () => {
    const log = await feedingLog({ ...period, poolId: null, animalId: a["Teszt Egy"] });
    expect(log.pattern.map((p) => [p.name, p.cells["2026-06-02"]])).toEqual([["Teszt Egy", { state: "EATEN", vitamin: true, medicine: false }]]);
    await expect(feedingLog({ from: "2026-01-01", to: "2026-12-31", poolId: null, animalId: null })).rejects.toMatchObject({ code: "PERIOD_TOO_LONG" });
  });
});
