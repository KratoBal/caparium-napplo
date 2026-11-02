// The fridges' daily temperature book (Lili 2026-11-02, task caparium-hutok): the settings, the range and its red, the defrost
// tick, the day rule, the correction, the Excel and PDF by month, and that the water exports never see a fridge.
// Days in March and April 2031, used by no other test.
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { buildWaterWorkbook } from "@/lib/exports/excel";
import { buildFridgePdf, buildFridgeWorkbook } from "@/lib/exports/fridge-export";
import { createZimsExport } from "@/lib/exports/zims";
import { createFridge, fridgeDay, fridgeReadings, invalidateFridgeReading, saveFridgeReading, updateFridge } from "@/lib/fridges";
import { createMeasurement } from "@/lib/measurements";
import { resolveLocalDateTime } from "@/lib/time";
import { waterReport } from "@/lib/water-report";
import { readPdfColors } from "../support/pdf-colors";
import { readPdfLines } from "../support/pdf-readback";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const at = (local: string) => resolveLocalDateTime(local)!.instant;
const fridge: Record<string, string> = {};

async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e, `expected ${code}`).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
}

beforeAll(async () => {
  f = await fixtures();
  for (const [name, kind, min, max] of [
    ["Teszt hűtő 1", "FRIDGE", "2", "8"],
    ["Teszt fagyasztó 1", "FREEZER", "-25", "-18"],
    ["Teszt hűtő zárható", "FRIDGE", "0", "6"],
  ] as const) {
    const r = (await createFridge(f.admin, { requestId: rid(), name, kind, min, max })) as { fridgeId: string };
    fridge[name] = r.fridgeId;
  }
});

const read = (local: string, name: string, temperature: string, actor = f?.aq1, extra: Record<string, unknown> = {}, now = at(local)) =>
  saveFridgeReading(actor, { requestId: rid(), fridgeId: fridge[name], measuredAtLocal: local, temperature, ...extra }, now) as Promise<{ readingId: string; outOfRange: boolean }>;

describe("the fridges in the settings", () => {
  it("only a settings admin adds or changes one; the range is a range; a name is taken once", async () => {
    await expectCode(createFridge(f.aq1, { requestId: rid(), name: "Teszt hűtő tilos", kind: "FRIDGE", min: "2", max: "8" }), "ADMIN_ONLY");
    await expectCode(createFridge(f.admin, { requestId: rid(), name: "Teszt hűtő fordított", kind: "FRIDGE", min: "8", max: "2" }), "RANGE_ORDER");
    await expectCode(createFridge(f.admin, { requestId: rid(), name: "Teszt hűtő 1", kind: "FRIDGE", min: "1", max: "5" }), "NAME_TAKEN");
    // the name goes into the Excel: no leading formula character
    await expect(createFridge(f.admin, { requestId: rid(), name: "=Teszt", kind: "FRIDGE", min: "1", max: "5" })).rejects.toThrow(/képletként/);
    await expectCode(updateFridge(f.aq1, fridge["Teszt hűtő 1"], { requestId: rid(), max: "9" }), "ADMIN_ONLY");
  });
});

describe("a reading: the range, the defrost, the note", () => {
  it("inside the range (the limits too) is not red; below or above is; a freezer's range is below zero", async () => {
    expect((await read("2031-03-27T08:00", "Teszt hűtő 1", "4,5")).outOfRange).toBe(false);
    expect((await read("2031-03-27T08:01", "Teszt hűtő 1", "8")).outOfRange).toBe(false);
    expect((await read("2031-03-27T08:02", "Teszt hűtő 1", "8,1")).outOfRange).toBe(true);
    expect((await read("2031-03-27T08:03", "Teszt hűtő 1", "1,9")).outOfRange).toBe(true);
    expect((await read("2031-03-27T08:04", "Teszt fagyasztó 1", "-20")).outOfRange).toBe(false);
    expect((await read("2031-03-27T08:05", "Teszt fagyasztó 1", "-12", f.aq1, { defrost: true, note: "leolvasztás után" })).outOfRange).toBe(true);
    const day = await fridgeDay("2031-03-27");
    const freezer = day.readings.filter((r) => r.fridgeId === fridge["Teszt fagyasztó 1"]);
    expect(freezer.map((r) => [r.temperature, r.defrost, r.note, r.outOfRange])).toEqual([
      ["-20", false, null, false],
      ["-12", true, "leolvasztás után", true],
    ]);
  });

  it("a typo is refused: more than one decimal, a word, a number no thermometer of a fridge says", async () => {
    await expectCode(read("2031-03-27T09:00", "Teszt hűtő 1", "4,55"), "INVALID_TEMPERATURE");
    await expectCode(read("2031-03-27T09:00", "Teszt hűtő 1", "hideg"), "INVALID_TEMPERATURE");
    await expectCode(read("2031-03-27T09:00", "Teszt hűtő 1", "45"), "IMPLAUSIBLE_TEMPERATURE");
    // the note goes into the Excel as the name does: no leading formula character (barracuda on #190)
    for (const note of ["=HYPERLINK(1)", "+1", "-5 reggel", "@x"]) await expect(read("2031-03-27T09:00", "Teszt hűtő 1", "4", f.aq1, { note })).rejects.toThrow(/megjegyzés nem kezdődhet/);
    expect((await read("2031-03-27T09:01", "Teszt hűtő 1", "4", f.aq1, { note: "reggel -5 fok volt kint" })).outOfRange).toBe(false);
  });

  it("a new range acts from now on: the reading taken before keeps its own and does not turn red", async () => {
    await read("2031-03-28T07:00", "Teszt hűtő zárható", "5");
    await updateFridge(f.admin, fridge["Teszt hűtő zárható"], { requestId: rid(), max: "4" });
    expect((await read("2031-03-28T07:30", "Teszt hűtő zárható", "5")).outOfRange).toBe(true);
    const rows = (await fridgeDay("2031-03-28")).readings.filter((r) => r.fridgeId === fridge["Teszt hűtő zárható"]);
    expect(rows.map((r) => [r.max, r.outOfRange])).toEqual([
      ["6", false],
      ["4", true],
    ]);
  });
});

describe("who and when", () => {
  it("an aquarist records on today only; an admin on an earlier day too; nobody in the future", async () => {
    await expectCode(read("2031-03-26T08:00", "Teszt hűtő 1", "4", f.aq1, {}, at("2031-03-27T10:00")), "NOT_TODAY");
    expect((await read("2031-03-26T08:00", "Teszt hűtő 1", "4", f.admin, {}, at("2031-03-27T10:00"))).outOfRange).toBe(false);
    await expectCode(read("2031-03-27T12:00", "Teszt hűtő 1", "4", f.admin, {}, at("2031-03-27T10:00")), "FUTURE_TIME");
  });

  it("without a time the reading is taken now", async () => {
    const now = at("2031-03-27T13:17");
    const r = (await saveFridgeReading(f.aq2, { requestId: rid(), fridgeId: fridge["Teszt hűtő 1"], temperature: "5" }, now)) as { readingId: string };
    const row = await prisma.fridgeReading.findUniqueOrThrow({ where: { id: r.readingId } });
    expect(row.measuredAt.toISOString()).toBe(now.toISOString());
  });

  it("a closed fridge takes no new reading and leaves the daily card, its readings stay; opened again it takes one", async () => {
    const id = fridge["Teszt hűtő zárható"];
    await updateFridge(f.admin, id, { requestId: rid(), active: false });
    await expectCode(read("2031-03-29T08:00", "Teszt hűtő zárható", "3"), "FRIDGE_CLOSED");
    expect((await fridgeDay("2031-03-29")).fridges.some((x) => x.id === id)).toBe(false);
    // an old day keeps the closed fridge's row with its readings
    expect((await fridgeDay("2031-03-28")).fridges.some((x) => x.id === id)).toBe(true);
    await updateFridge(f.admin, id, { requestId: rid(), active: true });
    expect((await read("2031-03-29T08:05", "Teszt hűtő zárható", "3")).outOfRange).toBe(false);
  });

  it("a reader of the water module records nothing", async () => {
    const reader = await prisma.user.create({ data: { loginId: `olvaso-hutok-${rid()}`, fullName: "Olvasó Hűtős", role: "AQUARIST", passwordHash: "x" } });
    await prisma.modulePermission.create({ data: { userId: reader.id, module: "WATER", level: "READ" } });
    await expectCode(read("2031-03-27T08:30", "Teszt hűtő 1", "4", { id: reader.id, role: "AQUARIST" }), "READ_ONLY");
  });
});

describe("a correction: invalidated and recorded again, nothing overwritten", () => {
  it("another aquarist corrects the reading of the day; the old row stays, invalidated, audited; a second correction of it is a conflict", async () => {
    const first = await read("2031-03-30T09:00", "Teszt hűtő 1", "12");
    const now = at("2031-03-30T09:10");
    const fixed = (await saveFridgeReading(
      f.aq2,
      { requestId: rid(), fridgeId: fridge["Teszt hűtő 1"], replacesId: first.readingId, expectedVersion: 1, measuredAtLocal: "2031-03-30T09:00", temperature: "2,1" },
      now,
    )) as { readingId: string; outOfRange: boolean };
    expect(fixed.outOfRange).toBe(false);
    const old = await prisma.fridgeReading.findUniqueOrThrow({ where: { id: first.readingId } });
    expect([old.status, old.version, old.temperatureC.toString()]).toEqual(["INVALIDATED", 2, "12"]);
    expect((await fridgeReadings("2031-03-30", "2031-03-30")).map((r) => r.temperature)).toEqual(["2.1"]);
    const audit = await prisma.auditEntry.findMany({ where: { entityType: "FridgeReading", entityId: { in: [first.readingId, fixed.readingId] } } });
    // the invalidation and the new reading are one transaction (one timestamp): compared as a set
    expect(audit.map((a) => `${a.entityId === first.readingId ? "old" : "new"} ${a.action} ${a.userId === f.aq1.id ? "aq1" : "aq2"}`).sort()).toEqual([
      "new CREATE aq2",
      "old CREATE aq1",
      "old INVALIDATE aq2",
    ]);
    await expectCode(
      saveFridgeReading(f.aq1, { requestId: rid(), fridgeId: fridge["Teszt hűtő 1"], replacesId: first.readingId, expectedVersion: 1, temperature: "3" }, now),
      "NOT_EDITABLE",
    );
  });

  it("an aquarist does not correct an earlier day; an invalidation leaves the reading out of the book", async () => {
    const r = await read("2031-03-31T08:00", "Teszt hűtő 1", "4");
    await expectCode(
      saveFridgeReading(f.aq1, { requestId: rid(), fridgeId: fridge["Teszt hűtő 1"], replacesId: r.readingId, expectedVersion: 1, temperature: "5" }, at("2031-04-01T08:00")),
      "NOT_TODAY",
    );
    await invalidateFridgeReading(f.aq1, r.readingId, { requestId: rid(), expectedVersion: 1, reason: "rossz hűtő" }, at("2031-03-31T08:10"));
    expect((await fridgeReadings("2031-03-31", "2031-03-31")).length).toBe(0);
  });
});

describe("the export: Excel and PDF by month", () => {
  it("one sheet per month, the period's readings in time order, red outside the range; the PDF says the same", async () => {
    await read("2031-04-02T08:00", "Teszt hűtő 1", "3,5");
    await read("2031-04-02T08:01", "Teszt fagyasztó 1", "-10", f.aq1, { defrost: true, note: "jégmentesítés" });
    const { buffer, rows, sheets } = await buildFridgeWorkbook("2031-03-27", "2031-04-02");
    expect(sheets).toEqual(["2031. március", "2031. április"]);
    const all = await fridgeReadings("2031-03-27", "2031-04-02");
    expect(rows).toBe(all.length);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const april = wb.getWorksheet("2031. április")!;
    expect(april.getRow(1).values).toEqual([undefined, "Dátum", "Idő", "Hűtő", "Fajta", "Hőmérséklet (°C)", "Minimum (°C)", "Maximum (°C)", "Leolvasztás", "Megjegyzés", "Rögzítette"]);
    const r2 = april.getRow(2).values as unknown[];
    const r3 = april.getRow(3).values as unknown[];
    expect(r2.slice(1, 9)).toEqual(["2031.04.02.", "08:00", "Teszt hűtő 1", "hűtő", 3.5, 2, 8, ""]);
    expect(r3.slice(1, 10)).toEqual(["2031.04.02.", "08:01", "Teszt fagyasztó 1", "fagyasztó", -10, -25, -18, "igen", "jégmentesítés"]);
    expect(april.getRow(2).getCell(5).font?.color?.argb).toBeUndefined();
    expect(april.getRow(3).getCell(5).font?.color?.argb).toBe("FFDF5B5B");
    expect(april.rowCount).toBe(3);

    const pdf = await buildFridgePdf("2031-03-27", "2031-04-02");
    expect(pdf.rows).toBe(all.length);
    const lines = await readPdfLines(new Uint8Array(pdf.buffer));
    expect(lines[0]).toBe("Hűtők hőmérséklete: 2031.03.27. – 2031.04.02.");
    expect(lines.some((l) => l.startsWith("2031. március ("))).toBe(true);
    expect(lines).toContain("2031. április (2 leolvasás, ebből 1 tartományon kívül)");
    expect(lines.some((l) => l.startsWith("2031.04.02. 08:01 Teszt fagyasztó 1 fagyasztó -10 -25 – -18 igen jégmentesítés"))).toBe(true);
    // red as drawn: the out-of-range temperature, and only the temperature of its row
    const colors = await readPdfColors(new Uint8Array(pdf.buffer));
    expect(colors.texts.find((t) => t.text === "-10")?.color).toBe("#c0392b");
    expect(colors.texts.find((t) => t.text === "3,5")?.color).toBe("#000000");
    expect(colors.texts.find((t) => t.text === "jégmentesítés")?.color).toBe("#000000");
  });

  it("an empty period is a file that says so", async () => {
    const { rows, sheets } = await buildFridgeWorkbook("2031-05-01", "2031-05-02");
    expect([rows, sheets]).toEqual([0, ["Hűtők hőmérséklete"]]);
    const lines = await readPdfLines(new Uint8Array((await buildFridgePdf("2031-05-01", "2031-05-02")).buffer));
    expect(lines).toContain("Az időszakban nem volt leolvasás.");
  });
});

describe("the water exports never see a fridge (Lili's worry)", () => {
  it("the water Excel, the ZIMS files and the water report of a day with fridge readings hold only the water measurement", async () => {
    const day = "2031-04-03";
    await createMeasurement(
      f.aq1,
      { requestId: rid(), groupId: f.group("NAPI_NAGY"), poolId: f.pool("NAGY"), parameterId: f.param("PH"), value: "8.1", measuredAtLocal: `${day}T08:00` },
      at(`${day}T08:00`),
    );
    await read(`${day}T08:05`, "Teszt hűtő 1", "4");
    await read(`${day}T08:06`, "Teszt fagyasztó 1", "-19");
    const water = await buildWaterWorkbook({ from: day, to: day, poolIds: null });
    expect(water.rows).toBe(1);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(water.buffer as unknown as ArrayBuffer);
    const text = wb.worksheets.flatMap((ws) => ws.getSheetValues().flat().map(String)).join("|");
    expect(text).not.toMatch(/Teszt hűtő|Teszt fagyasztó/);
    const zims = (await createZimsExport(f.aq1, { requestId: rid(), from: day, to: day, poolIds: null, purpose: "PREVIEW" })) as { runId: string };
    const files = await prisma.exportFile.findMany({ where: { exportRunId: zims.runId } });
    expect(files.reduce((n, x) => n + x.rowCount, 0)).toBe(1);
    expect(files.map((x) => x.content ?? "").join("")).not.toMatch(/hűtő|fagyasztó/i);
    expect(JSON.stringify(await waterReport(day))).not.toMatch(/Teszt hűtő|Teszt fagyasztó/);
  });
});
