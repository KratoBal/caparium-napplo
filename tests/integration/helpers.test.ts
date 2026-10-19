// The helpers' quick questions (AST-01..AST-03): answered from the page's own data; the stock alert only
// with the dosing module (R-17). Days in August 2028 (a month no other integration test uses: the database is shared across files).
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createChemical, saveDosing } from "@/lib/dosing";
import { setEatingStatus } from "@/lib/eating";
import { saveFeedingItem, setSelection } from "@/lib/feeding";
import { feedingHelper, waterHelper } from "@/lib/helpers";
import { createMeasurement } from "@/lib/measurements";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const a: Record<string, string> = {};
const feed: Record<string, string> = {};
const unit: Record<string, string> = {};
const at = (local: string) => new Date(`${local}:00+02:00`);
const answer = (h: { questions: { q: string; a: string }[] }, q: string) => h.questions.find((x) => x.q === q)!.a;

beforeAll(async () => {
  f = await fixtures();
  for (const n of await prisma.animalName.findMany()) a[n.name] = n.animalId;
  for (const n of await prisma.feedName.findMany()) feed[n.name] = n.feedId;
  for (const u of await prisma.unit.findMany()) unit[u.symbol] = u.id;
});

describe("Antennarius, the water helper", () => {
  it("what is left, what is out of range, whether the deadline passed; the stock alert only with the right", async () => {
    await createMeasurement(f.aq1, { requestId: rid(), groupId: f.group("NAPI_NAGY"), poolId: f.pool("NAGY"), parameterId: f.param("PH"), value: "5", measuredAtLocal: "2028-08-12T09:00" }, at("2028-08-12T09:00"));
    const h = await waterHelper(false, at("2028-08-12T15:00"));
    expect(answer(h, "Mi van még hátra ma?")).toContain("Kismedence");
    expect(answer(h, "Mi van még hátra ma?")).not.toContain("Nagymedence");
    expect(answer(h, "Melyik érték lóg ki ma?")).toMatch(/Nagymedence .*5 \(alacsony\)/);
    expect(answer(h, "Késésben vagyunk?")).toContain("Elmúlt a határidő");
    expect(h.alert).toBeUndefined();
    // AST-03: a chemical below zero speaks up, for someone who may see the stock
    await createChemical(f.admin, { requestId: rid(), name: "Teszt segítő-só", stockUnitId: unit.kg }, at("2028-08-12T08:00"));
    const chem = (await prisma.chemicalName.findFirstOrThrow({ where: { name: "Teszt segítő-só" } })).chemicalId;
    await saveDosing(f.aq1, { requestId: rid(), performedAtLocal: "2028-08-12T10:00", poolId: f.pool("SOZO"), chemicalId: chem, quantity: "1", unitId: unit.kg }, at("2028-08-12T10:00"));
    const first = await waterHelper(true, at("2028-08-12T15:00"));
    expect(first.alert).toContain("Teszt segítő-só");
    expect(first.alertKey).toContain("Teszt segítő-só");
    const off = await waterHelper(false, at("2028-08-12T15:00"));
    expect([off.alert, off.alertKey]).toEqual([undefined, undefined]);
    // another dose moves the level and so the text, not the key: it does not open again (review of #20, b)
    await saveDosing(f.aq1, { requestId: rid(), performedAtLocal: "2028-08-12T16:00", poolId: f.pool("SOZO"), chemicalId: chem, quantity: "1", unitId: unit.kg }, at("2028-08-12T16:00"));
    const second = await waterHelper(true, at("2028-08-12T17:00"));
    expect(second.alert).not.toBe(first.alert);
    expect(second.alertKey).toBe(first.alertKey);
  });
});

describe("Zebracápa, the feeding helper", () => {
  it("who is on the list, who did not eat, what one animal got", async () => {
    const d = "2028-08-13";
    await setSelection(f.aq1, { requestId: rid(), day: d, animalIds: [a["Teszt Egy"]], selected: true }, at(`${d}T08:00`));
    await saveFeedingItem(f.aq1, { requestId: rid(), day: d, animalId: a["Teszt Egy"], feedId: feed["Teszt hal"], quantities: [{ value: "10", unitId: unit.g }] }, at(`${d}T09:00`));
    await setEatingStatus(f.aq1, { requestId: rid(), day: d, animalId: a["Teszt Egy"], state: "NOT_EATEN" }, at(`${d}T10:00`));
    const h = await feedingHelper(false, at(`${d}T11:00`));
    expect(answer(h, "Ki van ma a listán?")).toBe("Teszt Egy.");
    expect(answer(h, "Ki nem evett ma rendesen?")).toBe("Teszt Egy (nem evett).");
    expect(answer(h, "Kész a mai lista?")).toContain("Még nincs kész");
    expect(h.perAnimal!.find((p) => p.name === "Teszt Egy")!.a).toBe("Ma kapott: Teszt hal 10 g. Evés: nem evett.");
    expect(h.perAnimal!.find((p) => p.name === "Teszt Négy")!.a).toBe("Ma még nem kapott semmit.");
  });
});
