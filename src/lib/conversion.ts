// Lili 2026-11-01 (point 13): the conversions of a parameter (Beállítások), and the server's side of a converted measurement.
import { z } from "zod";
import { diffFields, writeAudit } from "./audit";
import { canonicalDecimal, compareDecimal, parseDecimalInput } from "./decimal";
import { prisma, type Tx } from "./db";
import { AppError } from "./errors";
import { moduleLevel, validAt } from "./master";
import type { Role } from "./permissions";
import { convertReading, type ReadingConversion } from "./reading";
import { resolveLocalDateTime } from "./time";

/** The conversion of a parameter in force at an instant, or null. */
export async function conversionAt(tx: Tx, parameterId: string, at: Date): Promise<ReadingConversion | null> {
  const c = await tx.parameterConversion.findFirst({ where: { parameterId, ...validAt(at) }, orderBy: { validFrom: "desc" } });
  return c ? { id: c.id, label: c.label, factor: canonicalDecimal(c.factor), decimals: c.decimals } : null;
}

/**
 * The value to store from a typed reading: the server converts again (the browser's result is only what the field showed).
 * A reading without a conversion in force at the measurement time is refused, not stored as a value.
 */
export async function valueFromReading(tx: Tx, parameterId: string, at: Date, raw: string) {
  const conv = await conversionAt(tx, parameterId, at);
  if (!conv) throw new AppError(422, "NO_CONVERSION", "Erre a paraméterre a mérés idején nincs átváltás beállítva: az értéket írd be közvetlenül.");
  const reading = parseDecimalInput(raw);
  const value = reading === null ? null : convertReading(reading, conv);
  if (reading === null || value === null) throw new AppError(422, "INVALID_VALUE", "A leolvasott érték nem szám. Tizedesvessző és pont is használható.");
  return { value, rawReading: reading, conversionId: conv.id };
}

type Actor = { id: string; role: Role };

async function requireSettingsAdmin(actor: Actor) {
  if ((await moduleLevel(prisma, actor.id, actor.role, "SETTINGS")) !== "ADMIN") {
    throw new AppError(403, "ADMIN_ONLY", "A beállításokat csak adminisztrátor módosíthatja.");
  }
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A dátum alakja ÉÉÉÉ-HH-NN.");

export const conversionSchema = z.object({
  requestId: z.string().min(8).max(100),
  parameterId: z.uuid(),
  /** null: ends the conversion in force from `from` on (typed values are the values again) */
  label: z.string().trim().min(2).max(60).nullable(),
  factor: z.string().max(32).nullable(),
  decimals: z.number().int().min(0).max(4).nullable(),
  from: day,
});
export type ConversionInput = z.infer<typeof conversionSchema>;

/**
 * Sets the conversion of a parameter from a day on (00:00 Budapest), or ends it. The one in force until then is closed
 * at that instant; one that starts later is refused (the history is set in order). Measurements already saved keep the
 * conversion they were made with. Setting it again for the same start day corrects that row, as long as no measurement
 * was converted with it yet.
 */
export async function setConversion(actor: Actor, input: ConversionInput) {
  await requireSettingsAdmin(actor);
  if ((await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) !== null) return { replayed: true };
  const ending = input.label === null;
  let factor: string | null = null;
  if (!ending) {
    factor = input.factor === null ? null : parseDecimalInput(input.factor, 10);
    if (factor === null || compareDecimal(factor, "0") <= 0) throw new AppError(422, "INVALID_FACTOR", "A szorzó pozitív szám legyen.");
    if (input.decimals === null) throw new AppError(422, "INVALID_DECIMALS", "Add meg a tizedesjegyek számát.");
  }
  const at = resolveLocalDateTime(`${input.from}T00:00`)?.instant;
  if (!at) throw new AppError(422, "INVALID_DAY", "A dátum érvénytelen.");
  return prisma.$transaction(async (tx) => {
    // the parameter's row first: two admins setting it at once go one after the other, so no two open rows (barracuda on #167)
    await tx.$queryRaw`SELECT "id" FROM "parameter" WHERE "id" = ${input.parameterId}::uuid FOR UPDATE`;
    const param = await tx.parameter.findUnique({ where: { id: input.parameterId } });
    if (!param) throw new AppError(404, "NOT_FOUND", "A paraméter nem található.");
    const later = await tx.parameterConversion.findFirst({ where: { parameterId: param.id, validFrom: { gt: at } } });
    if (later) throw new AppError(422, "LATER_EXISTS", "Erre a paraméterre egy későbbi napra már van átváltás: elé nem állítható be.");
    const open = await tx.parameterConversion.findFirst({
      where: { parameterId: param.id, validFrom: { lte: at }, OR: [{ validTo: null }, { validTo: { gt: at } }] },
    });
    if (ending && !open) throw new AppError(422, "NO_CONVERSION", "Ezen a napon nincs érvényes átváltás, nincs mit lezárni.");
    const before = open ? { label: open.label, factor: canonicalDecimal(open.factor), decimals: open.decimals } : null;
    let entityId: string;
    if (open && open.validFrom.getTime() === at.getTime()) {
      // the same start day: a correction of that row, or its end before it ever applied
      if (await tx.measurement.count({ where: { conversionId: open.id } })) {
        throw new AppError(422, "CONVERSION_USED", "Ezzel az átváltással már készült mérés: a módosítást egy későbbi naptól add meg.");
      }
      if (ending) await tx.parameterConversion.update({ where: { id: open.id }, data: { validTo: at } });
      else await tx.parameterConversion.update({ where: { id: open.id }, data: { label: input.label!, factor: factor!, decimals: input.decimals! } });
      entityId = open.id;
    } else {
      if (open) await tx.parameterConversion.update({ where: { id: open.id }, data: { validTo: at } });
      if (ending) entityId = open!.id;
      else {
        const created = await tx.parameterConversion.create({
          data: { parameterId: param.id, label: input.label!, factor: factor!, decimals: input.decimals!, validFrom: at, createdById: actor.id },
        });
        entityId = created.id;
      }
    }
    await writeAudit(tx, {
      userId: actor.id,
      action: "MASTER_CHANGE",
      entityType: "ParameterConversion",
      entityId,
      changes: diffFields(before, ending ? { ended: input.from } : { parameter: param.code, from: input.from, label: input.label, factor, decimals: input.decimals }),
      requestId: input.requestId,
    });
    return { replayed: false };
  });
}
