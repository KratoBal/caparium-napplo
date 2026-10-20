// Pending saves (K9): a save that arrived beyond the grace period waits for an admin.
// Approve makes it valid (the cell rule still holds); reject invalidates it with a reason.
import { z } from "zod";
import { diffFields, writeAudit } from "./audit";
import { prisma } from "./db";
import { AppError, isUniqueViolation } from "./errors";
import { moduleLevel } from "./master";
import { requireReason } from "./reasons";
import type { Actor } from "./measurements";

export const pendingDecisionSchema = z.object({
  requestId: z.string().min(8).max(100),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().min(3, "Az indoklás legalább 3 karakter legyen.").max(500).optional(),
});
export type PendingDecision = z.infer<typeof pendingDecisionSchema>;

export async function decidePending(actor: Actor, id: string, input: PendingDecision, now = new Date()) {
  const level = await moduleLevel(prisma, actor.id, actor.role, "WATER");
  if (level !== "ADMIN") throw new AppError(403, "ADMIN_ONLY", "Függő mentésről csak adminisztrátor dönt.");
  await requireReason(prisma, input.decision === "reject", input.reason, "Az elutasításhoz indoklás kell.");
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId, entityId: id } })) return { replayed: true };
  try {
    return await prisma.$transaction(async (tx) => {
      const cur = await tx.measurement.findUnique({ where: { id } });
      if (!cur || cur.status !== "PENDING") throw new AppError(409, "NOT_PENDING", "Ez a mentés már nem függő.");
      const approve = input.decision === "approve";
      const res = await tx.measurement.updateMany({
        where: { id, status: "PENDING", version: cur.version },
        data: {
          status: approve ? "VALID" : "INVALIDATED",
          invalidationReason: approve ? null : input.reason,
          version: { increment: 1 },
          updatedById: actor.id,
          updatedAt: now,
        },
      });
      if (res.count !== 1) throw new AppError(409, "NOT_PENDING", "Ez a mentés már nem függő.");
      await writeAudit(tx, {
        userId: actor.id,
        action: approve ? "PENDING_APPROVED" : "PENDING_REJECTED",
        entityType: "Measurement",
        entityId: id,
        changes: diffFields(
          { status: "PENDING", invalidationReason: null },
          { status: approve ? "VALID" : "INVALIDATED", invalidationReason: approve ? null : input.reason },
        ),
        reason: input.reason ?? null,
        requestId: input.requestId,
      });
      return { replayed: false };
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new AppError(
        409,
        "CELL_TAKEN",
        "Ebben a cellában már van érvényes érték. Előbb azt kell érvényteleníteni, vagy a függő mentést elutasítani.",
      );
    }
    throw e;
  }
}

export async function listPending() {
  return prisma.measurement.findMany({
    where: { status: "PENDING" },
    include: { pool: { include: { names: true } }, parameter: { include: { names: true } }, round: { include: { group: true } } },
    orderBy: { createdAt: "asc" },
  });
}
