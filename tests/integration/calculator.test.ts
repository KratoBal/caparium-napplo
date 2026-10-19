// The calculator, the reference and the body weight log (adatmodell 9.; KALK-01, KALK-02, EGY-08,
// JAV-06). Instants in August 2026.
import { beforeAll, describe, expect, it } from "vitest";
import { invalidateBodyWeight, lastBodyWeight, recordBodyWeight, referencesOn, runCalculator } from "@/lib/calculator";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const a: Record<string, string> = {};
const at = (d: string, t: string) => new Date(`${d}T${t}:00+02:00`);

beforeAll(async () => {
  f = await fixtures();
  for (const n of await prisma.animalName.findMany()) a[n.name] = n.animalId;
});

async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e, `expected ${code}`).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
}

describe("body weight (JAV-06)", () => {
  it("an aquarist records today's weight; an earlier day is admin work with a reason; the last valid one is the calculator's BW", async () => {
    const id = a["Teszt Három"];
    await recordBodyWeight(f.aq1, { requestId: rid(), animalId: id, weightKg: "48,5" }, at("2026-08-03", "09:00"));
    await expectCode(recordBodyWeight(f.aq1, { requestId: rid(), animalId: id, measuredOn: "2026-08-01", weightKg: "47" }, at("2026-08-03", "09:05")), "NOT_TODAY");
    await expectCode(recordBodyWeight(f.admin, { requestId: rid(), animalId: id, measuredOn: "2026-08-01", weightKg: "47" }, at("2026-08-03", "09:05")), "REASON_REQUIRED");
    await recordBodyWeight(f.admin, { requestId: rid(), animalId: id, measuredOn: "2026-08-01", weightKg: "47", reason: "papírról" }, at("2026-08-03", "09:06"));
    const later = (await recordBodyWeight(f.aq1, { requestId: rid(), animalId: id, weightKg: "50" }, at("2026-08-05", "09:00"))) as { id: string };
    expect(await lastBodyWeight(id)).toEqual({ day: "2026-08-05", weightKg: "50" });
    await invalidateBodyWeight(f.aq1, later.id, { requestId: rid(), expectedVersion: 1, reason: "elírás" }, at("2026-08-05", "09:10"));
    expect(await lastBodyWeight(id)).toEqual({ day: "2026-08-03", weightKg: "48.5" });
    await expectCode(recordBodyWeight(f.aq1, { requestId: rid(), animalId: id, weightKg: "-1" }, at("2026-08-05", "09:00")), "INVALID_VALUE");
  });
});

describe("calculator and reference (KALK-01, KALK-02, EGY-08)", () => {
  it("a run stores its inputs and results; a save as reference is a new version, the old day keeps its old one", async () => {
    const id = a["Teszt Négy"];
    const first = (await runCalculator(f.aq1, { requestId: rid(), animalId: id, bwKg: "50", frWeekPct: 2, nWeek: 4, saveAsReference: true }, at("2026-08-10", "09:00"))) as { fG: number };
    expect(first.fG).toBe(250);
    expect((await referencesOn("2026-08-10", at("2026-08-10", "12:00")))[id]).toBe(250);
    // only computed, not saved as reference: the reference stays
    await runCalculator(f.aq1, { requestId: rid(), animalId: id, bwKg: "50", frWeekPct: 4, nWeek: 4 }, at("2026-08-11", "09:00"));
    expect((await referencesOn("2026-08-11", at("2026-08-11", "12:00")))[id]).toBe(250);
    await runCalculator(f.aq1, { requestId: rid(), animalId: id, bwKg: "60", frWeekPct: 2, nWeek: 3, saveAsReference: true }, at("2026-08-12", "09:00"));
    expect((await referencesOn("2026-08-12", at("2026-08-12", "12:00")))[id]).toBe(400);
    // the old day is measured against its old reference
    expect((await referencesOn("2026-08-10", at("2026-08-12", "12:00")))[id]).toBe(250);
    expect(await prisma.feedingReference.count({ where: { animalId: id, validTo: null } })).toBe(1);
    expect(await prisma.calculatorRun.count({ where: { animalId: id } })).toBe(3);
  });

  it("refuses inputs the description does not offer", async () => {
    await expectCode(runCalculator(f.aq1, { requestId: rid(), animalId: a["Teszt Egy"], bwKg: "50", frWeekPct: 2.3, nWeek: 4 }), "FR");
    await expectCode(runCalculator(f.aq1, { requestId: rid(), animalId: a["Teszt Egy"], bwKg: "50", frWeekPct: 2, nWeek: 9 }), "N");
  });
});
