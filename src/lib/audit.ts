import type { AuditAction, Prisma } from "@prisma/client";
import type { Tx } from "./db";

export type FieldChanges = Record<string, { before: unknown; after: unknown }>;

export type AuditInput = {
  userId: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  changes?: FieldChanges;
  reason?: string | null;
  requestId?: string | null;
  client?: string | null;
  clientTimestamp?: Date | null;
};

/**
 * Writes one audit entry. Must be called with the transaction client of the business
 * change it describes (K6: both or neither). The table itself rejects UPDATE/DELETE.
 */
export async function writeAudit(tx: Tx, input: AuditInput): Promise<void> {
  await tx.auditEntry.create({
    data: {
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      changes: (input.changes ?? {}) as Prisma.InputJsonValue,
      reason: input.reason ?? null,
      requestId: input.requestId ?? null,
      client: input.client ?? null,
      clientTimestamp: input.clientTimestamp ?? null,
    },
  });
}

/** Field-by-field diff of two plain snapshots; unchanged fields are left out. */
export function diffFields(before: Record<string, unknown> | null, after: Record<string, unknown> | null): FieldChanges {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: FieldChanges = {};
  for (const k of keys) {
    const b = before?.[k] ?? null;
    const a = after?.[k] ?? null;
    if (JSON.stringify(b) !== JSON.stringify(a)) out[k] = { before: b, after: a };
  }
  return out;
}
