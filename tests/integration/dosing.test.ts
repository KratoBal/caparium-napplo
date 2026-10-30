// Chemical dosing and its stock (adatmodell 13.; ADA-01..ADA-06, JAV-09, R-16). Days in September
// 2026. The seeded synthetic chemicals: "Teszt só" kept in kg, "Teszt kalcium" kept in l.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createChemical, dosingLog, invalidateDosing, recordMovement, saveDosing, stockLevels } from "@/lib/dosing";
import { AppError } from "@/lib/errors";
import { runJournalJob } from "@/lib/journal";
import { dayToDate } from "@/lib/time";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const chem: Record<string, string> = {};
const unit: Record<string, string> = {};
const at = (d: string, t: string) => new Date(`${d}T${t}:00+02:00`);

beforeAll(async () => {
  f = await fixtures();
  for (const n of await prisma.chemicalName.findMany()) chem[n.name] = n.chemicalId;
  for (const u of await prisma.unit.findMany()) unit[u.symbol] = u.id;
});

async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e, `expected ${code}`).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
}

const level = async (name: string, now: Date) => (await stockLevels(now)).find((c) => c.id === chem[name])!;
const dose = (d: string, t: string, name: string, q: string, u: string, actor = f?.aq1, extra = {}) =>
  saveDosing(actor, { requestId: rid(), performedAtLocal: `${d}T${t}`, poolId: f.pool("SOZO"), chemicalId: chem[name], quantity: q, unitId: unit[u], ...extra }, at(d, t));

describe("dosing and its movement (ADA-01, ADA-02, R-16, JAV-09)", () => {
  it("a dosing in g lowers the stock kept in kg; without intake the level goes negative, flagged; an intake lifts it", async () => {
    const d = "2026-09-07";
    const before = (await level("Teszt só", at(d, "08:00"))).level;
    await dose(d, "09:00", "Teszt só", "500", "g");
    const after = await level("Teszt só", at(d, "09:30"));
    expect(after.level).toBeCloseTo(before - 0.5, 4);
    expect(after.unit).toBe("kg");
    expect(after.negative).toBe(after.level < 0);
    await recordMovement(f.admin, { requestId: rid(), chemicalId: chem["Teszt só"], quantity: "25", unitId: unit.kg, note: "zsák" }, at(d, "10:00"));
    expect((await level("Teszt só", at(d, "10:30"))).level).toBeCloseTo(before - 0.5 + 25, 4);
  });

  it("a chemical kept in a mass unit is not dosed in a volume unit (no density)", async () => {
    await expectCode(dose("2026-09-07", "11:00", "Teszt só", "1", "ml"), "UNIT_DIMENSION");
  });

  it("an amount that rounds to zero in the stock unit is a 422, not a failed check (review note on #15)", async () => {
    await expectCode(dose("2026-09-07", "11:05", "Teszt só", "0,0001", "g"), "ZERO_IN_STOCK");
  });

  it("an edit moves the movement with it; an invalidation takes it back (the log and the stock cannot drift)", async () => {
    const d = "2026-09-08";
    const start = (await level("Teszt kalcium", at(d, "08:00"))).level;
    const r = (await dose(d, "09:00", "Teszt kalcium", "200", "ml")) as { dosingId: string };
    expect((await level("Teszt kalcium", at(d, "09:30"))).level).toBeCloseTo(start - 0.2, 4);
    await dose(d, "09:00", "Teszt kalcium", "1", "l", f.aq1, { dosingId: r.dosingId, expectedVersion: 1 });
    expect((await level("Teszt kalcium", at(d, "09:40"))).level).toBeCloseTo(start - 1, 4);
    await invalidateDosing(f.aq1, r.dosingId, { requestId: rid(), expectedVersion: 2, reason: "rossz medence" }, at(d, "10:00"));
    expect((await level("Teszt kalcium", at(d, "10:30"))).level).toBeCloseTo(start, 4);
    const mv = await prisma.stockMovement.findUniqueOrThrow({ where: { dosingId: r.dosingId } });
    expect([mv.status, mv.quantity.toString()]).toEqual(["INVALIDATED", "-1"]);
  });

  it("weekly and monthly usage from the valid usage movements (ADA-06)", async () => {
    const now = at("2026-09-10", "12:00");
    await dose("2026-09-10", "09:00", "Teszt kalcium", "300", "ml");
    const c = await level("Teszt kalcium", now);
    expect(c.week).toBeGreaterThanOrEqual(0.3);
    expect(c.month).toBeGreaterThanOrEqual(c.week);
  });
});

describe("permissions and the day (K5, the DOSING journal day)", () => {
  it("an aquarist doses today, not an earlier day; an intake and a new chemical are admin work; midnight closes the day", async () => {
    await dose("2026-09-14", "09:00", "Teszt só", "1", "g");
    const earlier = { requestId: rid(), performedAtLocal: "2026-09-13T09:00", poolId: f.pool("SOZO"), chemicalId: chem["Teszt só"], quantity: "1", unitId: unit.g };
    await expectCode(saveDosing(f.aq1, earlier, at("2026-09-14", "09:05")), "NOT_TODAY");
    await expectCode(recordMovement(f.aq1, { requestId: rid(), chemicalId: chem["Teszt só"], quantity: "1", unitId: unit.kg }), "ADMIN_ONLY");
    await expectCode(createChemical(f.aq1, { requestId: rid(), name: "Teszt kálium", stockUnitId: unit.l }), "ADMIN_ONLY");
    await createChemical(f.admin, { requestId: rid(), name: "Teszt kálium", stockUnitId: unit.l });
    await expectCode(createChemical(f.admin, { requestId: rid(), name: "teszt KÁLIUM", stockUnitId: unit.l }), "NAME_TAKEN");
    await expectCode(recordMovement(f.admin, { requestId: rid(), chemicalId: chem["Teszt só"], quantity: "1", unitId: unit.kg, negative: true }), "INTAKE_NEGATIVE");
    await runJournalJob(at("2026-09-15", "00:05"));
    const j = await prisma.journalDay.findFirstOrThrow({ where: { kind: "DOSING", businessDay: dayToDate("2026-09-14") } });
    expect(j.state).toBe("CLOSED");
    await expectCode(saveDosing(f.aq1, { requestId: rid(), performedAtLocal: "2026-09-14T23:00", poolId: f.pool("SOZO"), chemicalId: chem["Teszt só"], quantity: "1", unitId: unit.g }, at("2026-09-15", "00:10")), "NOT_TODAY");
  });
});

describe("the log (ADA-05)", () => {
  it("filtered by period, pool and chemical; who did it by monogram; an invalidated row stays visible", async () => {
    const all = await dosingLog({ from: "2026-09-07", to: "2026-09-10", poolId: null, chemicalId: null });
    expect(all.length).toBeGreaterThanOrEqual(3);
    const ca = await dosingLog({ from: "2026-09-07", to: "2026-09-10", poolId: f.pool("SOZO"), chemicalId: chem["Teszt kalcium"] });
    expect(ca.every((r) => r.chemical === "Teszt kalcium" && r.pool === "Sózó")).toBe(true);
    expect(ca.some((r) => r.status === "INVALIDATED")).toBe(true);
    expect(ca[0].by).not.toBe("?");
    await expect(dosingLog({ from: "2026-09-10", to: "2026-09-07", poolId: null, chemicalId: null })).rejects.toMatchObject({ code: "BAD_PERIOD" });
  });
});

// Lili 2026-10-30 19:34 UTC (msg 1565811224229453956, card f5f97479, second point): "csak érvényteleníteni lehet, azt nem ha elírta, az értéket".
// The log row's "Javítás" is saveDosing with the row's id and version: the chemical, the pool and the amount are corrected in place.
describe("a correction of a dosing (card f5f97479)", () => {
  it("changes the chemical, the pool and the amount of a row: the log reads it, the stock moves from the old chemical to the new one, the audit says before and after", async () => {
    const d = "2026-09-18";
    const saltBefore = (await level("Teszt só", at(d, "08:00"))).level;
    const calciumBefore = (await level("Teszt kalcium", at(d, "08:00"))).level;
    const r = (await dose(d, "09:00", "Teszt só", "500", "g")) as { dosingId: string };
    expect((await level("Teszt só", at(d, "10:00"))).level).toBeCloseTo(saltBefore - 0.5, 4);
    // it was calcium, 200 ml, in another pool
    await saveDosing(
      f.aq1,
      { requestId: rid(), dosingId: r.dosingId, expectedVersion: 1, performedAtLocal: `${d}T09:00`, poolId: f.pool("KARANTEN"), chemicalId: chem["Teszt kalcium"], quantity: "200", unitId: unit.ml },
      at(d, "09:10"),
    );
    expect((await level("Teszt só", at(d, "10:00"))).level, "the salt is back").toBeCloseTo(saltBefore, 4);
    expect((await level("Teszt kalcium", at(d, "10:00"))).level).toBeCloseTo(calciumBefore - 0.2, 4);
    const row = (await dosingLog({ from: d, to: d, poolId: null, chemicalId: chem["Teszt kalcium"] })).find((x) => x.id === r.dosingId)!;
    expect([row.chemical, row.quantity, row.unit, row.pool, row.version, row.status]).toEqual(["Teszt kalcium", "200", "ml", "Karantén", 2, "VALID"]);
    expect((await dosingLog({ from: d, to: d, poolId: null, chemicalId: chem["Teszt só"] })).some((x) => x.id === r.dosingId), "no longer under the salt").toBe(false);
    const audit = await prisma.auditEntry.findFirstOrThrow({ where: { entityType: "Dosing", entityId: r.dosingId, action: "UPDATE" } });
    expect(audit.changes).toMatchObject({
      chemical: { before: chem["Teszt só"], after: chem["Teszt kalcium"] },
      pool: { before: f.pool("SOZO"), after: f.pool("KARANTEN") },
      quantity: { before: "500", after: "200" },
    });
    // the same version again is refused (another sheet changed it meanwhile)
    await expectCode(
      saveDosing(f.aq1, { requestId: rid(), dosingId: r.dosingId, expectedVersion: 1, performedAtLocal: `${d}T09:00`, poolId: f.pool("SOZO"), chemicalId: chem["Teszt só"], quantity: "1", unitId: unit.g }, at(d, "09:20")),
      "VERSION_CONFLICT",
    );
  });
});
