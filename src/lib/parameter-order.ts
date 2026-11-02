// Lili 2026-11-02 09:36-09:40 UTC (acrobot 39956, point 4): ONE order of the water measurements everywhere: the daily and
// the weekly table's columns, the water report's PDF, the Excel's rows of the same moment. It is the parameters' own order
// (parameter.sortOrder); the tables used to keep one each (group_parameter.sortOrder), equal to it until now. The ZIMS file
// keeps its order (by time), so a file stays comparable with the ones already submitted.
import { z } from "zod";
import { orderAssignments } from "./animal-order";
import { diffFields, writeAudit } from "./audit";
import { prisma } from "./db";
import { AppError } from "./errors";
import { moduleLevel, pickValid } from "./master";
import type { Actor } from "./measurements";

export const parameterOrderSchema = z.object({
  requestId: z.string().min(8).max(100),
  /** the measurements in the order the admin gave; the ones not listed follow them in their old order */
  ids: z.array(z.uuid()).min(1).max(500),
});

export async function setParameterOrder(actor: Actor, raw: z.input<typeof parameterOrderSchema>) {
  const input = parameterOrderSchema.parse(raw);
  if (new Set(input.ids).size !== input.ids.length) throw new AppError(422, "ORDER_DUPLICATE", "Egy mérés csak egyszer szerepelhet a sorrendben.");
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  if ((await moduleLevel(prisma, actor.id, actor.role, "SETTINGS")) !== "ADMIN") {
    throw new AppError(403, "ADMIN_ONLY", "A mérések sorrendjét csak adminisztrátor állíthatja.");
  }
  return prisma.$transaction(async (tx) => {
    const params = await tx.parameter.findMany({ select: { id: true, code: true, sortOrder: true, names: true } });
    const known = new Set(params.map((p) => p.id));
    if (input.ids.some((id) => !known.has(id))) throw new AppError(404, "PARAMETER_NOT_FOUND", "Az egyik mérés nem található.");
    const nameOf = (p: (typeof params)[number]) => pickValid(p.names, new Date())?.displayName ?? p.code;
    const current = [...params].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
    const next = orderAssignments(
      input.ids,
      current.map((p) => p.id),
    ).map((n) => ({ ...n, sortOrder: n.sortOrder + 1 }));
    const before = new Map(params.map((p) => [p.id, p.sortOrder]));
    const changed = next.filter((n) => before.get(n.id) !== n.sortOrder);
    if (changed.length === 0) throw new AppError(422, "NO_CHANGE", "Nincs változás.");
    for (const n of changed) await tx.parameter.update({ where: { id: n.id }, data: { sortOrder: n.sortOrder } });
    const nameById = new Map(params.map((p) => [p.id, nameOf(p)]));
    await writeAudit(tx, {
      userId: actor.id,
      action: "MASTER_CHANGE",
      entityType: "ParameterOrder",
      entityId: "water",
      changes: diffFields({ order: current.map((p) => nameById.get(p.id)) }, { order: next.map((n) => nameById.get(n.id)) }),
      requestId: input.requestId,
    });
    return { replayed: false, changed: changed.length };
  });
}
