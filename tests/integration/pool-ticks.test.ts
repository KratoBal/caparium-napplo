// The pool ticks of the daily water measurement (Lili 2026-10-29, task caparium-lili-nagyobb-m, item 8): visszamosás and
// rátöltés under the big pools, vízcsere under the small tanks; saved apart from the values, shown in the Excel and the
// PDF report, never in the ZIMS export (its code does not read them). February 2029: a month no other spec uses (the database is shared across files).
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { buildWaterWorkbook } from "@/lib/exports/excel";
import { createMeasurement } from "@/lib/measurements";
import { setPoolTick, ticksOfDay } from "@/lib/pool-ticks";
import { getGrid } from "@/lib/queries";
import { waterReport } from "@/lib/water-report";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => {
  f = await fixtures();
});
const code = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e as AppError).code);

const DAY = "2029-02-14"; // winter time: UTC+1
const now = new Date(`${DAY}T10:00:00+01:00`);
const tick = (pool: string, kind: "BACKWASH" | "TOPUP" | "WATER_CHANGE", done: boolean, group = "NAPI_NAGY", at = now, actor = f.aq1) =>
  setPoolTick(actor, { requestId: rid(), groupId: f.group(group), poolId: f.pool(pool), day: DAY, kind, done }, at);

describe("the pool ticks", () => {
  it("an aquarist ticks and unticks today's pool; the same request twice is one change; the grid carries them", async () => {
    await tick("NAGY", "BACKWASH", true);
    await tick("NAGY", "TOPUP", true);
    const req = rid();
    const input = { requestId: req, groupId: f.group("NAPI_NAGY"), poolId: f.pool("NAGY"), day: DAY, kind: "BACKWASH" as const, done: false };
    expect((await setPoolTick(f.aq1, input, now)).replayed).toBe(false);
    expect((await setPoolTick(f.aq1, input, now)).replayed).toBe(true);
    expect(await ticksOfDay(DAY)).toEqual({ [`${f.pool("NAGY")}:TOPUP`]: true });
    const grid = await getGrid(f.group("NAPI_NAGY"), DAY);
    expect(grid?.tickKinds).toEqual(["BACKWASH", "TOPUP"]);
    expect(grid?.ticks).toEqual({ [`${f.pool("NAGY")}:TOPUP`]: true });
    // unticking what is not ticked changes nothing
    await tick("NAGY", "BACKWASH", false);
    expect(Object.keys(await ticksOfDay(DAY))).toHaveLength(1);
    await tick("NAGY", "BACKWASH", true); // back on for the reports below
    // the small tanks have their own kind, and a weekly group has none
    await tick("KORALLOS", "WATER_CHANGE", true, "NAPI_KIS");
    expect(Object.keys(await ticksOfDay(DAY)).sort()).toEqual([`${f.pool("KORALLOS")}:WATER_CHANGE`, `${f.pool("NAGY")}:BACKWASH`, `${f.pool("NAGY")}:TOPUP`].sort());
    expect((await getGrid(f.group("HETI"), DAY))?.tickKinds).toEqual([]);
  });

  it("refuses a kind the group does not have, a pool that is not in the group, another day for an aquarist; an admin may", async () => {
    expect(await code(tick("NAGY", "WATER_CHANGE", true))).toBe("TICK_NOT_FOR_GROUP");
    expect(await code(tick("KIS", "BACKWASH", true, "NAPI_NAGY"))).toBe("POOL_NOT_IN_GROUP");
    expect(await code(tick("NAGY", "TOPUP", false, "NAPI_NAGY", new Date("2029-02-15T10:00:00+01:00")))).toBe("NOT_TODAY");
    await tick("KARANTEN", "BACKWASH", true, "NAPI_NAGY", new Date("2029-02-15T10:00:00+01:00"), f.admin); // an admin, another day
    expect(Object.keys(await ticksOfDay(DAY))).toContain(`${f.pool("KARANTEN")}:BACKWASH`);
    await tick("KARANTEN", "BACKWASH", false, "NAPI_NAGY", new Date("2029-02-15T10:00:00+01:00"), f.admin);
  });

  it("the Excel carries 'volt' once per pool and day under its column, on the first row; the report lists the ticks", async () => {
    const measure = (param: string, value: string, time: string) =>
      createMeasurement(
        f.aq1,
        { requestId: rid(), groupId: f.group("NAPI_NAGY"), poolId: f.pool("NAGY"), parameterId: f.param(param), value, measuredAtLocal: `${DAY}T${time}` },
        new Date(`${DAY}T${time}:00+01:00`),
      );
    await measure("PH", "8,1", "09:00");
    await measure("TEMP", "24", "09:05");
    const { buffer } = await buildWaterWorkbook({ from: DAY, to: DAY, poolIds: [f.pool("NAGY")] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    for (const name of ["Vízmérés teljes", "Nagymedence"]) {
      const ws = wb.getWorksheet(name)!;
      expect((ws.getRow(1).values as unknown[]).slice(11), name).toEqual(["Visszamosás", "Rátöltés", "Vízcsere"]);
      const ticksOf = (r: number) => [11, 12, 13].map((c) => ws.getRow(r).getCell(c).value ?? "");
      expect(ticksOf(2), name).toEqual(["volt", "volt", ""]); // the first row of the pool and the day
      expect(ticksOf(3), name).toEqual(["", "", ""]); // the second row of the same day: not repeated
    }
    const report = await waterReport(DAY);
    expect(report.pools.find((p) => p.pool === "Nagymedence")?.ticks).toEqual(["BACKWASH", "TOPUP"]);
  });
});
