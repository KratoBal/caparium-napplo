// The helpers' quick questions (AST-01..AST-03): answered from the page's own data; the stock alert only
// with the dosing module (R-17). Days in August 2028 (a month no other integration test uses: the database is shared across files).
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createChemical, saveDosing } from "@/lib/dosing";
import { setEatingStatus } from "@/lib/eating";
import { saveFeedingItem, setSelection } from "@/lib/feeding";
import { saveIntakeItem } from "@/lib/feed-intake";
import { createFeed } from "@/lib/feeds";
import { feedingHelper, waterHelper } from "@/lib/helpers";
import { saveWithdrawalItem } from "@/lib/withdrawal";
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
    // card 8b22c3c2: after the deadline the missed measurement is urgent, without the stock right too
    expect(h.alert).toMatch(/^Még nem vagyunk kész mára! .*Kismedence/);
    expect(h.alertKind).toBe("measurement"); // the figure takes the "feladatok" picture (Lili 2026-10-29, item 10)
    expect(h.alertKey).toBe("meres:2028-08-12");
    const before = await waterHelper(false, at("2028-08-12T13:59"));
    expect([before.alert, before.alertKey]).toEqual([undefined, undefined]);
    // a pool measured since changes the text, not the key: the alert does not speak again on the water page
    // while the missing ones are being recorded (barracuda on #109; the stock alert's rule, review of #20 b)
    const missing = h.alert!.slice("Még nem vagyunk kész mára! ".length, -1).split(",").map((x) => x.trim());
    expect(missing.length).toBeGreaterThan(1);
    const kis = await prisma.groupMembership.findMany({ where: { groupId: f.group("NAPI_KIS") }, include: { pool: { include: { names: true } } } });
    const one = kis.find((m) => missing.includes(m.pool.names[0]?.displayName ?? ""))!;
    await createMeasurement(f.aq1, { requestId: rid(), groupId: f.group("NAPI_KIS"), poolId: one.poolId, parameterId: f.param("SAL"), value: "35", measuredAtLocal: "2028-08-12T15:10" }, at("2028-08-12T15:10"));
    const later = await waterHelper(false, at("2028-08-12T15:20"));
    expect(later.alertKey).toBe(h.alertKey);
    expect(later.alert).not.toContain(one.pool.names[0]!.displayName);
    expect(later.alert).toContain(missing.find((n) => n !== one.pool.names[0]!.displayName)!);
    // AST-03: a chemical below zero speaks up, for someone who may see the stock
    await createChemical(f.admin, { requestId: rid(), name: "Teszt segítő-só", stockUnitId: unit.kg }, at("2028-08-12T08:00"));
    const chem = (await prisma.chemicalName.findFirstOrThrow({ where: { name: "Teszt segítő-só" } })).chemicalId;
    await saveDosing(f.aq1, { requestId: rid(), performedAtLocal: "2028-08-12T10:00", poolId: f.pool("SOZO"), chemicalId: chem, quantity: "1", unitId: unit.kg }, at("2028-08-12T10:00"));
    const first = await waterHelper(true, at("2028-08-12T15:00"));
    expect(first.alert).toContain("Teszt segítő-só");
    expect(first.alertKey).toContain("Teszt segítő-só");
    // both urgent notices in one alert, the measurement first; their keys joined
    expect(first.alert).toMatch(/^Még nem vagyunk kész mára!.*Vészesen fogy a\(z\) .*Teszt segítő-só.*!$/);
    expect(first.alertKind).toBe("measurement"); // both: the measurement first, as in the text
    expect(first.alertKey).toMatch(/^meres:2028-08-12#.*Teszt segítő-só/);
    const off = await waterHelper(false, at("2028-08-12T15:00"));
    expect(off.alert).not.toContain("Teszt segítő-só");
    expect(off.alertKey).not.toContain("Teszt segítő-só");
    // another dose moves the level and so the text, not the key: it does not open again (review of #20, b)
    await saveDosing(f.aq1, { requestId: rid(), performedAtLocal: "2028-08-12T16:00", poolId: f.pool("SOZO"), chemicalId: chem, quantity: "1", unitId: unit.kg }, at("2028-08-12T16:00"));
    const second = await waterHelper(true, at("2028-08-12T17:00"));
    expect(second.alert).not.toBe(first.alert);
    expect(second.alertKey).toBe(first.alertKey);
  });
});

describe("the alert's picture (Lili 2026-10-29, item 10)", () => {
  it("a chemical alone takes the chemical picture; the feeding figure says it in the same words and never speaks of measurements", async () => {
    // the dose of the water test above left "Teszt segítő-só" below zero
    const w = await waterHelper(true, at("2028-08-12T12:00")); // before the deadline: only the stock
    expect(w.alertKind).toBe("stock");
    expect(w.alert).toMatch(/^Vészesen fogy a\(z\) .*Teszt segítő-só.*!$/);
    const h = await feedingHelper(true, at("2028-08-12T17:00"));
    expect(h.alertKind).toBe("stock");
    expect(h.alert).toMatch(/^Vészesen fogy a\(z\) /);
    expect((await feedingHelper(false, at("2028-08-12T17:00"))).alertKind).toBeUndefined();
  });
});

describe("the feed stock alert (Takarmányhűtő, Lili 2026-10-29)", () => {
  it("a feed with an intake at zero speaks, with its own picture and key; one with no intake, or without the right, does not", async () => {
    const type = await prisma.feedType.findUniqueOrThrow({ where: { code: "RAK" } });
    const mk = async (name: string) => (await createFeed(f.admin, { requestId: rid(), typeId: type.id, name, dimensions: ["MASS"], defaultUnitId: unit.g }, at("2028-08-01T08:00"))).id;
    const received = await mk("Teszt segítő-hűtő");
    const never = await mk("Teszt segítő-hűtő nincs bevétel");
    const day = "2028-08-14";
    const now = at(`${day}T12:00`);
    const intake = (feedId: string, value: string) =>
      saveIntakeItem(f.aq1, { requestId: rid(), day, feedId, quantities: [{ value, unitId: unit.g }] }, at(`${day}T08:00`));
    const take = (feedId: string, value: string) =>
      saveWithdrawalItem(f.aq1, { requestId: rid(), day, feedId, quantities: [{ value, unitId: unit.g }] }, at(`${day}T09:00`));
    const both = { chemicals: false, feed: true };

    await intake(received, "100");
    // a stock with no withdrawal at all has no estimate and is above zero: no alert for it
    expect((await feedingHelper(both, now)).alert ?? "").not.toContain("Teszt segítő-hűtő");
    // all of it taken: at zero. Withdrawals alone on another feed: no intake, no stock, no alert
    await take(received, "100");
    await take(never, "40");
    const h = await feedingHelper(both, now);
    expect(h.alertKind).toBe("feed");
    expect(h.alert).toMatch(/Vészesen fogy a\(z\) .*Teszt segítő-hűtő \(0 g\)/);
    expect(h.alert).not.toContain("nincs bevétel");
    expect(h.alertKey).toMatch(/^takarmany:/);
    // the water helper says the same, with the same key
    const w = await waterHelper(both, at(`${day}T12:00`));
    expect(w.alert).toContain("Teszt segítő-hűtő (0 g)");
    expect(w.alertKey).toBe(h.alertKey);
    // without the withdrawal right, or with the chemicals' right alone (a plain boolean), nothing about feed
    expect((await feedingHelper({ chemicals: true, feed: false }, now)).alert ?? "").not.toContain("Teszt segítő-hűtő");
    expect((await feedingHelper(true, now)).alert ?? "").not.toContain("Teszt segítő-hűtő");
    // a new intake lifts it: the alert is gone for this feed
    await intake(received, "5000");
    expect((await feedingHelper(both, now)).alert ?? "").not.toContain("Teszt segítő-hűtő (");
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
