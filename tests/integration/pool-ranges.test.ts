// caparium-hibak-3: the reference band per pool (the pool's own, else the common one every pool starts from), the
// pool volume, and what the chemical calculator offers per pool. Dated 2027-08, a month no other spec uses: the
// shared database keeps what one file writes (a range valid from then on would judge another file's measurements).
import { beforeAll, describe, expect, it } from "vitest";
import { setPoolSystem, setPoolVolume, setReference } from "@/lib/admin";
import { chemistryCalcPools } from "@/lib/chemistry-calc";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createMeasurement } from "@/lib/measurements";
import { getGrid } from "@/lib/queries";
import { cest, fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => {
  f = await fixtures();
});

async function code(p: Promise<unknown>) {
  return p.then(
    () => null,
    (err: unknown) => (err as AppError).code,
  );
}

const weekly = (pool: string, param: string, value: string, local: string) =>
  createMeasurement(
    f.aq1,
    { requestId: rid(), groupId: f.group("HETI"), poolId: f.pool(pool), parameterId: f.param(param), value, measuredAtLocal: local },
    cest(local),
  );

describe("the reference band per pool", () => {
  it("a pool's own range wins in that pool only; the others keep the common one; a measurement binds its pool's range", async () => {
    const common = await prisma.referenceRange.findFirstOrThrow({ where: { parameterId: f.param("KH"), poolId: null, validTo: null } });
    await setReference(f.admin, { requestId: rid(), parameterId: f.param("KH"), poolId: f.pool("INKUBATOR"), min: "9", max: "10", mode: "change" }, cest("2027-08-01T10:00"));

    const own = await weekly("INKUBATOR", "KH", "8,5", "2027-08-02T09:00");
    const other = await weekly("KORALLOS", "KH", "8,5", "2027-08-02T09:05");
    const ownRow = await prisma.referenceRange.findUniqueOrThrow({ where: { id: (await prisma.measurement.findUniqueOrThrow({ where: { id: own.measurement.id } })).referenceRangeId! } });
    expect([ownRow.poolId, ownRow.min?.toString(), ownRow.max?.toString()]).toEqual([f.pool("INKUBATOR"), "9", "10"]);
    expect((await prisma.measurement.findUniqueOrThrow({ where: { id: other.measurement.id } })).referenceRangeId).toBe(common.id);
    // 8,5 is LOW against 9-10, inside the common 7-11
    const grid = await getGrid(f.group("HETI"), "2027-08-02");
    expect(grid!.cells[`${f.pool("INKUBATOR")}:${f.param("KH")}`]!.reference).toBe("LOW");
    expect(grid!.cells[`${f.pool("KORALLOS")}:${f.param("KH")}`]!.reference).toBe("IN_RANGE");
    // the empty-cell hint is the range valid NOW, per pool: the pool's own one starts only in 2027-08
    expect(grid!.currentRanges[`${f.pool("INKUBATOR")}:${f.param("KH")}`]).toMatchObject({ min: common.min?.toString(), max: common.max?.toString() });

    // a measurement BEFORE the pool's range keeps the common one (K3: the past keeps the old value)
    const before = await weekly("INKUBATOR", "KH", "8,5", "2027-07-31T09:00");
    expect((await prisma.measurement.findUniqueOrThrow({ where: { id: before.measurement.id } })).referenceRangeId).toBe(common.id);
  });

  it("the grid's hint for an empty cell is the range valid now in THAT pool (Karantén PO4: no other spec uses it)", async () => {
    await setReference(f.admin, { requestId: rid(), parameterId: f.param("PO4"), poolId: f.pool("KARANTEN"), min: null, max: "0,03", mode: "change" });
    const common = await prisma.referenceRange.findFirstOrThrow({ where: { parameterId: f.param("PO4"), poolId: null, validTo: null } });
    const grid = await getGrid(f.group("HETI"), "2027-08-05");
    expect(grid!.currentRanges[`${f.pool("KARANTEN")}:${f.param("PO4")}`]).toMatchObject({ min: null, max: "0.03" });
    expect(grid!.currentRanges[`${f.pool("NAGY")}:${f.param("PO4")}`]).toMatchObject({ max: common.max?.toString() });
  });

  it("a correction acts on the pool's OWN range only; without one there is nothing to correct; the audit names it", async () => {
    expect(await code(setReference(f.admin, { requestId: rid(), parameterId: f.param("CA"), poolId: f.pool("INKUBATOR"), min: "1", max: "2", mode: "correction", reason: "elírás" }, cest("2027-08-03T10:00")))).toBe("NO_CURRENT");
    const r = await setReference(f.admin, { requestId: rid(), parameterId: f.param("KH"), poolId: f.pool("INKUBATOR"), min: "9", max: "10,5", mode: "correction", reason: "elírás a maximumban" }, cest("2027-08-03T10:00"));
    const row = await prisma.referenceRange.findUniqueOrThrow({ where: { id: (r as { id: string }).id } });
    expect([row.poolId, row.max?.toString()]).toEqual([f.pool("INKUBATOR"), "10.5"]);
    const audit = await prisma.auditEntry.findFirstOrThrow({ where: { entityId: row.id, action: "MASTER_CORRECTION" } });
    expect(audit.changes).toMatchObject({ max: { before: "10", after: "10.5" } });
    expect(await code(setReference(f.admin, { requestId: rid(), parameterId: f.param("KH"), poolId: "00000000-0000-0000-0000-00000000dead", min: "1", max: "2", mode: "change" }))).toBe("POOL_NOT_FOUND");
  });
});

describe("the pool volume", () => {
  it("an admin sets it in litres, audited; not positive, no change and an aquarist are refused; clearing is allowed", async () => {
    expect(await code(setPoolVolume(f.aq1, { requestId: rid(), poolId: f.pool("SOZO"), volumeLiters: "100" }))).toBe("ADMIN_ONLY");
    expect(await code(setPoolVolume(f.admin, { requestId: rid(), poolId: f.pool("SOZO"), volumeLiters: "0" }))).toBe("INVALID_VOLUME");
    expect(await code(setPoolVolume(f.admin, { requestId: rid(), poolId: f.pool("SOZO"), volumeLiters: "sok" }))).toBe("INVALID_VOLUME");
    await setPoolVolume(f.admin, { requestId: rid(), poolId: f.pool("SOZO"), volumeLiters: "1250,5" });
    expect((await prisma.pool.findUniqueOrThrow({ where: { id: f.pool("SOZO") } })).volumeLiters?.toString()).toBe("1250.5");
    expect(await code(setPoolVolume(f.admin, { requestId: rid(), poolId: f.pool("SOZO"), volumeLiters: "1250.50" }))).toBe("NO_CHANGE");
    const audit = await prisma.auditEntry.findFirstOrThrow({ where: { entityType: "Pool", entityId: f.pool("SOZO") }, orderBy: { at: "desc" } });
    expect(audit.changes).toEqual({ volumeLiters: { before: null, after: "1250.5" } });
    await setPoolVolume(f.admin, { requestId: rid(), poolId: f.pool("SOZO"), volumeLiters: null });
    expect((await prisma.pool.findUniqueOrThrow({ where: { id: f.pool("SOZO") } })).volumeLiters).toBeNull();
    // the database refuses a non-positive volume even past the application
    await expect(prisma.$executeRawUnsafe(`UPDATE "pool" SET "volumeLiters" = -1 WHERE "code" = 'SOZO'`)).rejects.toThrow(/pool_volume_positive/);
  });
});

describe("the pool's system (Lili 2026-10-29, package item 5b)", () => {
  it("an admin sets coral or fish, audited; no change and an aquarist are refused; clearing is allowed; the calculator gets it", async () => {
    const poolId = f.pool("KARANTEN");
    expect(await code(setPoolSystem(f.aq1, { requestId: rid(), poolId, systemType: "CORAL" }))).toBe("ADMIN_ONLY");
    await setPoolSystem(f.admin, { requestId: rid(), poolId, systemType: "CORAL" });
    expect(await code(setPoolSystem(f.admin, { requestId: rid(), poolId, systemType: "CORAL" }))).toBe("NO_CHANGE");
    const audit = await prisma.auditEntry.findFirstOrThrow({ where: { entityType: "Pool", entityId: poolId }, orderBy: { at: "desc" } });
    expect(audit.changes).toEqual({ systemType: { before: null, after: "CORAL" } });
    expect((await chemistryCalcPools()).find((p) => p.id === poolId)?.systemType).toBe("CORAL");
    await setPoolSystem(f.admin, { requestId: rid(), poolId, systemType: null });
    expect((await chemistryCalcPools()).find((p) => p.id === poolId)?.systemType).toBeNull();
  });
});

describe("the chemical calculator's suggestions", () => {
  it("per pool: its volume, its latest valid Ca/Mg/KH and its band (own, else common)", async () => {
    await setPoolVolume(f.admin, { requestId: rid(), poolId: f.pool("INKUBATOR"), volumeLiters: "800" });
    await weekly("INKUBATOR", "CA", "410", "2027-08-04T09:00");
    const pools = await chemistryCalcPools(cest("2027-08-04T12:00"));
    const ink = pools.find((p) => p.id === f.pool("INKUBATOR"))!;
    expect(ink.volumeLiters).toBe("800");
    expect(ink.latest.CA).toEqual({ value: "410", day: "2027-08-04" });
    expect(ink.latest.KH).toEqual({ value: "8.5", day: "2027-08-02" });
    expect(ink.band.KH).toMatchObject({ min: "9", max: "10.5", unit: "dKH" });
    const kor = pools.find((p) => p.id === f.pool("KORALLOS"))!;
    const common = await prisma.referenceRange.findFirstOrThrow({ where: { parameterId: f.param("KH"), poolId: null, validTo: null } });
    expect(kor.band.KH).toMatchObject({ min: common.min?.toString(), max: common.max?.toString() });
  });
});
