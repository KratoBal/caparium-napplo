// Lili 2026-11-01 (point 9, msg 1566532615530352863): a new measurement type, set up like a new animal: its name, unit, decimals,
// plausible range, reference, ZIMS name and unit, the daily or weekly group it goes into, IN WHICH POOLS, and from which day. The
// group's table gets a new column, filled in the chosen pools only; the other pools show a dash there and the server refuses a value.
import { z } from "zod";
import { writeAudit } from "./audit";
import { prisma, type Tx } from "./db";
import { compareDecimal, parseDecimalInput } from "./decimal";
import { AppError, isUniqueViolation } from "./errors";
import { FIRST_NAME_FROM, moduleLevel, validAt } from "./master";
import type { Role } from "./permissions";
import { resolveLocalDateTime } from "./time";

const exportSafe = (s: z.ZodString) => s.refine((v) => !/^[=+\-@\t\r]/.test(v), "A név nem kezdődhet =, +, -, @ jellel (táblázatkezelőben képletként futna).");
const decimalText = z.string().trim().max(32).nullable().optional();

export const newMeasurementSchema = z.object({
  requestId: z.string().min(8).max(100),
  name: exportSafe(z.string().trim().min(2, "A név legalább 2 karakter legyen.").max(40)),
  unitId: z.uuid({ error: "Válassz mértékegységet." }),
  decimals: z.number().int().min(0).max(4),
  plausibleMin: decimalText,
  plausibleMax: decimalText,
  referenceMin: decimalText,
  referenceMax: decimalText,
  zimsName: exportSafe(z.string().trim().min(1, "Add meg a ZIMS-nevet.").max(100)),
  zimsUnit: exportSafe(z.string().trim().min(1, "Add meg a ZIMS-mértékegységet.").max(40)),
  // Lili 2026-11-01 22:21 UTC (msg 1566577932816748707): one measurement in several tables (the daily Korallos AND the daily
  // Nagymedence table are two tables), each with its own pools
  tables: z
    .array(z.object({ groupId: z.uuid(), poolIds: z.array(z.uuid()).min(1, "Jelölj ki legalább egy medencét minden kiválasztott táblában.").max(50) }))
    .min(1, "Válassz legalább egy napi vagy heti táblát.")
    .max(10),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A dátum alakja ÉÉÉÉ-HH-NN."),
});

type Actor = { id: string; role: Role };

/** A code for the new parameter: the name's letters, capital, ascii, with a number when it is taken. */
async function freeCode(tx: Tx, name: string): Promise<string> {
  const base = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 20) || "MERES";
  for (let i = 1; ; i++) {
    const code = i === 1 ? base : `${base}_${i}`;
    if (!(await tx.parameter.findUnique({ where: { code } }))) return code;
  }
}

function decimal(v: string | null | undefined, what: string): string | null {
  if (v === undefined || v === null || v.trim() === "") return null;
  const d = parseDecimalInput(v);
  if (d === null) throw new AppError(422, "INVALID_VALUE", `${what}: nem szám.`);
  return d;
}

export async function createMeasurementType(actor: Actor, input: z.infer<typeof newMeasurementSchema>) {
  if ((await moduleLevel(prisma, actor.id, actor.role, "SETTINGS")) !== "ADMIN") throw new AppError(403, "ADMIN_ONLY", "Új mérésfajtát csak adminisztrátor vehet fel.");
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  const at = resolveLocalDateTime(`${input.from}T00:00`)?.instant;
  if (!at) throw new AppError(422, "INVALID_DAY", "A dátum érvénytelen.");
  const pMin = decimal(input.plausibleMin, "A hihető tartomány alja");
  const pMax = decimal(input.plausibleMax, "A hihető tartomány teteje");
  const rMin = decimal(input.referenceMin, "A referencia alja");
  const rMax = decimal(input.referenceMax, "A referencia teteje");
  if (pMin !== null && pMax !== null && compareDecimal(pMin, pMax) > 0) throw new AppError(422, "BAD_RANGE", "A hihető tartomány alja nagyobb a tetejénél.");
  if (rMin !== null && rMax !== null && compareDecimal(rMin, rMax) > 0) throw new AppError(422, "BAD_RANGE", "A referencia alja nagyobb a tetejénél.");
  const tables = input.tables.map((t) => ({ groupId: t.groupId, poolIds: [...new Set(t.poolIds)] }));
  if (new Set(tables.map((t) => t.groupId)).size !== tables.length) throw new AppError(422, "TABLE_TWICE", "Egy tábla csak egyszer választható.");
  // the code inside the transaction, and two at once with the same name end in a 409, not a 500 (barracuda on #173)
  try {
    return await prisma.$transaction(async (tx) => {
      const code = await freeCode(tx, input.name);
      const unit = await tx.unit.findUnique({ where: { id: input.unitId } });
      if (!unit || !unit.active) throw new AppError(422, "UNIT_NOT_FOUND", "A mértékegység nem található.");
      const groups: { id: string; name: string; poolIds: string[] }[] = [];
      for (const t of tables) {
        const group = await tx.measurementGroup.findUnique({ where: { id: t.groupId } });
        if (!group || !group.active) throw new AppError(404, "GROUP_NOT_FOUND", "A mérési csoport nem található.");
        // the chosen pools are the table's on the first day
        const members = await tx.groupMembership.findMany({ where: { groupId: group.id, poolId: { in: t.poolIds }, ...validAt(at) }, select: { poolId: true } });
        if (members.length !== t.poolIds.length) throw new AppError(422, "POOL_NOT_IN_GROUP", `Egy kijelölt medence ezen a napon nem tartozik a(z) ${group.name} táblához.`);
        groups.push({ id: group.id, name: group.name, poolIds: t.poolIds });
      }
      // the name is one of a kind among the parameters' current names
      const clash = await tx.parameterName.findFirst({ where: { displayName: { equals: input.name, mode: "insensitive" }, validTo: null } });
      if (clash) throw new AppError(409, "NAME_TAKEN", "Ilyen nevű mérés már van.");
      const lastParam = await tx.parameter.aggregate({ _max: { sortOrder: true } });
      const parameter = await tx.parameter.create({
        data: {
          code,
          unitId: unit.id,
          decimals: input.decimals,
          plausibleMin: pMin,
          plausibleMax: pMax,
          sortOrder: (lastParam._max.sortOrder ?? 0) + 1,
          // the names from the beginning, as a pool's or a worker's first name: a measurement dated back still finds them
          names: { create: { displayName: input.name, validFrom: FIRST_NAME_FROM } },
          zimsNames: { create: { zimsName: input.zimsName, validFrom: FIRST_NAME_FROM } },
          zimsUnitNames: { create: { unitId: unit.id, zimsUnit: input.zimsUnit, validFrom: FIRST_NAME_FROM } },
        },
      });
      if (rMin !== null || rMax !== null) {
        await tx.referenceRange.create({ data: { parameterId: parameter.id, poolId: null, min: rMin, max: rMax, unitId: unit.id, validFrom: at, createdById: actor.id } });
      }
      for (const g of groups) {
        const lastInGroup = await tx.groupParameter.aggregate({ where: { groupId: g.id }, _max: { sortOrder: true } });
        await tx.groupParameter.create({ data: { groupId: g.id, parameterId: parameter.id, sortOrder: (lastInGroup._max.sortOrder ?? 0) + 1, validFrom: at, poolIds: g.poolIds } });
      }
      await writeAudit(tx, {
        userId: actor.id,
        action: "MASTER_CHANGE",
        entityType: "Parameter",
        entityId: parameter.id,
        changes: {
          created: {
            before: null,
            after: { code, name: input.name, unit: unit.symbol, decimals: input.decimals, plausible: [pMin, pMax], reference: [rMin, rMax], zimsName: input.zimsName, zimsUnit: input.zimsUnit, tables: groups.map((g) => ({ table: g.name, pools: g.poolIds.length })), from: input.from },
          },
        },
        requestId: input.requestId,
      });
      return { replayed: false, id: parameter.id, code };
    });
  } catch (e) {
    if (isUniqueViolation(e, "code")) throw new AppError(409, "NAME_TAKEN", "Ilyen nevű mérés már van (épp most vették fel).");
    throw e;
  }
}
