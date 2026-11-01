// Lili 2026-11-01 (point 13): a parameter's tester conversion from a day on (Beállítások), and the measurements made
// with it: the server converts the reading again, keeps it, and a value typed directly drops it. Days in March 2026, used by
// no other test.
import { beforeAll, describe, expect, it } from "vitest";
import { conversionAt, setConversion } from "@/lib/conversion";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createMeasurement, updateMeasurement } from "@/lib/measurements";
import { getGrid } from "@/lib/queries";
import { cest, fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => {
  f = await fixtures();
});

async function code(p: Promise<unknown>): Promise<string> {
  const e = await p.then(() => null, (err: unknown) => err);
  expect(e).toBeInstanceOf(AppError);
  return (e as AppError).code;
}

const set = (over: Record<string, unknown>) =>
  setConversion(f.admin, { requestId: rid("conv"), parameterId: f.param("PO4"), label: "Hanna HI736", factor: "0,003066", decimals: 3, from: "2026-03-11", ...over } as Parameters<typeof setConversion>[1]);

function measure(day: string, over: Record<string, unknown>) {
  return createMeasurement(
    f.aq1,
    { requestId: rid(), groupId: f.group("HETI"), poolId: f.pool("NAGY"), parameterId: f.param("PO4"), value: "0", measuredAtLocal: `${day}T09:00`, ...over } as Parameters<typeof createMeasurement>[1],
    cest(`${day}T09:00`),
  );
}

describe("tester conversion", () => {
  it("only an admin sets it, and the factor must be a positive number", async () => {
    expect(await code(setConversion(f.aq1, { requestId: rid(), parameterId: f.param("PO4"), label: "x", factor: "1", decimals: 1, from: "2026-03-11" }))).toBe("ADMIN_ONLY");
    expect(await code(set({ factor: "0" }))).toBe("INVALID_FACTOR");
    expect(await code(set({ factor: "abc" }))).toBe("INVALID_FACTOR");
  });

  it("before its day a reading is refused; from its day the server converts the reading and keeps it", async () => {
    expect(await code(measure("2026-03-10", { value: "30", rawReading: "30" }))).toBe("NO_CONVERSION");
    await set({});
    const c = await conversionAt(prisma, f.param("PO4"), cest("2026-03-11T12:00"));
    expect(c).toMatchObject({ label: "Hanna HI736", factor: "0.003066", decimals: 3 });
    // the browser's value is not trusted: "0.5" sent, the server's 30 x 0.003066 = 0.092 stored
    const m = await measure("2026-03-12", { value: "0.5", rawReading: "30" });
    expect(m.measurement).toMatchObject({ value: "0.092", rawReading: "30" });
    const row = await prisma.measurement.findUniqueOrThrow({ where: { id: m.measurement.id } });
    expect(row.conversionId).toBe(c!.id);
    // the grid shows the dot's data: the reading and the conversion's name
    const grid = await getGrid(f.group("HETI"), "2026-03-12");
    const cell = grid!.cells[`${f.pool("NAGY")}:${f.param("PO4")}`];
    expect(cell).toMatchObject({ value: "0.092", rawReading: "30", conversionLabel: "Hanna HI736" });
    expect(grid!.layout.parameters.find((p) => p.id === f.param("PO4"))!.conversion).toMatchObject({ factor: "0.003066", decimals: 3 });
    // barracuda on #167: while the conversion is in force a value comes only as a reading (a page loaded before it was set sends
    // the reading as the value); refused, nothing written
    const before = await prisma.measurement.count({ where: { parameterId: f.param("PO4"), businessDay: new Date("2026-03-13") } });
    expect(await code(measure("2026-03-13", { value: "12" }))).toBe("CONVERSION_IN_FORCE");
    expect(await prisma.measurement.count({ where: { parameterId: f.param("PO4"), businessDay: new Date("2026-03-13") } })).toBe(before);
  });

  it("an edit with a new reading converts again; a value typed over it is refused; a change without a value goes through", async () => {
    const m = await measure("2026-03-14", { rawReading: "17" });
    expect(m.measurement.value).toBe("0.052");
    const again = await updateMeasurement(f.aq1, m.measurement.id, { requestId: rid(), expectedVersion: 1, value: "x", rawReading: "40" }, cest("2026-03-14T09:30"));
    expect(again.measurement).toMatchObject({ value: "0.123", rawReading: "40" }); // 0.12264
    expect(await code(updateMeasurement(f.aq1, m.measurement.id, { requestId: rid(), expectedVersion: 2, value: "0,2" }, cest("2026-03-14T09:40")))).toBe("CONVERSION_IN_FORCE");
    expect(await code(updateMeasurement(f.aq1, m.measurement.id, { requestId: rid(), expectedVersion: 2, rawReading: null }, cest("2026-03-14T09:41")))).toBe("CONVERSION_IN_FORCE");
    // the trainee flag only, no value: the reading and the value stay
    const meta = await updateMeasurement(f.aq1, m.measurement.id, { requestId: rid(), expectedVersion: 2, traineePerformed: true }, cest("2026-03-14T09:45"));
    expect(meta.measurement).toMatchObject({ value: "0.123", rawReading: "40", traineePerformed: true });
  });

  it("a same-day change corrects the row only while no measurement used it; a later day starts a new one", async () => {
    expect(await code(set({ factor: "0,003" }))).toBe("CONVERSION_USED");
    await set({ factor: "0,0031", from: "2026-03-18" });
    const old = await conversionAt(prisma, f.param("PO4"), cest("2026-03-17T12:00"));
    const now = await conversionAt(prisma, f.param("PO4"), cest("2026-03-18T12:00"));
    expect(old!.factor).toBe("0.003066");
    expect(now!.factor).toBe("0.0031");
    // corrected on its own day before anyone measured with it
    await set({ factor: "0,0032", from: "2026-03-18" });
    expect((await conversionAt(prisma, f.param("PO4"), cest("2026-03-18T12:00")))!.factor).toBe("0.0032");
    // an earlier start than an existing later one is refused
    expect(await code(set({ from: "2026-03-16" }))).toBe("LATER_EXISTS");
    // the measurement of 02-03 kept its own conversion and value
    const kept = await prisma.measurement.findFirstOrThrow({ where: { businessDay: new Date("2026-03-12"), parameterId: f.param("PO4"), rawReading: { not: null } }, include: { conversion: true } });
    expect(kept.conversion!.factor.toString()).toBe("0.003066");
  });

  it("ended from a day, typed values are the values again and a reading is refused", async () => {
    await setConversion(f.admin, { requestId: rid(), parameterId: f.param("PO4"), label: null, factor: null, decimals: null, from: "2026-03-25" });
    expect(await conversionAt(prisma, f.param("PO4"), cest("2026-03-26T12:00"))).toBeNull();
    expect(await code(measure("2026-03-26", { value: "30", rawReading: "30" }))).toBe("NO_CONVERSION");
    expect((await measure("2026-03-27", { value: "0,04" })).measurement.value).toBe("0.04");
    expect(await code(setConversion(f.admin, { requestId: rid(), parameterId: f.param("PO4"), label: null, factor: null, decimals: null, from: "2026-03-29" }))).toBe("NO_CONVERSION");
  });

  it("the database keeps the reading and its conversion together", async () => {
    const m = await measure("2026-03-28", { value: "0,03" });
    await expect(prisma.measurement.update({ where: { id: m.measurement.id }, data: { rawReading: "12" } })).rejects.toThrow(/measurement_raw_reading_pair/);
  });
});
