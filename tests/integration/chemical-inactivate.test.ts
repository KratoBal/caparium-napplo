// Lili 2026-10-28 16:06 UTC (acrobot 37619, caparium-vegyszer-inaktival): a chemical of the list is changed and
// inactivated the feeds' way. WHAT TURNS RED: an aquarist changes one; an inactive chemical takes a dosing or a stock
// line; inactivating loses its history (the log rows, its stock row) or deletes anything; a reactivated one stays
// refused; a rename onto another chemical's name, or a stock unit changed under recorded lines, goes through; a replay
// writes twice; a change is not audited. Days in August 2025: no other file writes there.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createChemical, dosingLog, recordMovement, saveDosing, stockLevels, updateChemical } from "@/lib/dosing";
import { AppError } from "@/lib/errors";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const unit: Record<string, string> = {};
const at = (d: string, t: string) => new Date(`${d}T${t}:00+02:00`);

beforeAll(async () => {
  f = await fixtures();
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

describe("a chemical inactivated, changed, reactivated", () => {
  it("inactive: no dosing and no stock line, the history stays, nothing deleted; active again: both go through", async () => {
    const d = "2025-08-12";
    const made = (await createChemical(f.admin, { requestId: rid(), name: "Inaktiv proba szer", stockUnitId: unit.kg }, at(d, "07:00"))) as { id: string };
    const id = made.id;
    const dose = (t: string) =>
      saveDosing(f.admin, { requestId: rid(), performedAtLocal: `${d}T${t}`, poolId: f.pool("SOZO"), chemicalId: id, quantity: "200", unitId: unit.g }, at(d, t));
    const intake = (t: string) => recordMovement(f.admin, { requestId: rid(), chemicalId: id, quantity: "1", unitId: unit.kg }, at(d, t));
    await dose("08:00");
    await intake("08:10");
    const rowsBefore = [await prisma.dosing.count({ where: { chemicalId: id } }), await prisma.stockMovement.count({ where: { chemicalId: id } })];

    await expectCode(updateChemical(f.aq1, id, { requestId: rid(), active: false }), "ADMIN_ONLY");
    const req = rid();
    await updateChemical(f.admin, id, { requestId: req, active: false }, at(d, "09:00"));
    expect(await updateChemical(f.admin, id, { requestId: req, active: false }, at(d, "09:00"))).toEqual({ replayed: true });
    await expectCode(updateChemical(f.admin, id, { requestId: rid(), active: false }, at(d, "09:01")), "NO_CHANGE");
    const audit = await prisma.auditEntry.findFirstOrThrow({ where: { requestId: req } });
    expect([audit.entityType, audit.entityId, audit.changes]).toEqual(["Chemical", id, { active: { before: true, after: false } }]);

    await expectCode(dose("10:00"), "CHEMICAL_INACTIVE");
    await expectCode(intake("10:10"), "CHEMICAL_INACTIVE");
    // the history stays: the log row, the stock row (marked inactive), every row of it
    const log = await dosingLog({ from: d, to: d, poolId: null, chemicalId: id });
    expect(log.map((r) => r.chemical)).toEqual(["Inaktiv proba szer"]);
    const stock = (await stockLevels(at(d, "10:20"))).find((c) => c.id === id);
    // uses: the dosing, its own USAGE line and the intake
    expect([stock?.active, stock?.level, stock?.uses]).toEqual([false, 0.8, 3]);
    expect([await prisma.dosing.count({ where: { chemicalId: id } }), await prisma.stockMovement.count({ where: { chemicalId: id } })]).toEqual(rowsBefore);

    await updateChemical(f.admin, id, { requestId: rid(), active: true }, at(d, "11:00"));
    await dose("11:10");
    await intake("11:20");
  });

  it("a rename corrects the name on the earlier days too; another chemical's name is refused; the stock unit only at zero", async () => {
    const d = "2025-08-13";
    const used = ((await createChemical(f.admin, { requestId: rid(), name: "Atnevezendo szer", stockUnitId: unit.kg }, at(d, "07:00"))) as { id: string }).id;
    const fresh = ((await createChemical(f.admin, { requestId: rid(), name: "Ures proba szer", stockUnitId: unit.kg }, at(d, "07:01"))) as { id: string }).id;
    await saveDosing(f.admin, { requestId: rid(), performedAtLocal: `${d}T08:00`, poolId: f.pool("SOZO"), chemicalId: used, quantity: "1", unitId: unit.kg }, at(d, "08:00"));

    await expectCode(updateChemical(f.admin, used, { requestId: rid(), name: "ures PROBA szer", mode: "correction", reason: "elirva" }, at(d, "09:00")), "NAME_TAKEN");
    await updateChemical(f.admin, used, { requestId: rid(), name: "Atnevezett szer", mode: "correction", reason: "elirva" }, at(d, "09:01"));
    const log = await dosingLog({ from: d, to: d, poolId: null, chemicalId: used });
    expect(log.map((r) => r.chemical)).toEqual(["Atnevezett szer"]);

    await expectCode(updateChemical(f.admin, used, { requestId: rid(), stockUnitId: unit.l }, at(d, "09:02")), "CHEMICAL_IN_USE");
    await updateChemical(f.admin, fresh, { requestId: rid(), stockUnitId: unit.l }, at(d, "09:03"));
    expect((await prisma.chemical.findUniqueOrThrow({ where: { id: fresh } })).stockUnitId).toBe(unit.l);
    // a unit that is not a stock dimension (the seed's measurement units, e.g. a temperature) is refused
    const other = await prisma.unit.findFirstOrThrow({ where: { dimension: { notIn: ["MASS", "VOLUME", "COUNT"] } } });
    await expectCode(updateChemical(f.admin, fresh, { requestId: rid(), stockUnitId: other.id }, at(d, "09:04")), "UNIT");
  });
});
