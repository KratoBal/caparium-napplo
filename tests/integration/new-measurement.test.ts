// Lili 2026-11-01 (point 9, msg 1566532615530352863): a new measurement type in some pools of a table. A group of its own, so no other
// file's table gets the new column; days in late May 2026.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createMeasurement } from "@/lib/measurements";
import { createMeasurementType } from "@/lib/new-measurement";
import { getGrid } from "@/lib/queries";
import { cest, fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
let groupId = "";
let otherGroupId = "";
let ppm = "";
beforeAll(async () => {
  f = await fixtures();
  ppm = (await prisma.unit.findUniqueOrThrow({ where: { symbol: "ppm" } })).id;
  const g = await prisma.measurementGroup.create({ data: { code: `P9_${rid().slice(-6).replace(/[^A-Za-z0-9]/g, "X")}`, name: "Pont 9 teszt", frequency: "DAILY", sortOrder: 99 } });
  groupId = g.id;
  for (const [i, code] of ["NAGY", "KIS"].entries()) {
    await prisma.groupMembership.create({ data: { groupId, poolId: f.pool(code), sortOrder: i + 1, validFrom: new Date("2025-12-31T23:00:00Z") } });
  }
  // a second table of its own (Lili 2026-11-01 22:21 UTC: one measurement in several tables)
  const g2 = await prisma.measurementGroup.create({ data: { code: `P9B_${rid().slice(-6).replace(/[^A-Za-z0-9]/g, "X")}`, name: "Pont 9 második", frequency: "DAILY", sortOrder: 100 } });
  otherGroupId = g2.id;
  await prisma.groupMembership.create({ data: { groupId: otherGroupId, poolId: f.pool("KORALLOS"), sortOrder: 1, validFrom: new Date("2025-12-31T23:00:00Z") } });
  // the group's existing column, every pool
  await prisma.groupParameter.create({ data: { groupId, parameterId: f.param("TEMP"), sortOrder: 1, validFrom: new Date("2025-12-31T23:00:00Z") } });
});

// the group off at the end: an active daily group counts in the water helper's and the home page's "still to measure" (helpers.test)
afterAll(async () => {
  await prisma.measurementGroup.updateMany({ where: { id: { in: [groupId, otherGroupId] } }, data: { active: false } });
  await prisma.groupMembership.updateMany({ where: { groupId: { in: [groupId, otherGroupId] }, validTo: null }, data: { validTo: new Date("2025-12-31T23:00:00Z") } });
});

async function code(p: Promise<unknown>): Promise<string> {
  const e = await p.then(() => null, (err: unknown) => err);
  expect(e).toBeInstanceOf(AppError);
  return (e as AppError).code;
}

const input = (over: Record<string, unknown> = {}) =>
  ({
    requestId: rid(),
    name: "Nitrit próba",
    unitId: ppm,
    decimals: 2,
    plausibleMin: "0",
    plausibleMax: "5",
    referenceMin: null,
    referenceMax: "0,1",
    zimsName: "Nitrite",
    zimsUnit: "ppm",
    tables: [{ groupId, poolIds: [f.pool("NAGY")] }],
    from: "2026-05-25",
    ...over,
  }) as Parameters<typeof createMeasurementType>[1];

describe("a new measurement type (point 9)", () => {
  it("admin only; the chosen pools must be the group's", async () => {
    expect(await code(createMeasurementType(f.aq1, input()))).toBe("ADMIN_ONLY");
    expect(await code(createMeasurementType(f.admin, input({ tables: [{ groupId, poolIds: [f.pool("KORALLOS")] }] })))).toBe("POOL_NOT_IN_GROUP");
    expect(await code(createMeasurementType(f.admin, input({ plausibleMin: "5", plausibleMax: "1" })))).toBe("BAD_RANGE");
  });

  it("a new column from its day, filled in the chosen pools only; its ranges, its ZIMS names; the other columns as they were", async () => {
    const r = (await createMeasurementType(f.admin, input())) as { id: string; code: string };
    const p = await prisma.parameter.findUniqueOrThrow({ where: { id: r.id }, include: { names: true, zimsNames: true, zimsUnitNames: true, referenceRanges: true } });
    expect([p.code, p.decimals, p.plausibleMax?.toString(), p.names[0].displayName, p.zimsNames[0].zimsName, p.zimsUnitNames[0].zimsUnit]).toEqual(["NITRIT_PROBA", 2, "5", "Nitrit próba", "Nitrite", "ppm"]);
    expect(p.referenceRanges.map((x) => [x.poolId, x.min, x.max?.toString()])).toEqual([[null, null, "0.1"]]);
    const layout = async (day: string) => (await getGrid(groupId, day))!.layout.parameters.map((x) => [x.name, x.pools]);
    expect(await layout("2026-05-24")).toEqual([["Hőmérséklet", null]]);
    expect(await layout("2026-05-26")).toEqual([["Hőmérséklet", null], ["Nitrit próba", [f.pool("NAGY")]]]);
    const measure = (pool: string, value: string, over: Record<string, unknown> = {}) =>
      createMeasurement(f.aq1, { requestId: rid(), groupId, poolId: f.pool(pool), parameterId: r.id, value, measuredAtLocal: "2026-05-26T08:00", ...over } as Parameters<typeof createMeasurement>[1], cest("2026-05-26T08:00"));
    // the chosen pool: a value; over the reference it is flagged; over the plausible range it asks
    await measure("NAGY", "0,25");
    const cell = (await getGrid(groupId, "2026-05-26"))!.cells[`${f.pool("NAGY")}:${r.id}`];
    expect([cell.value, cell.reference]).toEqual(["0.25", "HIGH"]);
    expect(await code(measure("NAGY", "9", { newRound: true }))).toBe("IMPLAUSIBLE_VALUE");
    // the other pool has no field for it
    expect(await code(measure("KIS", "0,05"))).toBe("NOT_MEASURED_HERE");
    // its name is taken now
    expect(await code(createMeasurementType(f.admin, input({ name: "nitrit PRÓBA" })))).toBe("NAME_TAKEN");
  });

  it("one measurement in several tables, each with its own pools; a table twice is refused; the new units are there", async () => {
    expect(await code(createMeasurementType(f.admin, input({ name: "Kétszer tábla", tables: [{ groupId, poolIds: [f.pool("NAGY")] }, { groupId, poolIds: [f.pool("KIS")] }] })))).toBe("TABLE_TWICE");
    const mgl = (await prisma.unit.findUniqueOrThrow({ where: { symbol: "mg/l" } })).id;
    expect(await prisma.unit.findUnique({ where: { symbol: "%" } })).not.toBeNull();
    const r = (await createMeasurementType(f.admin, input({ name: "Oldott oxigén próba", unitId: mgl, tables: [{ groupId, poolIds: [f.pool("NAGY")] }, { groupId: otherGroupId, poolIds: [f.pool("KORALLOS")] }] }))) as { id: string };
    const rows = await prisma.groupParameter.findMany({ where: { parameterId: r.id } });
    expect(rows.map((x) => [x.groupId, x.poolIds]).sort()).toEqual([[groupId, [f.pool("NAGY")]], [otherGroupId, [f.pool("KORALLOS")]]].sort());
    const cols = async (g: string) => (await getGrid(g, "2026-05-27"))!.layout.parameters.filter((x) => x.id === r.id).map((x) => x.pools);
    expect(await cols(groupId)).toEqual([[f.pool("NAGY")]]);
    expect(await cols(otherGroupId)).toEqual([[f.pool("KORALLOS")]]);
  });
});
