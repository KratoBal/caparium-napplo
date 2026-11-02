// Old data keyed in back to 2018 (Lili 2026-11-02; acrobot 40195 survey, 40205 decision; task caparium-regi-datum-javitas): an entry
// dated long ago must not change today's numbers, must not be refused for a pool added since, must not make an empty old day read
// as fasting, and may name a former colleague. Own chemical, feed and pool, so other files' rows do not move the stock's start.
// Days in 2019, February 2026 (after the synthetic animals' arrival) and 2031, used by no other integration file.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { createChemical, recordMovement, saveDosing, stockLevels } from "@/lib/dosing";
import { feedBalance, feedStock, saveIntakeItem } from "@/lib/feed-intake";
import { setDayFeeds } from "@/lib/feeding";
import { feedingLog } from "@/lib/feeding-log";
import { createFeed } from "@/lib/feeds";
import { createMeasurement } from "@/lib/measurements";
import { runningOut } from "@/lib/notices";
import { setPoolPeriods } from "@/lib/pool-periods";
import { saveWithdrawalItem } from "@/lib/withdrawal";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const unit: Record<string, string> = {};
const animal: Record<string, string> = {};
const feed: Record<string, string> = {};
// "now": a day in 2031, so the 2019 entries are years old and nothing of today's real date is involved
const NOW = new Date("2031-02-11T10:00:00+01:00");
const later = (min: number) => new Date(NOW.getTime() + min * 60_000);

// the pools made here are closed again at the end (membership and period before 2020), so the tables of today that other files
// read (small-tanks-order, the water exports) do not meet them
const madePools: string[] = [];
afterAll(async () => {
  if (!madePools.length) return;
  for (const id of madePools) await setPoolPeriods(f.admin, id, { requestId: rid(), periods: [{ firstDay: "2018-12-07", lastDay: "2019-12-31" }] });
  await prisma.groupMembership.updateMany({ where: { poolId: { in: madePools } }, data: { validTo: new Date("2020-01-01T00:00:00+01:00") } });
});

beforeAll(async () => {
  f = await fixtures();
  for (const u of await prisma.unit.findMany()) unit[u.symbol] = u.id;
  for (const n of await prisma.animalName.findMany()) animal[n.name] = n.animalId;
  for (const n of await prisma.feedName.findMany()) feed[n.name] = n.feedId;
});

describe("a chemical's stock counts from its first recorded movement (A1, A2)", () => {
  it("a dosing dated 2019, keyed in after the stock began, leaves today's level and the 'fogy' warning alone; a late entry after the start counts", async () => {
    const chem = ((await createChemical(f.admin, { requestId: rid(), name: "Regi datum szer", stockUnitId: unit.l }, NOW)) as { id: string }).id;
    await recordMovement(f.admin, { requestId: rid(), chemicalId: chem, quantity: "10", unitId: unit.l, note: "kezdo keszlet" }, NOW);
    const level = async () => (await stockLevels(later(60))).find((c) => c.id === chem)!;
    expect((await level()).level).toBe(10);
    await saveDosing(f.admin, { requestId: rid(), performedAtLocal: "2019-03-11T09:00", poolId: f.pool("SOZO"), chemicalId: chem, quantity: "8", unitId: unit.l }, later(1));
    expect((await level()).level).toBe(10);
    expect((await runningOut(later(60))).map((c) => c.name)).not.toContain("Regi datum szer");
    // an ordinary late entry, dated the stock's own day: it counts, and so does its usage
    await saveDosing(f.admin, { requestId: rid(), performedAtLocal: "2031-02-11T08:00", poolId: f.pool("SOZO"), chemicalId: chem, quantity: "2", unitId: unit.l }, later(2));
    expect(await level()).toMatchObject({ level: 8, week: 2, month: 2 });
  });
});

describe("a stock whose FIRST recorded row is itself a backfill (e2e old-day.spec.ts; acrobot 40291: the 7 days are a decision)", () => {
  it("a chemical without movements: a 2019 dosing as its first leaves today at 0, no 'fogy'; a first one noted 3 days late counts", async () => {
    const chem = ((await createChemical(f.admin, { requestId: rid(), name: "Regi elso szer", stockUnitId: unit.l }, NOW)) as { id: string }).id;
    const level = async () => (await stockLevels(later(60))).find((c) => c.id === chem)!.level;
    // a chemical at zero is "fogy" from the start (runningOut: level <= 0); the old dosing must leave that line as it was
    const fogy = async () => (await runningOut(later(60))).filter((c) => c.name === "Regi elso szer");
    const before = await fogy();
    await saveDosing(f.admin, { requestId: rid(), performedAtLocal: "2019-03-11T09:00", poolId: f.pool("SOZO"), chemicalId: chem, quantity: "5", unitId: unit.l }, NOW);
    expect(await level()).toBe(0);
    expect(await fogy()).toEqual(before);
    const late = ((await createChemical(f.admin, { requestId: rid(), name: "Kesve rogzitett szer", stockUnitId: unit.l }, NOW)) as { id: string }).id;
    await saveDosing(f.admin, { requestId: rid(), performedAtLocal: "2031-02-08T09:00", poolId: f.pool("SOZO"), chemicalId: late, quantity: "2", unitId: unit.l }, NOW);
    expect((await stockLevels(later(60))).find((c) => c.id === late)!.level).toBe(-2);
  });

  it("a feed without intakes: a 2019 intake as its first starts no stock (not tracked, no 'fogy'); a first one noted 3 days late does", async () => {
    const type = await prisma.feedType.findFirstOrThrow({ where: { code: "HAL" } });
    const old = ((await createFeed(f.admin, { requestId: rid(), typeId: type.id, name: "Regi elso hal", dimensions: ["MASS"], defaultUnitId: unit.g }, NOW)) as { id: string }).id;
    await saveIntakeItem(f.admin, { requestId: rid(), day: "2019-03-11", feedId: old, quantities: [{ value: "500", unitId: unit.g }] }, NOW);
    expect((await feedStock(later(60))).filter((r) => r.feedId === old).map((r) => [r.level, r.tracked])).toEqual([[0, false]]);
    const late = ((await createFeed(f.admin, { requestId: rid(), typeId: type.id, name: "Kesve rogzitett hal", dimensions: ["MASS"], defaultUnitId: unit.g }, NOW)) as { id: string }).id;
    await saveIntakeItem(f.admin, { requestId: rid(), day: "2031-02-08", feedId: late, quantities: [{ value: "500", unitId: unit.g }] }, NOW);
    expect((await feedStock(later(60))).filter((r) => r.feedId === late).map((r) => [r.level, r.tracked])).toEqual([[500, true]]);
  });
});

describe("a feed's freezer stock counts from its first RECORDED intake (A3)", () => {
  it("an intake dated 2019 keyed in later does not draw the start back: the old withdrawals stay out of today's stock and the balance", async () => {
    const type = await prisma.feedType.findFirstOrThrow({ where: { code: "HAL" } });
    const id = ((await createFeed(f.admin, { requestId: rid(), typeId: type.id, name: "Regi datum hal", dimensions: ["MASS"], defaultUnitId: unit.g }, NOW)) as { id: string }).id;
    const level = async () => (await feedStock(later(60))).find((r) => r.feedId === id && r.dimension === "MASS")!;
    await saveIntakeItem(f.admin, { requestId: rid(), day: "2031-02-10", feedId: id, quantities: [{ value: "1000", unitId: unit.g }] }, NOW);
    await saveWithdrawalItem(f.admin, { requestId: rid(), day: "2019-03-12", useDay: "2019-03-12", feedId: id, quantities: [{ value: "300", unitId: unit.g }] }, later(1));
    expect((await level()).level).toBe(1000);
    // the old intake: before, it moved the start to 2019 and the stock fell to 800
    await saveIntakeItem(f.admin, { requestId: rid(), day: "2019-03-11", feedId: id, quantities: [{ value: "100", unitId: unit.g }] }, later(2));
    expect((await level()).level).toBe(1000);
    // the balance of the same feed reads the same start: the 2019 withdrawal is "before the stock", the 2019 intake archive
    const balance = (await feedBalance("2019-03-01", "2031-02-11", later(60))).find((r) => r.feedId === id)!;
    expect(balance).toMatchObject({ opening: 0, received: 1000, taken: 0, beforeStock: 300, closing: 1000 });
  });
});

describe("a pool added today, its period drawn back: its group membership follows (B4)", () => {
  it("an old measurement on it is taken, where it was refused NOT_IN_GROUP before; the membership never moves later", async () => {
    const r = (await createPool(f.admin, { requestId: rid(), name: "Regi datum medence", code: "REGI_DATUM", volumeLiters: "100", groupIds: [f.group("NAPI_NAGY")] }, NOW)) as { id: string };
    madePools.push(r.id);
    const old = { requestId: rid(), groupId: f.group("NAPI_NAGY"), poolId: r.id, parameterId: f.param("PH"), value: "8.1", measuredAtLocal: "2019-03-11T08:00" };
    await expect(createMeasurement(f.admin, old, later(1))).rejects.toMatchObject({ code: "NOT_IN_GROUP" });
    await setPoolPeriods(f.admin, r.id, { requestId: rid(), periods: [{ firstDay: "2018-12-07", lastDay: null }] });
    await createMeasurement(f.admin, { ...old, requestId: rid() }, later(2));
    const m = await prisma.groupMembership.findFirstOrThrow({ where: { poolId: r.id } });
    expect(m.validFrom.toISOString()).toBe(new Date("2018-12-07T00:00:00+01:00").toISOString());
    // a later first period does not cut it back (its old days may hold measurements)
    await setPoolPeriods(f.admin, r.id, { requestId: rid(), periods: [{ firstDay: "2020-01-01", lastDay: null }] });
    expect((await prisma.groupMembership.findFirstOrThrow({ where: { poolId: r.id } })).validFrom.toISOString()).toBe(m.validFrom.toISOString());
  });

  it("a pool that joined a table later (#186) keeps its own day when its periods change otherwise; only a drawn-back first day moves it", async () => {
    const r = (await createPool(f.admin, { requestId: rid(), name: "Kesobb belepett medence", code: "KESOBB_BELEPETT", volumeLiters: "100", groupIds: [f.group("NAPI_NAGY")] }, NOW)) as { id: string };
    madePools.push(r.id);
    await setPoolPeriods(f.admin, r.id, { requestId: rid(), periods: [{ firstDay: "2018-12-07", lastDay: null }] });
    // it joins the small tanks' table later, as the Karantén did on 2026-06-10 (#186)
    const joined = new Date("2026-06-10T00:00:00+02:00");
    await prisma.groupMembership.create({ data: { groupId: f.group("NAPI_KIS"), poolId: r.id, sortOrder: 99, validFrom: joined } });
    const kis = () => prisma.groupMembership.findFirstOrThrow({ where: { poolId: r.id, groupId: f.group("NAPI_KIS") } });
    // a renovation gap, and an end: the periods change, the first day does not move back
    await setPoolPeriods(f.admin, r.id, { requestId: rid(), periods: [{ firstDay: "2018-12-07", lastDay: "2024-03-01" }, { firstDay: "2024-05-01", lastDay: null }] });
    expect((await kis()).validFrom.toISOString()).toBe(joined.toISOString());
    // the admin draws the first period back: now the memberships follow it (acrobot 40257)
    await setPoolPeriods(f.admin, r.id, { requestId: rid(), periods: [{ firstDay: "2018-06-01", lastDay: "2024-03-01" }, { firstDay: "2024-05-01", lastDay: null }] });
    expect((await kis()).validFrom.toISOString()).toBe(new Date("2018-06-01T00:00:00+02:00").toISOString());
  });
});

describe("no data is not fasting (C7)", () => {
  it("an old day without a feeding day stays empty; a kept day still derives fasting for an animal not on its list", async () => {
    const empty = await feedingLog({ from: "2026-02-16", to: "2026-02-16", poolId: null, animalId: animal["Teszt Három"] });
    expect(empty.pattern).toEqual([]);
    await setDayFeeds(f.admin, { requestId: rid(), day: "2026-02-17", feedIds: [feed["Teszt hal"]] }, later(1));
    const kept = await feedingLog({ from: "2026-02-17", to: "2026-02-17", poolId: null, animalId: animal["Teszt Három"] });
    expect(kept.pattern.map((p) => p.cells["2026-02-17"])).toEqual([{ state: "FASTING", vitamin: false, medicine: false }]);
  });
});

describe("a former colleague as the measurement's 'végezte' (C9)", () => {
  it("an inactive aquarist on an earlier day is taken; on today refused", async () => {
    const gone = await prisma.user.create({ data: { loginId: `regi-${rid()}`, fullName: "Volt Kolléga", role: "AQUARIST", passwordHash: "x", active: false } });
    const base = { groupId: f.group("NAPI_NAGY"), poolId: f.pool("NAGY"), parameterId: f.param("TEMP"), value: "25", responsibleUserId: gone.id };
    await createMeasurement(f.admin, { ...base, requestId: rid(), measuredAtLocal: "2019-03-12T08:00" }, NOW);
    await expect(createMeasurement(f.admin, { ...base, requestId: rid(), measuredAtLocal: "2031-02-11T08:00" }, later(5))).rejects.toMatchObject({ code: "INVALID_RESPONSIBLE" });
  });
});

// Only the outcome: the race itself is not forced (the two saves may run one after the other), so this test passed without the
// row lock too (barracuda on #195). The lock's reason is in src/lib/master.ts ensureJournalDayForEntry.
describe("two first entries of the same old day at once (barracuda on #194)", () => {
  it("make one backfill reopening, not two (the outcome only)", async () => {
    const day = "2019-03-13";
    const take = (feedId: string) => saveWithdrawalItem(f.admin, { requestId: rid(), day, useDay: day, feedId, quantities: [{ value: "5", unitId: unit.g }] }, NOW);
    await Promise.all([take(feed["Teszt hal"]), take(feed["Teszt kagyló"])]);
    const j = await prisma.journalDay.findFirstOrThrow({ where: { kind: "WITHDRAWAL", businessDay: new Date(`${day}T00:00:00.000Z`) } });
    expect(await prisma.journalReopen.count({ where: { journalDayId: j.id } })).toBe(1);
  });
});
