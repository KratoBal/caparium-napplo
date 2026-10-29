// Lili 2026-10-28 23:51 UTC (Caparium channel, msg 1565150977861095475): on the feeding page of 2026-10-21 a list was
// switched off, which took the day's entries off, and another list was put on by mistake; the state before is wanted.
// Nothing was deleted: a list switch INVALIDATES the selections, the animals' own items and manual eating states, and
// rewrites the day's feeds, every change audited with its request (feeding-lists.ts, feeding.ts). So a day can be put
// back as it stood just before one operation, from the audit alone.
//
// What "before the operation" means here: every audited change on the day's rows (selections, items, eating states,
// the day's feeds) from that operation's first audit row on is turned back. A row created since is invalidated, a row
// invalidated since is valid again, the day's feeds are the list they held before. A CONTENT change since (an edited
// amount, a state, a note) cannot be turned back from the audit and is named, not guessed: the run then refuses.
// A dry run first (what would change, by count and by animal), the run on its own confirmation, in one transaction,
// each change audited under the run's request. Feeding admins only. Nothing is deleted here either.

import { z } from "zod";
import { writeAudit } from "./audit";
import { prisma, type Tx } from "./db";
import { AppError } from "./errors";
import { lockFeedingDay } from "./feeding";
import { moduleLevel } from "./master";
import type { Actor } from "./measurements";
import { dayToDate } from "./time";

export const restoreSchema = z.object({
  requestId: z.string().min(8).max(100),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(["ops", "plan", "run"]),
  /** the operation the day goes back to just before: an audit request id without its ":off", ":feeds" tail */
  op: z.string().min(1).max(100).optional(),
  reason: z.string().trim().min(3, "Az indoklás legalább 3 karakter legyen.").max(500).optional(),
});

const ROW_TYPES = ["FeedingSelection", "FeedingItem", "EatingStatus"] as const;
type RowType = (typeof ROW_TYPES)[number];
type Audit = { id: bigint; at: Date; action: string; entityType: string; entityId: string; changes: unknown; requestId: string | null; userId: string };

/** The operation an audit row belongs to: a list switch writes R, R:off and R:feeds; an automatic fasting day R:off. */
export const opOf = (requestId: string | null) => (requestId ?? "").split(":")[0] || "?";

async function requireFeedingAdmin(actor: Actor) {
  if ((await moduleLevel(prisma, actor.id, actor.role, "FEEDING")) !== "ADMIN") {
    throw new AppError(403, "ADMIN_ONLY", "Nap visszaállítását adminisztrátor végzi.");
  }
}

async function dayRows(tx: Tx, day: string) {
  const fd = await tx.feedingDay.findUnique({ where: { businessDay: dayToDate(day) } });
  if (!fd) throw new AppError(404, "DAY_NOT_FOUND", "Ezen a napon nincs takarmánylap.");
  const [selections, items, statuses] = await Promise.all([
    tx.feedingSelection.findMany({ where: { feedingDayId: fd.id }, select: { id: true, animalId: true, status: true } }),
    tx.feedingItem.findMany({ where: { feedingDayId: fd.id }, select: { id: true, animalId: true, groupId: true, status: true } }),
    tx.eatingStatus.findMany({ where: { feedingDayId: fd.id }, select: { id: true, animalId: true, status: true, source: true } }),
  ]);
  const rows = new Map<string, { type: RowType; status: string; animalId: string | null }>();
  for (const r of selections) rows.set(r.id, { type: "FeedingSelection", status: r.status, animalId: r.animalId });
  for (const r of items) rows.set(r.id, { type: "FeedingItem", status: r.status, animalId: r.animalId });
  for (const r of statuses) rows.set(r.id, { type: "EatingStatus", status: r.status, animalId: r.animalId });
  const audits = (await tx.auditEntry.findMany({
    where: { OR: [{ entityType: "FeedingDay", entityId: fd.id }, { entityType: { in: [...ROW_TYPES] }, entityId: { in: [...rows.keys()] } }] },
    orderBy: [{ at: "asc" }, { id: "asc" }],
  })) as Audit[];
  return { fd, rows, audits };
}

/** The day's operations, newest last: what an admin chooses "before" from. */
export async function dayOperations(day: string) {
  const { audits } = await dayRows(prisma, day);
  const users = new Map((await prisma.user.findMany({ select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const ops = new Map<string, { op: string; at: Date; user: string; count: number; kinds: Record<string, number> }>();
  for (const a of audits) {
    const key = opOf(a.requestId);
    const o = ops.get(key) ?? { op: key, at: a.at, user: users.get(a.userId) ?? "?", count: 0, kinds: {} };
    o.count++;
    const kind = `${a.entityType} ${a.action}`;
    o.kinds[kind] = (o.kinds[kind] ?? 0) + 1;
    ops.set(key, o);
  }
  return [...ops.values()].sort((x, y) => x.at.getTime() - y.at.getTime()).map((o) => ({ ...o, at: o.at.toISOString() }));
}

type Change = { type: RowType; id: string; animalId: string | null; to: "VALID" | "INVALIDATED" };

/** The status a row had before a status-only change. */
const statusBefore = (x: Audit): "VALID" | "INVALIDATED" | null => {
  const b = (x.changes as { status?: { before?: unknown } })?.status?.before;
  return b === "VALID" || b === "INVALIDATED" ? b : null;
};

/** A status change only (a restore's own revalidation): not a content change, the row's content is as it was. */
const statusOnly = (x: Audit) => {
  const keys = x.changes && typeof x.changes === "object" ? Object.keys(x.changes as object) : [];
  return keys.length === 1 && keys[0] === "status";
};

/** What going back to just before `op` would change; `blocked` names what the audit cannot turn back. */
async function plan(tx: Tx, day: string, op: string) {
  const { fd, rows, audits } = await dayRows(tx, day);
  const first = audits.find((a) => opOf(a.requestId) === op);
  if (!first) throw new AppError(404, "OP_NOT_FOUND", "Ez a művelet nem érintette ezt a napot.");
  const since = audits.filter((a) => a.at.getTime() > first.at.getTime() || (a.at.getTime() === first.at.getTime() && a.id >= first.id));
  const firstOf = new Map<string, Audit>();
  for (const a of since) if (!firstOf.has(a.entityId)) firstOf.set(a.entityId, a);
  const changes: Change[] = [];
  const blocked: { type: string; id: string; action: string; at: string }[] = [];
  let feedIds: { now: string[]; before: string[] } | null = null;
  for (const [id, a] of firstOf) {
    if (a.entityType === "FeedingDay") {
      const before = (a.changes as { feedIds?: { before?: string[] } })?.feedIds?.before;
      if (a.action === "UPDATE" && Array.isArray(before)) {
        if ([...before].sort().join() !== [...fd.feedIds].sort().join()) feedIds = { now: [...fd.feedIds], before };
      } else blocked.push({ type: a.entityType, id, action: a.action, at: a.at.toISOString() });
      continue;
    }
    const row = rows.get(id);
    if (!row) continue;
    // the row as it stood before: a CREATE since means it did not exist; an INVALIDATE since means it was valid; a
    // status-only UPDATE since (a restore's own) names the status it had before, so a restore can be turned back by
    // another one (barracuda on #95)
    const target = a.action === "CREATE" ? "INVALIDATED" : a.action === "INVALIDATE" ? "VALID" : statusOnly(a) ? statusBefore(a) : null;
    if (!target) {
      blocked.push({ type: row.type, id, action: a.action, at: a.at.toISOString() });
      continue;
    }
    // a content change since, on a row that existed before, cannot be turned back either; a row created since goes
    // whatever was edited on it
    const later = a.action === "CREATE" ? undefined : since.find((x) => x.entityId === id && x.action !== "CREATE" && x.action !== "INVALIDATE" && !statusOnly(x));
    if (later) {
      blocked.push({ type: row.type, id, action: later.action, at: later.at.toISOString() });
      continue;
    }
    if (row.status !== target) changes.push({ type: row.type, id, animalId: row.animalId, to: target });
  }
  // every operation turned back, with its time and who did it: the admin sees whose later work goes too, not a count
  // (barracuda on #95)
  const users = new Map((await tx.user.findMany({ select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const ops = new Map<string, { op: string; at: string; user: string }>();
  for (const x of since) if (!ops.has(opOf(x.requestId))) ops.set(opOf(x.requestId), { op: opOf(x.requestId), at: x.at.toISOString(), user: users.get(x.userId) ?? "?" });
  return { fd, since: first.at, changes, blocked, feedIds, ops: [...ops.values()] };
}

/** One row's status set, typed per model (no cast: a field name the model lacks is a compile error). */
async function setStatus(tx: Tx, type: RowType, id: string, data: { status: "VALID" | "INVALIDATED"; invalidationReason: string | null; version: { increment: number }; updatedById: string; updatedAt: Date }) {
  if (type === "FeedingSelection") await tx.feedingSelection.update({ where: { id }, data });
  else if (type === "FeedingItem") await tx.feedingItem.update({ where: { id }, data });
  else await tx.eatingStatus.update({ where: { id }, data });
}

export async function restoreDay(actor: Actor, raw: z.input<typeof restoreSchema>, now = new Date()) {
  const input = restoreSchema.parse(raw);
  await requireFeedingAdmin(actor);
  if (input.mode === "ops") return { ops: await dayOperations(input.day) };
  if (!input.op) throw new AppError(422, "OP_REQUIRED", "Válaszd ki, melyik művelet elé álljon vissza a nap.");
  const summary = (p: Awaited<ReturnType<typeof plan>>) => {
    const count: Record<string, number> = {};
    for (const c of p.changes) count[`${c.type} ${c.to}`] = (count[`${c.type} ${c.to}`] ?? 0) + 1;
    return { since: p.since.toISOString(), ops: p.ops, count, changes: p.changes, blocked: p.blocked, feedIds: p.feedIds };
  };
  if (input.mode === "plan") return { plan: summary(await plan(prisma, input.day, input.op)) };

  if (!input.reason) throw new AppError(422, "REASON_REQUIRED", "A visszaállításhoz indoklás kell.");
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  return prisma.$transaction(async (tx) => {
    const { fd } = await dayRows(tx, input.day);
    await lockFeedingDay(tx, fd.id);
    // planned again inside the lock: what the admin saw may have moved meanwhile, the run follows the day as it is
    const p = await plan(tx, input.day, input.op!);
    if (p.blocked.length) {
      throw new AppError(409, "RESTORE_BLOCKED", `${p.blocked.length} változás az audit alapján nem fordítható vissza (tartalmi módosítás); a napot így nem állítom vissza.`, { blocked: p.blocked });
    }
    if (!p.changes.length && !p.feedIds) throw new AppError(422, "NO_CHANGE", "A nap már úgy áll, ahogy a művelet előtt.");
    const why = `visszaállítás a(z) ${input.op} művelet előtti állapotra: ${input.reason}`;
    // invalidations first: one valid row per animal (the partial unique indexes) holds at every step
    const ordered = [...p.changes.filter((c) => c.to === "INVALIDATED"), ...p.changes.filter((c) => c.to === "VALID")];
    for (const c of ordered) {
      await setStatus(tx, c.type, c.id, {
        status: c.to,
        invalidationReason: c.to === "INVALIDATED" ? why.slice(0, 500) : null,
        version: { increment: 1 },
        updatedById: actor.id,
        updatedAt: now,
      });
      await writeAudit(tx, {
        userId: actor.id,
        action: c.to === "INVALIDATED" ? "INVALIDATE" : "UPDATE",
        entityType: c.type,
        entityId: c.id,
        changes: { status: { before: c.to === "INVALIDATED" ? "VALID" : "INVALIDATED", after: c.to } },
        reason: why.slice(0, 500),
        requestId: input.requestId,
      });
    }
    if (p.feedIds) {
      await tx.feedingDay.update({ where: { id: fd.id }, data: { feedIds: p.feedIds.before } });
      await writeAudit(tx, {
        userId: actor.id,
        action: "UPDATE",
        entityType: "FeedingDay",
        entityId: fd.id,
        changes: { feedIds: { before: [...p.feedIds.now].sort(), after: [...p.feedIds.before].sort() } },
        reason: why.slice(0, 500),
        requestId: input.requestId,
      });
    }
    return { replayed: false, restored: summary(p) };
  });
}
