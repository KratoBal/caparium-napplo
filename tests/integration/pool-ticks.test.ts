// The pool ticks of the daily water measurement (Lili 2026-10-29, task caparium-lili-nagyobb-m, item 8): visszamosás and
// rátöltés under the big pools, vízcsere under the small tanks; saved apart from the values, shown in the Excel (not in the PDF report, Lili
// 2026-10-29 22:01), never in the ZIMS export (its code does not read them). February 2029: a month no other spec uses (the database is shared across files).
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { buildWaterWorkbook } from "@/lib/exports/excel";
import { createMeasurement } from "@/lib/measurements";
import { setPoolTick, ticksOfDay } from "@/lib/pool-ticks";
import { getGrid } from "@/lib/queries";
import { waterReport } from "@/lib/water-report";
import { waterReportPdf } from "@/lib/water-report-pdf";
import { readPdfLines } from "../support/pdf-readback";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => {
  f = await fixtures();
});
const code = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e as AppError).code);

const DAY = "2029-02-14"; // winter time: UTC+1
const now = new Date(`${DAY}T10:00:00+01:00`);
const tick = (pool: string, kind: "BACKWASH" | "BACKWASH_2" | "BACKWASH_3" | "TOPUP" | "WATER_CHANGE", done: boolean, group = "NAPI_NAGY", at = now, actor = f.aq1) =>
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
    // Lili 2026-11-01 23:30-23:32 UTC: "Rátöltés" first; the Nagymedence's backwash is its three sand filters, the others' one tick
    expect(grid?.tickKinds[f.pool("NAGY")]).toEqual(["TOPUP", "BACKWASH", "BACKWASH_2", "BACKWASH_3"]);
    expect(grid?.tickKinds[f.pool("KIS")]).toEqual(["TOPUP", "BACKWASH"]);
    expect(grid?.ticks).toEqual({ [`${f.pool("NAGY")}:TOPUP`]: true });
    // unticking what is not ticked changes nothing
    await tick("NAGY", "BACKWASH", false);
    expect(Object.keys(await ticksOfDay(DAY))).toHaveLength(1);
    await tick("NAGY", "BACKWASH", true); // back on for the reports below
    // the small tanks have their own kind, and a weekly group has none
    await tick("KORALLOS", "WATER_CHANGE", true, "NAPI_KIS");
    expect(Object.keys(await ticksOfDay(DAY)).sort()).toEqual([`${f.pool("KORALLOS")}:WATER_CHANGE`, `${f.pool("NAGY")}:BACKWASH`, `${f.pool("NAGY")}:TOPUP`].sort());
    expect(Object.values((await getGrid(f.group("HETI"), DAY))!.tickKinds).flat()).toEqual([]);
  });

  it("refuses a kind the group does not have, a pool that is not in the group, another day for an aquarist; an admin may", async () => {
    expect(await code(tick("NAGY", "WATER_CHANGE", true))).toBe("TICK_NOT_FOR_GROUP");
    // the second and third sand filter are the Nagymedence's only
    expect(await code(tick("KIS", "BACKWASH_2", true))).toBe("TICK_NOT_FOR_GROUP");
    expect(await code(tick("KORALLOS", "BACKWASH", true, "NAPI_NAGY"))).toBe("POOL_NOT_IN_GROUP");
    expect(await code(tick("NAGY", "TOPUP", false, "NAPI_NAGY", new Date("2029-02-15T10:00:00+01:00")))).toBe("NOT_TODAY");
    await tick("KARANTEN", "BACKWASH", true, "NAPI_NAGY", new Date("2029-02-15T10:00:00+01:00"), f.admin); // an admin, another day
    expect(Object.keys(await ticksOfDay(DAY))).toContain(`${f.pool("KARANTEN")}:BACKWASH`);
    await tick("KARANTEN", "BACKWASH", false, "NAPI_NAGY", new Date("2029-02-15T10:00:00+01:00"), f.admin);
  });

  it("the Excel carries 'volt' once per pool and day under its column, on the first row; the PDF report does not show them", async () => {
    const measure = (param: string, value: string, time: string) =>
      createMeasurement(
        f.aq1,
        { requestId: rid(), groupId: f.group("NAPI_NAGY"), poolId: f.pool("NAGY"), parameterId: f.param(param), value, measuredAtLocal: `${DAY}T${time}` },
        new Date(`${DAY}T${time}:00+01:00`),
      );
    await measure("PH", "8,1", "09:00");
    await measure("TEMP", "24", "09:05");
    // the Nagymedence's first sand filter (its BACKWASH, on above) and its third; the Kismedence's one backwash
    await tick("NAGY", "BACKWASH_3", true);
    await tick("KIS", "BACKWASH", true);
    await createMeasurement(
      f.aq1,
      { requestId: rid(), groupId: f.group("NAPI_NAGY"), poolId: f.pool("KIS"), parameterId: f.param("PH"), value: "8,2", measuredAtLocal: `${DAY}T09:10` },
      new Date(`${DAY}T09:10:00+01:00`),
    );
    const { buffer } = await buildWaterWorkbook({ from: DAY, to: DAY, poolIds: [f.pool("NAGY"), f.pool("KIS")] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ticksOf = (ws: ExcelJS.Worksheet, r: number) => [12, 13, 14, 15, 16, 17].map((c) => ws.getRow(r).getCell(c).value ?? "");
    for (const name of ["Vízmérés teljes", "Nagymedence", "Kismedence"]) {
      const ws = wb.getWorksheet(name)!;
      // Lili 2026-11-01 23:30-23:32 UTC: "Rátöltés" first, the Nagymedence's sand filters HSZ1-HSZ3
      expect((ws.getRow(1).values as unknown[]).slice(12), name).toEqual(["Rátöltés", "Visszamosás", "HSZ1", "HSZ2", "HSZ3", "Vízcsere"]);
    }
    for (const name of ["Vízmérés teljes", "Nagymedence"]) {
      const ws = wb.getWorksheet(name)!;
      expect(ticksOf(ws, 2), name).toEqual(["volt", "", "volt", "", "volt", ""]); // the first row of the pool and the day
      expect(ticksOf(ws, 3), name).toEqual(["", "", "", "", "", ""]); // the second row of the same day: not repeated
    }
    // the Kismedence's backwash under "Visszamosás", not under HSZ1
    expect(ticksOf(wb.getWorksheet("Kismedence")!, 2)).toEqual(["", "volt", "", "", "", ""]);
    // Lili (acrobot msg 38143, 2026-10-29 22:01): the ticks are NOT in the PDF report, only in the Excel
    const report = await waterReport(DAY);
    expect(report.pools.find((p) => p.pool === "Nagymedence")).toBeDefined();
    const lines = await readPdfLines(await waterReportPdf(report));
    expect(lines.find((l) => l.startsWith("Nagymedence"))).toBe("Nagymedence");
    expect(lines.join("\n")).not.toMatch(/visszamos|rátölt|vízcsere/i);
  });
});
