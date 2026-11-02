// Lili 2026-11-02 09:36-09:40 UTC (acrobot 39956, 39960): the Vízmérések card's operations. A table of this file's own, so no
// other file's grid gets its columns; days in August 2026 (summer time).
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { buildWaterWorkbook } from "@/lib/exports/excel";
import { createMeasurement } from "@/lib/measurements";
import { changeMeasurementUnit, closeMeasurementType, listMeasurementTypes, renameMeasurementType, setMeasurementLimits } from "@/lib/measurement-types";
import { createMeasurementType } from "@/lib/new-measurement";
import { setParameterOrder } from "@/lib/parameter-order";
import { getGrid } from "@/lib/queries";
import { cest, fixtures, rid } from "./fixtures";

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
});
