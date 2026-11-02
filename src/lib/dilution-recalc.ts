// acrobot 39888 (barracuda on #179): since #179 the dilution is a factor (value = reading x dilution, the reading in
// baseValue). A weekly row saved before it carries the dilution as a note: its value is the reading (Lili earlier: "van
// hogy 10x es higitassal, tehat meg kene szorozni 10zel az eredmenyt"), its baseValue empty. Such rows mean something else
// in the same ZIMS column than the new ones. Here an admin counts them (a dry run: by parameter, with the day range) and,
// on its own confirmation, recalculates them: baseValue = the value, value = the value x the dilution. One transaction,
// each row audited under the run's request, its version stepped. Valid rows only; the others are counted, not touched.
// Water admins only. Nothing is deleted.

import { z } from "zod";
import { diffFields, writeAudit } from "./audit";
import { prisma, type Tx } from "./db";
import { canonicalDecimal, multiplyDecimal } from "./decimal";
import { AppError } from "./errors";
import { moduleLevel, pickValid } from "./master";
import type { Actor } from "./measurements";
import { dateToDay } from "./time";

export const dilutionRecalcSchema = z.object({
  requestId: z.string().min(8).max(100),
  mode: z.enum(["plan", "run"]),
  /** the run: the number of rows the dry run showed; a different number now refuses (something changed in between) */
  expected: z.number().int().min(1).max(100000).optional(),
});

async function requireWaterAdmin(actor: Actor) {
  if ((await moduleLevel(prisma, actor.id, actor.role, "WATER")) !== "ADMIN") {
    throw new AppError(403, "ADMIN_ONLY", "A régi hígított sorok átszámolását adminisztrátor végzi.");
  }
}

const OLD_ROW = { dilution: { gt: 1 }, baseValue: null } as const;

async function oldRows(tx: Tx) {
  return tx.measurement.findMany({
    where: { ...OLD_ROW, status: "VALID" },
    orderBy: [{ businessDay: "asc" }, { id: "asc" }],
    include: { parameter: { include: { names: true } } },
  });
}

/** The dry run: what the run would change, by parameter with the day range; and the rows not valid, counted only. */
export async function dilutionRecalcPlan() {
  const rows = await oldRows(prisma);
  const notValid = await prisma.measurement.count({ where: { ...OLD_ROW, status: { not: "VALID" } } });
  const byParam = new Map<string, { parameter: string; count: number; firstDay: string; lastDay: string }>();
  for (const m of rows) {
    const name = pickValid(m.parameter.names, m.measuredAt)?.displayName ?? m.parameter.code;
    const day = dateToDay(m.businessDay);
    const p = byParam.get(m.parameterId) ?? { parameter: name, count: 0, firstDay: day, lastDay: day };
    p.count++;
    if (day < p.firstDay) p.firstDay = day;
    if (day > p.lastDay) p.lastDay = day;
    byParam.set(m.parameterId, p);
  }
  return {
    count: rows.length,
    notValid,
    parameters: [...byParam.values()],
    rows: rows.map((m) => ({
      id: m.id,
      day: dateToDay(m.businessDay),
      parameter: pickValid(m.parameter.names, m.measuredAt)?.displayName ?? m.parameter.code,
      value: canonicalDecimal(m.value),
      dilution: m.dilution!,
      result: canonicalDecimal(multiplyDecimal(canonicalDecimal(m.value), String(m.dilution))),
    })),
  };
}

export async function dilutionRecalc(actor: Actor, input: z.infer<typeof dilutionRecalcSchema>) {
  await requireWaterAdmin(actor);
  if (input.mode === "plan") return { plan: await dilutionRecalcPlan() };
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  if (input.expected === undefined) throw new AppError(422, "EXPECTED_REQUIRED", "Előbb a próba: annak darabszámát kell megerősíteni.");
  return prisma.$transaction(async (tx) => {
    // the rows held while they are read and written: a correction in between waits, then the count tells
    await tx.$queryRaw`SELECT id FROM "measurement" WHERE "dilution" > 1 AND "baseValue" IS NULL AND "status" = 'VALID' FOR UPDATE`;
    const rows = await oldRows(tx);
    if (rows.length !== input.expected) {
      throw new AppError(409, "COUNT_CHANGED", `A próba óta változott a sorok száma (${input.expected} helyett ${rows.length}). Futtasd újra a próbát.`);
    }
    const now = new Date();
    for (const m of rows) {
      const base = canonicalDecimal(m.value);
      const value = canonicalDecimal(multiplyDecimal(base, String(m.dilution)));
      await tx.measurement.update({
        where: { id: m.id },
        data: { value, baseValue: base, version: { increment: 1 }, updatedById: actor.id, updatedAt: now },
      });
      await writeAudit(tx, {
        userId: actor.id,
        action: "UPDATE",
        entityType: "Measurement",
        entityId: m.id,
        changes: diffFields({ value: base, baseValue: null }, { value, baseValue: base }),
        reason: `régi hígított sor átszámolva: ${base} × ${m.dilution}`,
        requestId: input.requestId,
      });
    }
    return { replayed: false, recalculated: rows.length };
  });
}
