// The daily water measurement's pool ticks (Lili 2026-10-29, task caparium-lili-nagyobb-m, item 8): "Visszamosás" and
// "Rátöltés" under the big pools' names, "Vízcsere" under the small tanks'. Which group has which is a fact of the group
// (its code), so the page, the server and the reports agree without a new setting. A tick is a fact of the pool and the
// business day, not of a measurement, and it never reaches the ZIMS export.
import type { PoolTickKind } from "@prisma/client";
import { z } from "zod";
import { writeAudit } from "./audit";
import { prisma } from "./db";
import { AppError } from "./errors";
import { closedAt, type Actor } from "./measurements";
import { canCreate } from "./permissions";
import { ensureJournalDay, moduleLevel } from "./master";
import { businessDayOf, dayToDate, isValidDay } from "./time";

export const TICK_LABEL: Record<PoolTickKind, string> = { BACKWASH: "Visszamosás", TOPUP: "Rátöltés", WATER_CHANGE: "Vízcsere" };
/** The order the ticks stand in: on the page, in the Excel columns and in the PDF. */
export const TICK_ORDER: PoolTickKind[] = ["BACKWASH", "TOPUP", "WATER_CHANGE"];

const KINDS_OF_GROUP: Record<string, PoolTickKind[]> = {
  NAPI_NAGY: ["BACKWASH", "TOPUP"],
  NAPI_KIS: ["WATER_CHANGE"],
};

/** The ticks a daily group offers; none for any other group. */
export function tickKindsOf(groupCode: string): PoolTickKind[] {
  return KINDS_OF_GROUP[groupCode] ?? [];
}

export const poolTickSchema = z.object({
  requestId: z.string().min(8).max(100),
  groupId: z.uuid(),
  poolId: z.uuid(),
  day: z.string().refine(isValidDay, "Hibás nap."),
  kind: z.enum(["BACKWASH", "TOPUP", "WATER_CHANGE"]),
  done: z.boolean(),
});

/**
 * Sets or clears one tick. The day rules are the measurement's own (today and open for an aquarist; an admin may
 * change another or a closed day): the tick is part of the day's record. A repeat of the same request, or setting what
 * is already so, changes nothing.
 */
export async function setPoolTick(actor: Actor, raw: z.input<typeof poolTickSchema>, serverNow = new Date()) {
  const input = poolTickSchema.parse(raw);
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId, entityType: "PoolTick" } })) return { replayed: true, done: input.done };
  return prisma.$transaction(async (tx) => {
    const group = await tx.measurementGroup.findUnique({ where: { id: input.groupId } });
    if (!group || !group.active) throw new AppError(404, "GROUP_NOT_FOUND", "A mérési csoport nem található.");
    if (!tickKindsOf(group.code).includes(input.kind)) throw new AppError(422, "TICK_NOT_FOR_GROUP", "Ez a jelölő nem tartozik ehhez a csoporthoz.");
    const member = await tx.groupMembership.findFirst({ where: { groupId: group.id, poolId: input.poolId } });
    if (!member) throw new AppError(422, "POOL_NOT_IN_GROUP", "A medence nem ennek a csoportnak a tagja.");
    const pool = await tx.pool.findUniqueOrThrow({ where: { id: input.poolId } });
    if (!pool.active) throw new AppError(422, "POOL_INACTIVE", "Inaktív medencéhez nem rögzíthető jelölő.");
    const journal = await ensureJournalDay(tx, "WATER", group.id, input.day);
    const level = await moduleLevel(tx, actor.id, actor.role, "WATER");
    const decision = canCreate(level, { day: input.day, today: businessDayOf(serverNow), closed: closedAt(journal, serverNow) });
    if (decision.kind === "DENY") throw new AppError(403, decision.code, decision.message);
    // a tick of a past or a closed day is an admin's: no reason box here, the audit entry keeps who did it
    const businessDay = dayToDate(input.day);
    const key = { poolId_businessDay_kind: { poolId: input.poolId, businessDay, kind: input.kind } };
    // no read-then-write: two people ticking the same box at once, or a quick on and off, must not turn into a key clash
    // (the second request would show an error for something that is on). createMany skips a row that exists, deleteMany
    // removes none that is not there; `existing` is only for the audit entry.
    const existing = await tx.poolTick.findUnique({ where: key });
    if (input.done) await tx.poolTick.createMany({ data: [{ poolId: input.poolId, businessDay, kind: input.kind, createdById: actor.id }], skipDuplicates: true });
    else await tx.poolTick.deleteMany({ where: { poolId: input.poolId, businessDay, kind: input.kind } });
    await writeAudit(tx, {
      userId: actor.id,
      action: "UPDATE",
      entityType: "PoolTick",
      entityId: `${input.poolId}:${input.day}:${input.kind}`,
      changes: { done: { before: !!existing, after: input.done } },
      requestId: input.requestId,
    });
    return { replayed: false, done: input.done };
  });
}

/** The ticks of one business day: "poolId:kind" -> true. */
export async function ticksOfDay(day: string): Promise<Record<string, true>> {
  const rows = await prisma.poolTick.findMany({ where: { businessDay: dayToDate(day) } });
  return Object.fromEntries(rows.map((r) => [`${r.poolId}:${r.kind}`, true as const]));
}
