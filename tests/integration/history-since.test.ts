// Lili 2026-11-01 (point 14) and acrobot 2026-11-02 (39955): the water tables reach back to 2018-12-07. On 2025-06-02 the
// daily table had no rows and only a new column; now an old day has the table as it stands today. acrobot's condition: a day
// that merely exists now, with no value on it, gives no export row, no ZIMS row, no report line and no "missing" signal.
// 2019-03-04: a day no other spec uses.
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { HISTORY_SINCE, SINCE } from "@/lib/base-data";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { buildWaterWorkbook } from "@/lib/exports/excel";
import { createZimsExport } from "@/lib/exports/zims";
import { getGrid } from "@/lib/queries";
import { waterReport } from "@/lib/water-report";
import { fixtures, ownerPrisma, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => {
  f = await fixtures();
});

const OLD_DAY = "2019-03-04";

describe("the water tables since 2018-12-07", () => {
  it("an old day has the daily table's pools and built-in columns, with their names", async () => {
    const grid = (await getGrid(f.group("NAPI_NAGY"), OLD_DAY))!;
    expect(grid.layout.pools.map((p) => p.name)).toEqual(expect.arrayContaining(["Nagymedence", "Kismedence"]));
    expect(grid.layout.parameters.map((p) => p.name)).toEqual(expect.arrayContaining(["pH", "Hőmérséklet"]));
    expect(Object.keys(grid.cells)).toHaveLength(0);
  });

  it("a day that merely exists, with no value: no Excel row, no ZIMS file, no report line, no missing-measurement signal", async () => {
    const { buffer } = await buildWaterWorkbook({ from: OLD_DAY, to: OLD_DAY, poolIds: null });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    for (const ws of wb.worksheets) expect(ws.actualRowCount, ws.name).toBeLessThanOrEqual(1); // the header at most
    const zims = await createZimsExport(f.admin, { requestId: rid(), from: OLD_DAY, to: OLD_DAY, poolIds: null, purpose: "PREVIEW" }).then(
      () => null,
      (e: unknown) => e,
    );
    expect((zims as AppError).code).toBe("NOTHING_TO_EXPORT");
    expect((await waterReport(OLD_DAY)).pools).toEqual([]);
    // The missing-measurement signal and the home page's count are not this test's: their callers pass today only
    // (src/app/page.tsx: dailyProgress(today), missedMeasurements(); src/lib/helpers.ts: missedMeasurements(now)), so an
    // old day is never asked. What the signal itself says for a day is in tests/integration/helpers.test.ts.
  });

  it("the migration moves only the open rows that began on 2026-01-01; a closed one and a later one stay", async () => {
    expect(HISTORY_SINCE.toISOString()).toBe("2018-12-06T23:00:00.000Z");
    const sql = readFileSync("prisma/migrations/20261102100000_water_tables_since_2018/migration.sql", "utf8")
      .split(";")
      .map((x) => x.replace(/^(\s*--[^\n]*\n)*/g, "").trim())
      .filter((x) => x.startsWith("UPDATE"));
    expect(sql).toHaveLength(9);
    const later = new Date("2026-03-01T00:00:00Z");
    // in a transaction that is rolled back: the shared test database keeps its rows
    const rolledBack = new Error("rollback");
    const seen = await ownerPrisma
      .$transaction(async (tx) => {
        // a pool of its own: the base data's pools have their names from 2018 already
        const pool = (await tx.pool.create({ data: { code: `MIGR_${rid().slice(-8)}` } })).id;
        const open = await tx.poolName.create({ data: { poolId: pool, displayName: "Nyitott 2026", validFrom: SINCE } });
        const closed = await tx.poolName.create({ data: { poolId: pool, displayName: "Zárt 2026", validFrom: SINCE, validTo: later } });
        const after = await tx.poolName.create({ data: { poolId: pool, displayName: "Később", validFrom: later } });
        // barracuda on #187: a thing that already has a row before 2026 keeps its open 2026 row where it is (no overlap)
        const other = f.pool("INKUBATOR");
        await tx.poolName.updateMany({ where: { poolId: other }, data: { validTo: new Date("2017-01-01T00:00:00Z") } });
        await tx.poolName.create({ data: { poolId: other, displayName: "Korábbi", validFrom: new Date("2016-01-01T00:00:00Z"), validTo: new Date("2017-01-01T00:00:00Z") } });
        const guarded = await tx.poolName.create({ data: { poolId: other, displayName: "Őrzött 2026", validFrom: SINCE } });
        for (const s of sql) await tx.$executeRawUnsafe(s);
        const rows = await tx.poolName.findMany({ where: { id: { in: [open.id, closed.id, after.id, guarded.id] } } });
        const at = (id: string) => rows.find((r) => r.id === id)!.validFrom.toISOString();
        throw Object.assign(rolledBack, { seen: [at(open.id), at(closed.id), at(after.id), at(guarded.id)] });
      })
      .catch((e: Error & { seen?: string[] }) => {
        if (e !== rolledBack) throw e;
        return e.seen!;
      });
    expect(seen).toEqual(["2018-12-06T23:00:00.000Z", SINCE.toISOString(), later.toISOString(), SINCE.toISOString()]);
    // nothing of it stayed
    expect(await prisma.poolName.count({ where: { displayName: { in: ["Nyitott 2026", "Zárt 2026", "Később", "Korábbi", "Őrzött 2026"] } } })).toBe(0);
  });
});
