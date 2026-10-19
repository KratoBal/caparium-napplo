// In-app notices and the monthly package (stage 4; NY-09 default: no e-mail): JAV-07 missed
// measurements, ADA-07 chemicals running out, VIZ-20 the previous month's ZIMS files. Days in 2027.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, SYSTEM_USER_ID } from "@/lib/db";
import { createChemical, recordMovement, saveDosing } from "@/lib/dosing";
import { monthlyPackage, previousMonth } from "@/lib/exports/zims";
import { createMeasurement } from "@/lib/measurements";
import { missedMeasurements, runningOut } from "@/lib/notices";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const unit: Record<string, string> = {};
const at = (local: string) => new Date(`${local}:00+01:00`);

beforeAll(async () => {
  f = await fixtures();
  for (const u of await prisma.unit.findMany()) unit[u.symbol] = u.id;
});

const measure = (pool: string, local: string) =>
  createMeasurement(f.aq1, { requestId: rid(), groupId: f.group("NAPI_NAGY"), poolId: f.pool(pool), parameterId: f.param("PH"), value: "8,1", measuredAtLocal: local }, at(local));

describe("missed measurements (JAV-07)", () => {
  it("nothing before the deadline; after it, the daily pools not measured that day", async () => {
    expect(await missedMeasurements(at("2027-01-11T10:00"))).toMatchObject({ due: false, pools: [] });
    await measure("NAGY", "2027-01-11T09:00");
    const after = await missedMeasurements(at("2027-01-11T15:00"));
    expect(after.due).toBe(true);
    expect(after.pools).not.toContain("Nagymedence");
    expect(after.pools).toContain("Kismedence");
  });
});

describe("chemicals running out (ADA-07)", () => {
  it("flagged within 3 days at the 30-day average usage, or at zero; not before", async () => {
    await createChemical(f.admin, { requestId: rid(), name: "Teszt jelző-só", stockUnitId: unit.kg }, at("2027-01-04T08:00"));
    const chem = (await prisma.chemicalName.findFirstOrThrow({ where: { name: "Teszt jelző-só" } })).chemicalId;
    await recordMovement(f.admin, { requestId: rid(), chemicalId: chem, quantity: "10", unitId: unit.kg }, at("2027-01-04T08:10"));
    const dose = (local: string, q: string) =>
      saveDosing(f.aq1, { requestId: rid(), performedAtLocal: local, poolId: f.pool("SOZO"), chemicalId: chem, quantity: q, unitId: unit.kg }, at(local));
    await dose("2027-01-05T09:00", "9");
    // level 1 kg, 9 kg in 30 days = 0.3 kg a day: about 3.3 days, not yet
    expect((await runningOut(at("2027-01-06T12:00"))).find((c) => c.name === "Teszt jelző-só")).toBeUndefined();
    await dose("2027-01-06T09:00", "0,5");
    const low = (await runningOut(at("2027-01-06T12:00"))).find((c) => c.name === "Teszt jelző-só");
    expect(low).toMatchObject({ level: 0.5, unit: "kg", daysLeft: 1.6 });
  });
});

describe("the monthly ZIMS package (VIZ-20)", () => {
  it("the previous month as a System PREVIEW run, once; a month without measurements gets none", async () => {
    expect(previousMonth(at("2027-03-10T12:00"))).toEqual({ from: "2027-02-01", to: "2027-02-28" });
    expect(previousMonth(at("2027-01-05T12:00"))).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    await measure("NAGY", "2027-02-15T09:00");
    const first = await monthlyPackage(at("2027-03-10T12:00"));
    expect(first.created).toBe(true);
    const run = await prisma.exportRun.findUniqueOrThrow({ where: { id: first.runId! }, include: { files: true } });
    expect([run.purpose, run.createdById, run.submissionState, run.files.length > 0]).toEqual(["PREVIEW", SYSTEM_USER_ID, null, true]);
    expect(await monthlyPackage(at("2027-03-10T13:00"))).toEqual({ created: false, runId: first.runId });
    expect(await monthlyPackage(at("2027-05-10T12:00"))).toMatchObject({ created: false, reason: "NOTHING_TO_EXPORT" });
  });
});
