// Lili 2026-11-02 09:36-09:40 UTC (acrobot 39956, 39960): the Vízmérések card's operations. A table of this file's own, so no
// other file's grid gets its columns; days in August 2026 (summer time).
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chemistryCalcPools } from "@/lib/chemistry-calc";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { buildWaterWorkbook } from "@/lib/exports/excel";
import { createMeasurement } from "@/lib/measurements";
import { changeMeasurementUnit, closeMeasurementType, listMeasurementTypes, renameMeasurementType, setMeasurementLimits } from "@/lib/measurement-types";
import { createMeasurementType } from "@/lib/new-measurement";
import { setParameterOrder } from "@/lib/parameter-order";
import { getGrid } from "@/lib/queries";
import { cest, fixtures, ownerPrisma, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
let groupId = "";
let ppm = "";
let mgl = "";
beforeAll(async () => {
  f = await fixtures();
  ppm = (await prisma.unit.findUniqueOrThrow({ where: { symbol: "ppm" } })).id;
  mgl = (await prisma.unit.findUniqueOrThrow({ where: { symbol: "mg/l" } })).id;
  const g = await prisma.measurementGroup.create({ data: { code: `MT_${rid().slice(-6).replace(/[^A-Za-z0-9]/g, "X")}`, name: "Vízmérések teszt", frequency: "DAILY", sortOrder: 98 } });
  groupId = g.id;
  for (const [i, code] of ["NAGY", "KIS"].entries()) {
    await prisma.groupMembership.create({ data: { groupId, poolId: f.pool(code), sortOrder: i + 1, validFrom: new Date("2025-12-31T23:00:00Z") } });
  }
});

afterAll(async () => {
  await prisma.measurementGroup.update({ where: { id: groupId }, data: { active: false } });
  await prisma.groupMembership.updateMany({ where: { groupId, validTo: null }, data: { validTo: new Date("2025-12-31T23:00:00Z") } });
});

async function code(p: Promise<unknown>): Promise<string> {
  const e = await p.then(() => null, (err: unknown) => err);
  expect(e).toBeInstanceOf(AppError);
  return (e as AppError).code;
}

async function newType(name: string, over: Record<string, unknown> = {}) {
  const r = (await createMeasurementType(f.admin, {
    requestId: rid(),
    name,
    unitId: ppm,
    decimals: 2,
    plausibleMin: "0",
    plausibleMax: "50",
    referenceMin: null,
    referenceMax: "5",
    zimsName: name,
    zimsUnit: "ppm",
    tables: [{ groupId, poolIds: [f.pool("NAGY"), f.pool("KIS")] }],
    from: "2026-08-01",
    ...over,
  })) as { id: string };
  return r.id;
}

const columns = async (day: string) => (await getGrid(groupId, day))!.layout.parameters.map((p) => p.name);
const measure = (param: string, value: string, local: string, pool = "NAGY") =>
  createMeasurement(
    f.aq1,
    { requestId: rid(), groupId, poolId: f.pool(pool), parameterId: param, value, measuredAtLocal: local, newRound: true } as Parameters<typeof createMeasurement>[1],
    cest(local),
  );

describe("the Vízmérések card", () => {
  it("one order everywhere: swapped, the table's columns and the Excel's rows of the same moment follow it", async () => {
    const a = await newType("Sorrend A");
    const b = await newType("Sorrend B");
    expect(await columns("2026-08-03")).toEqual(["Sorrend A", "Sorrend B"]);
    // the measurement's own time: both values in one moment, the Excel's tie broken by the order
    await createMeasurement(f.aq1, { requestId: rid(), groupId, poolId: f.pool("NAGY"), parameterId: a, value: "1", measuredAtLocal: "2026-08-03T09:00", newRound: true } as Parameters<typeof createMeasurement>[1], cest("2026-08-03T09:00"));
    await createMeasurement(f.aq1, { requestId: rid(), groupId, poolId: f.pool("NAGY"), parameterId: b, value: "2", measuredAtLocal: "2026-08-03T09:00" } as Parameters<typeof createMeasurement>[1], cest("2026-08-03T09:01"));
    const all = (await prisma.parameter.findMany({ orderBy: { sortOrder: "asc" } })).map((p) => p.id);
    const swapped = all.map((id) => (id === a ? b : id === b ? a : id));
    expect(await code(setParameterOrder(f.aq1, { requestId: rid(), ids: swapped }))).toBe("ADMIN_ONLY");
    await setParameterOrder(f.admin, { requestId: rid(), ids: swapped });
    expect(await columns("2026-08-03")).toEqual(["Sorrend B", "Sorrend A"]);
    const { buffer } = await buildWaterWorkbook({ from: "2026-08-03", to: "2026-08-03", poolIds: [f.pool("NAGY")] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Nagymedence")!;
    const names = [2, 3].map((r) => ws.getRow(r).getCell(4).value);
    expect(names).toEqual(["Sorrend B", "Sorrend A"]);
  });

  it("a name from a day on: the days before keep the old name; not before the current name began; one of a kind", async () => {
    const id = await newType("Régi név");
    await renameMeasurementType(f.admin, { requestId: rid(), parameterId: id, name: "Új név", from: "2026-08-10" });
    expect(await columns("2026-08-09")).toContain("Régi név");
    expect(await columns("2026-08-10")).toContain("Új név");
    expect(await code(renameMeasurementType(f.admin, { requestId: rid(), parameterId: id, name: "Harmadik", from: "2026-08-05" }))).toBe("TOO_EARLY");
    expect(await code(renameMeasurementType(f.admin, { requestId: rid(), parameterId: id, name: "Sorrend A", from: "2026-08-12" }))).toBe("NAME_TAKEN");
    expect(await code(renameMeasurementType(f.aq1, { requestId: rid(), parameterId: id, name: "Más", from: "2026-08-12" }))).toBe("ADMIN_ONLY");
  });

  it("closed with its last day: shown through it, gone after it; not while a value stands after it; nothing deleted", async () => {
    const id = await newType("Lezárandó");
    await measure(id, "1", "2026-08-20T09:00");
    expect(await code(closeMeasurementType(f.admin, { requestId: rid(), parameterId: id, to: "2026-08-19" }))).toBe("VALUES_AFTER");
    await closeMeasurementType(f.admin, { requestId: rid(), parameterId: id, to: "2026-08-21" });
    expect(await columns("2026-08-21")).toContain("Lezárandó");
    expect(await columns("2026-08-22")).not.toContain("Lezárandó");
    expect(await code(closeMeasurementType(f.admin, { requestId: rid(), parameterId: id, to: "2026-08-25" }))).toBe("ALREADY_CLOSED");
    expect(await prisma.measurement.count({ where: { parameterId: id } })).toBe(1);
    const row = (await listMeasurementTypes(new Date("2026-08-25T10:00:00Z"))).find((t) => t.id === id)!;
    expect([row.from, row.to, row.inForce]).toEqual(["2026-08-01", "2026-08-21", false]);
    // a closed measurement gives its name back
    await newType("Lezárandó", { from: "2026-08-22" });
  });

  // barracuda on #188: a value saved while the measurement is being closed. The close holds the type's row (as
  // closeMeasurementType does) and closes the column; meanwhile a save starts. The save takes the row FOR SHARE before it
  // looks at the column, so it waits for the close and then finds the column closed. Without that it saw the column open,
  // waited only at the insert, and wrote a value behind the closed column that the close's VALUES_AFTER count never saw.
  it("a value saved while the measurement is being closed waits for it, and is refused", async () => {
    const id = await newType("Verseny");
    const until = new Date("2026-08-26T22:00:00Z"); // after 2026-08-26, local midnight
    let saving: Promise<string> | null = null;
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "parameter" WHERE id = ${id}::uuid FOR UPDATE`;
        await tx.groupParameter.updateMany({ where: { parameterId: id, validTo: null }, data: { validTo: until } });
        saving = code(measure(id, "1", "2026-08-28T09:00"));
        await new Promise((r) => setTimeout(r, 700)); // the save reaches its check meanwhile
      },
      { timeout: 10_000 },
    );
    expect(await saving).toBe("NOT_IN_GROUP");
    expect(await prisma.measurement.count({ where: { parameterId: id } })).toBe(0);
  });

  it("the decimals and the plausible range, for all time", async () => {
    const id = await newType("Határok");
    await setMeasurementLimits(f.admin, { requestId: rid(), parameterId: id, decimals: 3, plausibleMin: "0", plausibleMax: "9" });
    const p = await prisma.parameter.findUniqueOrThrow({ where: { id } });
    expect([p.decimals, p.plausibleMax?.toString()]).toEqual([3, "9"]);
    expect(await code(setMeasurementLimits(f.admin, { requestId: rid(), parameterId: id, decimals: 3, plausibleMin: "5", plausibleMax: "1" }))).toBe("BAD_RANGE");
  });

  it("a unit change: closed the day before, its successor with the same name, tables, pools and place; references asked again", async () => {
    const id = await newType("Egységváltó");
    await measure(id, "3", "2026-08-05T09:00");
    const r = (await changeMeasurementUnit(f.admin, {
      requestId: rid(),
      parameterId: id,
      from: "2026-08-15",
      unitId: mgl,
      zimsUnit: "mg/L",
      decimals: 1,
      plausibleMin: "0",
      plausibleMax: "40",
      referenceMin: null,
      referenceMax: "4",
      poolReferences: [{ poolId: f.pool("KIS"), min: "1", max: "3" }],
    })) as { id: string };
    const [old, next] = await Promise.all([
      prisma.parameter.findUniqueOrThrow({ where: { id }, include: { groups: true } }),
      prisma.parameter.findUniqueOrThrow({ where: { id: r.id }, include: { groups: true, names: true, unit: true, referenceRanges: true, zimsUnitNames: true } }),
    ]);
    expect([next.predecessorId, next.baseCode, next.sortOrder, next.unit.symbol, next.names[0].displayName]).toEqual([id, old.code, old.sortOrder + 1, "mg/l", "Egységváltó"]);
    expect(next.groups.map((g) => [g.groupId, g.poolIds.length, g.validTo])).toEqual([[groupId, 2, null]]);
    expect(next.referenceRanges.map((x) => [x.poolId, x.max?.toString()]).sort()).toEqual([[f.pool("KIS"), "3"], [null, "4"]].sort());
    expect(next.zimsUnitNames.map((z) => z.zimsUnit)).toEqual(["mg/L"]);
    // the old one through the 14th, the successor from the 15th, one column a day
    const units = async (d: string) => (await getGrid(groupId, d))!.layout.parameters.filter((p) => p.name === "Egységváltó").map((p) => p.unit.symbol);
    expect(await units("2026-08-14")).toEqual(["ppm"]);
    expect(await units("2026-08-15")).toEqual(["mg/l"]);
    // the list shows them together: the successor right after its predecessor
    const list = await listMeasurementTypes(new Date("2026-08-16T10:00:00Z"));
    const at = list.findIndex((t) => t.id === id);
    expect([list[at].successorId, list[at + 1].id, list[at + 1].predecessorId]).toEqual([r.id, r.id, id]);
    expect(await code(changeMeasurementUnit(f.admin, { requestId: rid(), parameterId: r.id, from: "2026-08-20", unitId: mgl, zimsUnit: "x", decimals: 1, poolReferences: [] }))).toBe("SAME_UNIT");
  });

  // barracuda on #188: a calcium closed by a unit change is not computed from its last old value; the calculator says why.
  // The link is set for the test and taken off again (a real change of the shared Ca would close it for every other file).
  it("the chemical calculator stops for a measurement that has a successor", async () => {
    const ca = f.param("CA");
    const stand = await newType("Kalcium utód próba");
    await ownerPrisma.parameter.update({ where: { id: stand }, data: { predecessorId: ca } });
    try {
      const pools = await chemistryCalcPools(new Date("2026-08-30T10:00:00Z"));
      const nagy = pools.find((p) => p.id === f.pool("NAGY"))!;
      expect(nagy.stopped?.CA).toBe("A mérés mértékegysége megváltozott, ezért a kalkulátor ehhez nem számol.");
      expect([nagy.latest.CA, nagy.band.CA]).toEqual([undefined, undefined]);
      expect(nagy.stopped?.MG).toBeUndefined();
    } finally {
      await ownerPrisma.parameter.update({ where: { id: stand }, data: { predecessorId: null } });
    }
    expect((await chemistryCalcPools(new Date("2026-08-30T10:00:00Z"))).find((p) => p.id === f.pool("NAGY"))!.stopped?.CA).toBeUndefined();
  });

  // barracuda on #188: the successor of a nitrate keeps the dilution in the grid and on the saved row
  it("a nitrate's successor keeps the dilution: the column takes it, the saved value is the reading times it", async () => {
    const weekly = await prisma.measurementGroup.create({ data: { code: `MTW_${rid().slice(-6).replace(/[^A-Za-z0-9]/g, "X")}`, name: "Heti teszt", frequency: "WEEKLY", sortOrder: 97 } });
    await prisma.groupMembership.create({ data: { groupId: weekly.id, poolId: f.pool("NAGY"), sortOrder: 1, validFrom: new Date("2025-12-31T23:00:00Z") } });
    try {
      const id = await newType("Nitrát próba", { tables: [{ groupId: weekly.id, poolIds: [f.pool("NAGY")] }] });
      // as the built-in NO3: the dilution is keyed by the built-in code (src/lib/dilution.ts)
      await ownerPrisma.parameter.update({ where: { id }, data: { baseCode: "NO3" } });
      const r = (await changeMeasurementUnit(f.admin, { requestId: rid(), parameterId: id, from: "2026-08-10", unitId: mgl, zimsUnit: "mg/L", decimals: 2, poolReferences: [] })) as { id: string };
      const col = (await getGrid(weekly.id, "2026-08-11"))!.layout.parameters.find((p) => p.id === r.id)!;
      expect([col.dilution, col.unit.symbol]).toEqual([true, "mg/l"]);
      const saved = await createMeasurement(
        f.aq1,
        { requestId: rid(), groupId: weekly.id, poolId: f.pool("NAGY"), parameterId: r.id, value: "8,4", dilution: 10, diluentWater: "RO", measuredAtLocal: "2026-08-11T09:00" } as Parameters<typeof createMeasurement>[1],
        cest("2026-08-11T09:00"),
      );
      expect([saved.measurement.value, saved.measurement.baseValue]).toEqual(["84", "8.4"]);
    } finally {
      await prisma.measurementGroup.update({ where: { id: weekly.id }, data: { active: false } });
      await prisma.groupMembership.updateMany({ where: { groupId: weekly.id, validTo: null }, data: { validTo: new Date("2025-12-31T23:00:00Z") } });
    }
  });
});
