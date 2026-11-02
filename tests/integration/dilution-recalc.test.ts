// acrobot 39888: the weekly rows saved before the dilution became a factor (value the reading, baseValue empty), counted in a
// dry run and recalculated on confirmation. Days in early July 2026, their own pools' weekly rows.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { dilutionRecalc } from "@/lib/dilution-recalc";
import { AppError } from "@/lib/errors";
import { createMeasurement } from "@/lib/measurements";
import { cest, fixtures, ownerPrisma, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => {
  f = await fixtures();
});

async function code(p: Promise<unknown>): Promise<string> {
  const e = await p.then(() => null, (err: unknown) => err);
  expect(e).toBeInstanceOf(AppError);
  return (e as AppError).code;
}

/** A weekly row as it was saved before the factor: the typed value, the dilution a note beside it. */
async function oldRow(day: string, pool: string, param: string, value: string, dilution: number) {
  const r = await createMeasurement(
    f.aq1,
    { requestId: rid(), groupId: f.group("HETI"), poolId: f.pool(pool), parameterId: f.param(param), value, measuredAtLocal: `${day}T09:00`, newRound: true } as Parameters<typeof createMeasurement>[1],
    cest(`${day}T09:05`),
  );
  await ownerPrisma.measurement.update({ where: { id: r.measurement.id }, data: { dilution } });
  return r.measurement.id;
}

type Plan = { count: number; notValid: number; parameters: { parameter: string; count: number; firstDay: string; lastDay: string }[]; rows: { id: string; result: string }[] };
const plan = async () => ((await dilutionRecalc(f.admin, { requestId: rid(), mode: "plan" })) as { plan: Plan }).plan;

describe("the old diluted rows (acrobot 39888)", () => {
  it("a dry run counts them by parameter with the day range; the run multiplies them, keeps the reading, audits each", async () => {
    const no3 = await oldRow("2026-07-06", "KORALLOS", "NO3", "8,4", 10);
    const po4 = await oldRow("2026-07-08", "KORALLOS", "PO4", "0,05", 5);
    const gone = await oldRow("2026-07-09", "INKUBATOR", "NO3", "3", 10);
    await ownerPrisma.measurement.update({ where: { id: gone }, data: { status: "INVALIDATED" } });

    expect(await code(dilutionRecalc(f.aq1, { requestId: rid(), mode: "plan" }))).toBe("ADMIN_ONLY");
    const p = await plan();
    expect(p.rows.find((r) => r.id === no3)?.result).toBe("84");
    expect(p.rows.find((r) => r.id === po4)?.result).toBe("0.25");
    expect(p.rows.some((r) => r.id === gone)).toBe(false);
    expect(p.notValid).toBeGreaterThanOrEqual(1);
    const no3Line = p.parameters.find((x) => x.parameter === "NO3")!;
    expect(no3Line.count).toBeGreaterThanOrEqual(1);
    expect(no3Line.firstDay <= "2026-07-06" && no3Line.lastDay >= "2026-07-06").toBe(true);
    // nothing written by the dry run
    expect((await prisma.measurement.findUniqueOrThrow({ where: { id: no3 } })).baseValue).toBeNull();

    // the run needs the dry run's number, and refuses another
    expect(await code(dilutionRecalc(f.admin, { requestId: rid(), mode: "run" }))).toBe("EXPECTED_REQUIRED");
    expect(await code(dilutionRecalc(f.admin, { requestId: rid(), mode: "run", expected: p.count + 1 }))).toBe("COUNT_CHANGED");
    const request = rid();
    expect(await dilutionRecalc(f.admin, { requestId: request, mode: "run", expected: p.count })).toEqual({ replayed: false, recalculated: p.count });
    const after = await prisma.measurement.findMany({ where: { id: { in: [no3, po4, gone] } } });
    const of = (id: string) => after.find((m) => m.id === id)!;
    expect([of(no3).value.toString(), of(no3).baseValue?.toString(), of(no3).dilution, of(no3).version]).toEqual(["84", "8.4", 10, 2]);
    expect([of(po4).value.toString(), of(po4).baseValue?.toString()]).toEqual(["0.25", "0.05"]);
    // the invalid row untouched
    expect([of(gone).value.toString(), of(gone).baseValue]).toEqual(["3", null]);
    const audits = await prisma.auditEntry.findMany({ where: { requestId: request, entityId: { in: [no3, po4] } } });
    expect(audits).toHaveLength(2);
    // the same request again does nothing; a second dry run finds none
    expect(await dilutionRecalc(f.admin, { requestId: request, mode: "run", expected: p.count })).toEqual({ replayed: true });
    expect((await plan()).count).toBe(0);
  });
});
