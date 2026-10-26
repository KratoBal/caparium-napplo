// The daily feeding list and the feeding items (adatmodell 8. és 9. terület; EGY-01..EGY-12, TAK-07,
// T-01, T-08, T-16, T-21, R-3, R-7, R-8).
// NY-06 default (temporary, documented): ONE common list for the whole Cápárium per day; any
// aquarist may change it on an open day (R-7). The lock of the day is the FEEDING journal day.
// Quantities are per dimension (pieces and grams never add up, DN-16); a group item keeps the
// group's quantity and a snapshot of who was selected (R-8: no equal split is invented).

import { sortDayAnimals } from "./day-animals";
import type { Dimension, FeedingItem, Prisma } from "@prisma/client";
import { z } from "zod";
import { diffFields, writeAudit } from "./audit";
import { prisma, type Tx } from "./db";
import { canonicalDecimal, compareDecimal, parseDecimalInput } from "./decimal";
import { AppError, isUniqueViolation } from "./errors";
import { ensureJournalDay, moduleLevel, pickValid } from "./master";
import { requireReason } from "./reasons";
import type { Actor } from "./measurements";
import { closedAt } from "./measurements";
import { canCreate, canModify, effectiveNow, type Decision, type Level } from "./permissions";
import { addDays, businessDayOf, dateToDay, dayToDate, resolveLocalDateTime } from "./time";

const requestId = z.string().min(8).max(100);
const reason = z.string().trim().min(3, "Az indoklás legalább 3 karakter legyen.").max(500);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The day's feeding row and its lock, created on first use (the scheduled run also pre-creates it, R-15). */
export async function ensureFeedingDay(tx: Tx, d: string) {
  const journal = await ensureJournalDay(tx, "FEEDING", null, d);
  await tx.$executeRaw`
    INSERT INTO "feeding_day" ("id", "businessDay", "journalDayId", "listState")
    VALUES (gen_random_uuid(), ${dayToDate(d)}::date, ${journal.id}::uuid, 'NOT_FINALIZED')
    ON CONFLICT DO NOTHING`;
  const fd = await tx.feedingDay.findUniqueOrThrow({ where: { businessDay: dayToDate(d) } });
  return { fd, journal };
}

/** Start and end instants of a business day (DST-safe: the next local midnight). */
export function dayBounds(d: string): { start: Date; end: Date } {
  return {
    start: resolveLocalDateTime(`${d}T00:00`)!.instant,
    end: resolveLocalDateTime(`${addDays(d, 1)}T00:00`)!.instant,
  };
}

/** Animals alive at some point of the day: arrived before its end, not ended before its start. */
export async function aliveOnDay(tx: Tx, d: string, animalIds?: string[]) {
  const { start, end } = dayBounds(d);
  const events = await tx.lifecycleEvent.findMany({
    where: { status: "VALID", ...(animalIds ? { animalId: { in: animalIds } } : {}) },
    select: { animalId: true, type: true, occurredAt: true },
  });
  const by = new Map<string, { arrived?: Date; ended?: Date }>();
  for (const e of events) {
    const r = by.get(e.animalId) ?? {};
    if (e.type === "ARRIVAL") r.arrived = e.occurredAt;
    if (e.type === "DEATH" || e.type === "RELEASE") r.ended = e.occurredAt;
    by.set(e.animalId, r);
  }
  return new Set([...by].filter(([, r]) => r.arrived && r.arrived < end && (!r.ended || r.ended >= start)).map(([id]) => id));
}

type Facts = { level: Level; d: string; today: string; closed: boolean };

/**
 * Every writer of a feeding day waits on the day's row (review of #10): selection, items, eating
 * statuses and the fasting recompute read each other's rows and then write, and under READ COMMITTED
 * two of them would not see each other (a removal and an "ate" at the same moment would leave a
 * status on an animal that is not on the list). One common list per day (R-7), so the wait is short.
 * Lock order: a lifecycle change locks the animal first, then (through the recompute) the days in
 * ascending order; a day writer locks only its day. Between a selection and a death recorded at the same moment for the
 * same day, refuseOrphanRows (animals.ts) is the net, for the rows its own transaction sees.
 */
export async function lockFeedingDay(tx: Tx, feedingDayId: string) {
  await tx.$queryRaw`SELECT "id" FROM "feeding_day" WHERE "id" = ${feedingDayId}::uuid FOR UPDATE`;
  return tx.feedingDay.findUniqueOrThrow({ where: { id: feedingDayId } });
}

export async function facts(tx: Tx, actor: Actor, d: string, serverNow: Date, clientTs: Date | null) {
  const level = await moduleLevel(tx, actor.id, actor.role, "FEEDING");
  const ensured = await ensureFeedingDay(tx, d);
  const fd = await lockFeedingDay(tx, ensured.fd.id);
  // the day's lock state read again under the lock (a close may have happened meanwhile)
  const journal = await tx.journalDay.findUniqueOrThrow({ where: { id: ensured.journal.id } });
  const eff = effectiveNow(serverNow, clientTs, 30, 48);
  const f: Facts = { level, d, today: businessDayOf(eff.now), closed: closedAt(journal, eff.now) };
  return { f, fd, journal };
}

export async function enforce(tx: Tx, decision: Decision, why: string | undefined) {
  if (decision.kind === "DENY") throw new AppError(403, decision.code, decision.message);
  await requireReason(tx, decision.reasonRequired, why, "Korábbi vagy lezárt nap módosításához indoklás kell.");
}

// ---------------------------------------------------------------------------
// The day's feeds: the list's second step (6fe63c9b, Lili's request; Balázs 2026-10-21 "mehet")
// ---------------------------------------------------------------------------

export const dayFeedsSchema = z.object({
  requestId,
  clientTimestamp: z.iso.datetime({ offset: true }).optional(),
  day,
  feedIds: z.array(z.uuid()).max(100),
  reason: reason.optional(),
});

/**
 * Sets which feeds are given that day. It only narrows what the item form and the feeding sheet offer;
 * an item already recorded with another feed stays. An empty choice means "not chosen": every active
 * feed is offered again, as before the choice existed.
 */
export async function setDayFeeds(actor: Actor, input: z.infer<typeof dayFeedsSchema>, serverNow = new Date()) {
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  const clientTs = input.clientTimestamp ? new Date(input.clientTimestamp) : null;
  const wanted = [...new Set(input.feedIds)];
  return prisma.$transaction(async (tx) => {
    const { f, fd } = await facts(tx, actor, input.day, serverNow, clientTs);
    await enforce(tx, canCreate(f.level, { day: f.d, today: f.today, closed: f.closed }), input.reason);
    const known = await tx.feed.findMany({ where: { id: { in: wanted }, active: true }, select: { id: true } });
    if (known.length !== wanted.length) throw new AppError(422, "FEED_NOT_FOUND", "Ismeretlen vagy inaktív takarmány.");
    const before = [...fd.feedIds].sort();
    const after = [...wanted].sort();
    if (before.join() === after.join()) return { changed: false };
    await tx.feedingDay.update({ where: { id: fd.id }, data: { feedIds: wanted } });
    await writeAudit(tx, {
      userId: actor.id,
      action: "UPDATE",
      entityType: "FeedingDay",
      entityId: fd.id,
      changes: { feedIds: { before, after }, day: { before: input.day, after: input.day } },
      reason: input.reason ?? null,
      requestId: input.requestId,
    });
    return { changed: true };
  });
}

// ---------------------------------------------------------------------------
// The daily list (EGY-01, T-01, R-3, R-7)
// ---------------------------------------------------------------------------

export const selectionSchema = z.object({
  requestId,
  clientTimestamp: z.iso.datetime({ offset: true }).optional(),
  day,
  animalIds: z.array(z.uuid()).min(1).max(200),
  selected: z.boolean(),
  confirmCascade: z.boolean().optional(),
  reason: reason.optional(),
});

/**
 * Selects or removes animals for the day. The list is common (R-7): it does not matter who added a
 * row. Removing an animal that already has a feeding item or a manual eating status that day needs
 * a confirmation, and then invalidates those too in the same transaction (R-3).
 */
export async function setSelection(actor: Actor, input: z.infer<typeof selectionSchema>, serverNow = new Date()) {
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true, changed: 0 };
  const clientTs = input.clientTimestamp ? new Date(input.clientTimestamp) : null;
  return prisma.$transaction(async (tx) => {
    const { f, fd } = await facts(tx, actor, input.day, serverNow, clientTs);
    await enforce(tx, canCreate(f.level, { day: f.d, today: f.today, closed: f.closed }), input.reason);
    const alive = await aliveOnDay(tx, input.day, input.animalIds);
    const dead = input.animalIds.filter((id) => !alive.has(id));
    if (dead.length) throw new AppError(422, "NOT_ALIVE", "Ezen a napon nem élő vagy még nem érkezett állat nem választható ki.");
    const current = await tx.feedingSelection.findMany({
      where: { feedingDayId: fd.id, animalId: { in: input.animalIds }, status: "VALID" },
    });
    let changed = 0;
    if (input.selected) {
      const have = new Set(current.map((c) => c.animalId));
      const adding = input.animalIds.filter((id) => !have.has(id));
      // a manual fasting day contradicts the selection (adatmodell 10., INV): it goes, after a confirmation
      const fasting = await tx.eatingStatus.findMany({
        where: { feedingDayId: fd.id, animalId: { in: adding }, status: "VALID", source: "MANUAL", state: "FASTING" },
      });
      if (fasting.length && !input.confirmCascade) {
        throw new AppError(409, "HAS_RECORDS", "Ennek az állatnak ma koplalónapja van. Megerősítés után a koplalónap érvénytelenítődik.", {
          items: 0,
          statuses: fasting.length,
        });
      }
      for (const st of fasting) {
        const why = "utólagos kiválasztás";
        await tx.eatingStatus.update({ where: { id: st.id }, data: { status: "INVALIDATED", invalidationReason: why, version: { increment: 1 }, updatedById: actor.id, updatedAt: serverNow } });
        await writeAudit(tx, { userId: actor.id, action: "INVALIDATE", entityType: "EatingStatus", entityId: st.id, changes: { status: { before: "VALID", after: "INVALIDATED" } }, reason: why, requestId: input.requestId });
      }
      for (const animalId of adding) {
        const row = await tx.feedingSelection.create({
          data: { feedingDayId: fd.id, animalId, requestId: `${input.requestId}:${animalId}`, createdById: actor.id, updatedById: actor.id },
        });
        await writeAudit(tx, {
          userId: actor.id,
          action: "CREATE",
          entityType: "FeedingSelection",
          entityId: row.id,
          changes: { animalId: { before: null, after: animalId }, day: { before: null, after: input.day } },
          reason: input.reason ?? null,
          requestId: input.requestId,
        });
        changed++;
      }
    } else {
      for (const sel of current) {
        const items = await tx.feedingItem.findMany({ where: { feedingDayId: fd.id, animalId: sel.animalId, status: "VALID" } });
        const manual = await tx.eatingStatus.findMany({ where: { feedingDayId: fd.id, animalId: sel.animalId, status: "VALID", source: "MANUAL" } });
        // R-8: a group item the animal took part in stays, with its snapshot (adatmodell 8.); the removal
        // is still not silent: it is counted here, and a group left without a selected member is returned
        const groupItems = await tx.feedingItem.count({
          where: { feedingDayId: fd.id, status: "VALID", groupId: { not: null }, participants: { some: { animalId: sel.animalId } } },
        });
        if ((items.length || manual.length || groupItems) && !input.confirmCascade) {
          throw new AppError(
            409,
            "HAS_RECORDS",
            groupItems && !items.length && !manual.length
              ? "Ez az állat ma részt vett egy csoportos etetésben. Ha kiveszed, a csoportos etetés megmarad, csak ő kerül le a mai listáról. Kiveszed?"
              : // Lili did not understand the earlier wording (acrobot 34618, 2026-10-21): her words now
                `Ennek az állatnak ma már van beírt etetése. Ha kiveszed, az ő saját beírásai törlődnek${groupItems ? "; a csoportos etetés, amiben részt vett, megmarad" : ""}.`,
            { items: items.length, statuses: manual.length, groupItems },
          );
        }
        const why = "kivéve a napi listából";
        for (const it of items) {
          await tx.feedingItem.update({ where: { id: it.id }, data: { status: "INVALIDATED", invalidationReason: why, version: { increment: 1 }, updatedById: actor.id, updatedAt: serverNow } });
          await writeAudit(tx, { userId: actor.id, action: "INVALIDATE", entityType: "FeedingItem", entityId: it.id, changes: { status: { before: "VALID", after: "INVALIDATED" } }, reason: why, requestId: input.requestId });
        }
        for (const st of manual) {
          await tx.eatingStatus.update({ where: { id: st.id }, data: { status: "INVALIDATED", invalidationReason: why, version: { increment: 1 }, updatedById: actor.id, updatedAt: serverNow } });
          await writeAudit(tx, { userId: actor.id, action: "INVALIDATE", entityType: "EatingStatus", entityId: st.id, changes: { status: { before: "VALID", after: "INVALIDATED" } }, reason: why, requestId: input.requestId });
        }
        await tx.feedingSelection.update({ where: { id: sel.id }, data: { status: "INVALIDATED", invalidationReason: input.reason ?? why, version: { increment: 1 }, updatedById: actor.id, updatedAt: serverNow } });
        await writeAudit(tx, { userId: actor.id, action: "INVALIDATE", entityType: "FeedingSelection", entityId: sel.id, changes: { animalId: { before: sel.animalId, after: null } }, reason: input.reason ?? why, requestId: input.requestId });
        changed++;
      }
    }
    if (f.closed) await afterClosedDayChange(tx, fd.id, input.day, actor, input.requestId);
    return { replayed: false, changed, groupsWithoutSelected: input.selected ? [] : await groupItemsWithoutSelected(tx, fd.id) };
  });
}

/** Group items of the day none of whose participants is selected any more (R-8: shown, not invalidated). */
export async function groupItemsWithoutSelected(tx: Tx, feedingDayId: string): Promise<string[]> {
  const selected = await selectedOn(tx, feedingDayId);
  const items = await tx.feedingItem.findMany({
    where: { feedingDayId, status: "VALID", groupId: { not: null } },
    include: { participants: true },
  });
  return items.filter((i) => !i.participants.some((p) => selected.has(p.animalId))).map((i) => i.id);
}

/** A change on a closed, finalized day: the automatic fasting days follow it (T-01/6, R-1). */
async function afterClosedDayChange(tx: Tx, feedingDayId: string, _d: string, actor: Actor, requestId: string) {
  await recomputeFasting(tx, feedingDayId, actor.id, requestId);
}

// ---------------------------------------------------------------------------
// Automatic fasting days (EVE-11, T-01, T-19, R-1, R-2, R-14)
// ---------------------------------------------------------------------------

/**
 * The animals that get an automatic fasting day when not selected (T-01/5, R-14): alive and placed
 * at the start of the day, and no arrival, death or release on that day.
 */
export async function fastingEligible(tx: Tx, d: string): Promise<Set<string>> {
  const { start, end } = dayBounds(d);
  const events = await tx.lifecycleEvent.findMany({ where: { status: "VALID" }, select: { animalId: true, type: true, occurredAt: true } });
  const by = new Map<string, { arrived?: Date; ended?: Date; eventToday: boolean }>();
  for (const e of events) {
    const r = by.get(e.animalId) ?? { eventToday: false };
    if (e.type === "ARRIVAL") r.arrived = e.occurredAt;
    if (e.type === "DEATH" || e.type === "RELEASE") r.ended = e.occurredAt;
    if ((e.type === "ARRIVAL" || e.type === "DEATH" || e.type === "RELEASE") && e.occurredAt >= start && e.occurredAt < end) r.eventToday = true;
    by.set(e.animalId, r);
  }
  return new Set(
    [...by]
      .filter(([, r]) => r.arrived && r.arrived <= start && (!r.ended || r.ended > start) && !r.eventToday)
      .map(([id]) => id),
  );
}

/**
 * Makes the AUTOMATIC fasting rows of a closed, finalized day match the selection: creates the
 * missing ones, invalidates the ones that no longer apply, touches nothing else and never a MANUAL
 * row. Idempotent: the same state gives the same rows (T-19). Written by the given actor (the
 * System user for the automatic close, R-12).
 */
export async function recomputeFasting(tx: Tx, feedingDayId: string, actorId: string, requestId: string | null, now = new Date()) {
  await lockFeedingDay(tx, feedingDayId);
  const fd = await tx.feedingDay.findUniqueOrThrow({ where: { id: feedingDayId }, include: { journalDay: true } });
  const d = dateToDay(fd.businessDay);
  const active = fd.journalDay.state === "CLOSED" && fd.listState === "FINALIZED";
  const eligible = active ? await fastingEligible(tx, d) : new Set<string>();
  const selected = await selectedOn(tx, fd.id);
  const statuses = await tx.eatingStatus.findMany({ where: { feedingDayId: fd.id, status: "VALID" } });
  const autoNow = new Map(statuses.filter((s) => s.source === "AUTOMATIC").map((s) => [s.animalId, s]));
  const manual = new Set(statuses.filter((s) => s.source === "MANUAL").map((s) => s.animalId));
  const want = new Set([...eligible].filter((id) => !selected.has(id) && !manual.has(id)));
  let created = 0;
  let removed = 0;
  for (const animalId of want) {
    if (autoNow.has(animalId)) continue;
    const row = await tx.eatingStatus.create({
      data: {
        feedingDayId: fd.id,
        animalId,
        state: "FASTING",
        source: "AUTOMATIC",
        requestId: `auto-fasting:${fd.id}:${animalId}:${now.getTime()}`,
        createdById: actorId,
        updatedById: actorId,
      },
    });
    await writeAudit(tx, { userId: actorId, action: "CREATE", entityType: "EatingStatus", entityId: row.id, changes: { state: { before: null, after: "FASTING" }, animalId: { before: null, after: animalId } }, requestId });
    created++;
  }
  for (const [animalId, row] of autoNow) {
    if (want.has(animalId)) continue;
    await tx.eatingStatus.update({
      where: { id: row.id },
      data: { status: "INVALIDATED", invalidationReason: "utólagos kiválasztás vagy életciklus-változás", version: { increment: 1 }, updatedById: actorId, updatedAt: now },
    });
    await writeAudit(tx, { userId: actorId, action: "INVALIDATE", entityType: "EatingStatus", entityId: row.id, changes: { status: { before: "VALID", after: "INVALIDATED" } }, reason: "a koplalónap már nem érvényes", requestId });
    removed++;
  }
  return { created, removed };
}

/**
 * R-1 (2): the manual rows of an animal (selection, own feeding item, manual eating status) on days
 * it was not alive. A lifecycle change that would leave such rows does not go through silently: the
 * caller gets the list, and an admin invalidates them or fixes the event's date.
 */
export async function manualRowsOutsideLife(tx: Tx, animalId: string) {
  const day = { select: { businessDay: true } } as const;
  const [sel, items, statuses] = await Promise.all([
    tx.feedingSelection.findMany({ where: { animalId, status: "VALID" }, include: { feedingDay: day } }),
    tx.feedingItem.findMany({ where: { animalId, status: "VALID" }, include: { feedingDay: day } }),
    tx.eatingStatus.findMany({ where: { animalId, status: "VALID", source: "MANUAL" }, include: { feedingDay: day } }),
  ]);
  const rows = [
    ...sel.map((r) => ({ kind: "FeedingSelection", id: r.id, day: dateToDay(r.feedingDay.businessDay) })),
    ...items.map((r) => ({ kind: "FeedingItem", id: r.id, day: dateToDay(r.feedingDay.businessDay) })),
    ...statuses.map((r) => ({ kind: "EatingStatus", id: r.id, day: dateToDay(r.feedingDay.businessDay) })),
  ];
  const out: typeof rows = [];
  for (const d of new Set(rows.map((r) => r.day))) {
    if (!(await aliveOnDay(tx, d, [animalId])).has(animalId)) out.push(...rows.filter((r) => r.day === d));
  }
  return out.sort((x, y) => x.day.localeCompare(y.day) || x.kind.localeCompare(y.kind));
}

/** R-1: after a lifecycle change, the closed finalized days from that day on follow it. */
export async function recomputeClosedDaysFrom(tx: Tx, fromDay: string, actorId: string, requestId: string | null) {
  // in day order, always: two lifecycle changes lock the same days in the same order (no 40P01)
  const days = await tx.feedingDay.findMany({
    where: { businessDay: { gte: dayToDate(fromDay) }, listState: "FINALIZED", journalDay: { state: "CLOSED" } },
    orderBy: { businessDay: "asc" },
  });
  for (const fd of days) await recomputeFasting(tx, fd.id, actorId, requestId);
}

export const finalizeSchema = z.object({
  requestId,
  clientTimestamp: z.iso.datetime({ offset: true }).optional(),
  day,
  confirmEmpty: z.boolean().optional(),
  reason: reason.optional(),
});

/** "Lista kész" (T-01/1): an empty list (a full fasting day) only with an explicit confirmation. */
export async function finalizeList(actor: Actor, input: z.infer<typeof finalizeSchema>, serverNow = new Date()) {
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  const clientTs = input.clientTimestamp ? new Date(input.clientTimestamp) : null;
  return prisma.$transaction(async (tx) => {
    const { f, fd } = await facts(tx, actor, input.day, serverNow, clientTs);
    await enforce(tx, canCreate(f.level, { day: f.d, today: f.today, closed: f.closed }), input.reason);
    if (fd.listState === "FINALIZED") return { replayed: false, already: true };
    const count = await tx.feedingSelection.count({ where: { feedingDayId: fd.id, status: "VALID" } });
    if (count === 0 && !input.confirmEmpty) {
      throw new AppError(409, "EMPTY_LIST", "A lista üres: ez azt jelenti, hogy ma senki nem eszik. Erősítsd meg, ha így van.");
    }
    await tx.feedingDay.update({ where: { id: fd.id }, data: { listState: "FINALIZED", finalizedById: actor.id, finalizedAt: serverNow } });
    await writeAudit(tx, {
      userId: actor.id,
      action: "UPDATE",
      entityType: "FeedingDay",
      entityId: fd.id,
      changes: { listState: { before: "NOT_FINALIZED", after: "FINALIZED" }, selected: { before: null, after: count } },
      reason: input.reason ?? null,
      requestId: input.requestId,
    });
    return { replayed: false, already: false };
  });
}

// ---------------------------------------------------------------------------
// Feeding items (EGY-02..EGY-12, TAK-07, R-8, T-21)
// ---------------------------------------------------------------------------

export const itemSchema = z.object({
  requestId,
  clientTimestamp: z.iso.datetime({ offset: true }).optional(),
  day,
  itemId: z.uuid().optional(),
  expectedVersion: z.number().int().min(1).optional(),
  animalId: z.uuid().optional(),
  groupId: z.uuid().optional(),
  feedId: z.uuid(),
  // it goes to the Excel and may go to a CSV: no formula start (as the names, review of #3 and #10)
  otherName: z.string().trim().min(1).max(60).refine((v) => !/^[=+\-@\t\r]/.test(v), "A név nem kezdődhet =, +, -, @ jellel.").optional(),
  // empty only for a feed with a tick on the sheet (feed.sheetTick, 6fe63c9b item 7): checked below
  quantities: z.array(z.object({ value: z.string().min(1).max(32), unitId: z.uuid() })).max(3),
  reason: reason.optional(),
});

export const itemInvalidateSchema = z.object({ requestId, expectedVersion: z.number().int().min(1), reason: reason.optional() });

export async function selectedOn(tx: Tx, feedingDayId: string) {
  return new Set(
    (await tx.feedingSelection.findMany({ where: { feedingDayId, status: "VALID" }, select: { animalId: true } })).map((s) => s.animalId),
  );
}

async function groupMembersOn(tx: Tx, groupId: string, d: string) {
  const { start, end } = dayBounds(d);
  const rows = await tx.animalGroupMembership.findMany({
    where: { groupId, validFrom: { lt: end }, OR: [{ validTo: null }, { validTo: { gt: start } }] },
    select: { animalId: true },
  });
  return [...new Set(rows.map((r) => r.animalId))];
}

function itemSnapshot(i: FeedingItem, q: { quantity: string; unitId: string }[], participants: string[]) {
  return { animalId: i.animalId, groupId: i.groupId, feedId: i.feedId, otherName: i.otherName, quantities: q, participants, status: i.status };
}

export async function saveFeedingItem(actor: Actor, input: z.infer<typeof itemSchema>, serverNow = new Date()) {
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  if (!input.animalId === !input.groupId) throw new AppError(422, "ONE_RECIPIENT", "Egy tétel egy állatnak vagy egy csoportnak szól.");
  const clientTs = input.clientTimestamp ? new Date(input.clientTimestamp) : null;
  try {
    return await prisma.$transaction(async (tx) => {
      const { f, fd } = await facts(tx, actor, input.day, serverNow, clientTs);
      const prior = input.itemId ? await tx.feedingItem.findUnique({ where: { id: input.itemId }, include: { quantities: true, participants: true } }) : null;
      if (input.itemId) {
        if (!prior || prior.feedingDayId !== fd.id) throw new AppError(404, "NOT_FOUND", "A tétel nem található.");
        if (prior.status !== "VALID") throw new AppError(409, "NOT_EDITABLE", "Ez a tétel már nem érvényes.");
        if (prior.version !== input.expectedVersion) throw new AppError(409, "VERSION_CONFLICT", "A tétel időközben megváltozott.");
        await enforce(tx, canModify(f.level, { day: f.d, today: f.today, closed: f.closed, isOwn: prior.createdById === actor.id }), input.reason);
      } else {
        await enforce(tx, canCreate(f.level, { day: f.d, today: f.today, closed: f.closed }), input.reason);
      }

      const feed = await tx.feed.findUnique({ where: { id: input.feedId }, include: { type: true } });
      if (!feed || !feed.active) throw new AppError(422, "FEED_NOT_FOUND", "A takarmány nem található vagy nem aktív.");
      if (feed.type.code === "EGYEB" && !input.otherName) throw new AppError(422, "OTHER_NAME", "Az „Egyéb” takarmányhoz a nevét is meg kell adni (EGY-12).");

      if (input.quantities.length === 0 && !feed.sheetTick) throw new AppError(422, "QUANTITY_REQUIRED", "Adj meg mennyiséget.");
      // quantities: one per dimension, only the feed's dimensions (T-08)
      const units = await tx.unit.findMany({ where: { id: { in: input.quantities.map((q) => q.unitId) } } });
      const seen = new Set<Dimension>();
      const quantities = input.quantities.map((q) => {
        const u = units.find((x) => x.id === q.unitId);
        if (!u) throw new AppError(422, "UNIT_NOT_FOUND", "Ismeretlen mértékegység.");
        if (!feed.allowedDimensions.includes(u.dimension)) {
          throw new AppError(422, "UNIT_DIMENSION", `Ez a takarmány nem mérhető ebben az egységben (${u.symbol}).`);
        }
        if (seen.has(u.dimension)) throw new AppError(422, "ONE_PER_DIMENSION", "Egy tételben dimenziónként egy mennyiség lehet (pl. egy darab és egy gramm).");
        seen.add(u.dimension);
        const v = parseDecimalInput(q.value);
        if (v === null || compareDecimal(v, "0") <= 0) throw new AppError(422, "INVALID_VALUE", "A mennyiség pozitív szám legyen.");
        return { quantity: v, unitId: u.id, dimension: u.dimension };
      });

      // recipient rule (INV, adatmodell 9.): a selected animal, or a group with a selected member today
      const selected = await selectedOn(tx, fd.id);
      let participants: string[] = [];
      if (input.animalId) {
        if (!selected.has(input.animalId)) throw new AppError(422, "NOT_SELECTED", "Csak a mai listán kiválasztott állat kaphat tételt.");
      } else {
        participants = (await groupMembersOn(tx, input.groupId!, input.day)).filter((a) => selected.has(a));
        if (participants.length === 0) throw new AppError(422, "GROUP_NONE_SELECTED", "A csoportnak ma egy tagja sincs kiválasztva.");
      }
      // T-21: an animal cannot get the same feed both as itself and as a group participant
      const other = await tx.feedingItem.findMany({
        where: {
          feedingDayId: fd.id,
          feedId: feed.id,
          otherName: input.otherName ?? null,
          status: "VALID",
          ...(input.itemId ? { id: { not: input.itemId } } : {}),
          ...(input.animalId ? { groupId: { not: null } } : { animalId: { in: participants } }),
        },
        include: { participants: true },
      });
      const clash = input.animalId ? other.some((o) => o.participants.some((p) => p.animalId === input.animalId)) : other.length > 0;
      if (clash) throw new AppError(409, "DOUBLE_FEEDING", "Ez az állat ugyanezt a takarmányt ma már egyedileg vagy a csoportjával megkapta.");

      const data = {
        feedingDayId: fd.id,
        animalId: input.animalId ?? null,
        groupId: input.groupId ?? null,
        feedId: feed.id,
        otherName: input.otherName ?? null,
        updatedById: actor.id,
        updatedAt: serverNow,
      };
      let item: FeedingItem;
      if (prior) {
        const res = await tx.feedingItem.updateMany({ where: { id: prior.id, version: prior.version, status: "VALID" }, data: { ...data, version: { increment: 1 } } });
        if (res.count !== 1) throw new AppError(409, "VERSION_CONFLICT", "A tétel időközben megváltozott.");
        await tx.feedingQuantity.deleteMany({ where: { itemId: prior.id } });
        await tx.feedingParticipant.deleteMany({ where: { itemId: prior.id } });
        item = await tx.feedingItem.findUniqueOrThrow({ where: { id: prior.id } });
      } else {
        item = await tx.feedingItem.create({ data: { ...data, requestId: input.requestId, createdById: actor.id } });
      }
      await tx.feedingQuantity.createMany({ data: quantities.map((q) => ({ ...q, itemId: item.id })) });
      if (participants.length) await tx.feedingParticipant.createMany({ data: participants.map((animalId) => ({ itemId: item.id, animalId })) });
      await writeAudit(tx, {
        userId: actor.id,
        action: prior ? "UPDATE" : "CREATE",
        entityType: "FeedingItem",
        entityId: item.id,
        changes: diffFields(
          prior ? itemSnapshot(prior, prior.quantities.map((q) => ({ quantity: canonicalDecimal(q.quantity), unitId: q.unitId })), prior.participants.map((p) => p.animalId).sort()) : null,
          itemSnapshot(item, quantities.map((q) => ({ quantity: q.quantity, unitId: q.unitId })), [...participants].sort()),
        ),
        reason: input.reason ?? null,
        requestId: input.requestId,
        clientTimestamp: clientTs,
      });
      return { replayed: false, itemId: item.id, version: item.version };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError(409, "CELL_TAKEN", "Ebbe a cellába közben más már rögzített tételt.");
    throw e;
  }
}

export async function invalidateFeedingItem(actor: Actor, id: string, input: z.infer<typeof itemInvalidateSchema>, serverNow = new Date()) {
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  return prisma.$transaction(async (tx) => {
    const it = await tx.feedingItem.findUnique({ where: { id }, include: { feedingDay: true } });
    if (!it) throw new AppError(404, "NOT_FOUND", "A tétel nem található.");
    const { f } = await facts(tx, actor, dateToDay(it.feedingDay.businessDay), serverNow, null);
    await enforce(tx, canModify(f.level, { day: f.d, today: f.today, closed: f.closed, isOwn: it.createdById === actor.id }), input.reason);
    await requireReason(tx, true, input.reason, "Az érvénytelenítéshez indoklás kell.");
    const res = await tx.feedingItem.updateMany({
      where: { id, version: input.expectedVersion, status: "VALID" },
      data: { status: "INVALIDATED", invalidationReason: input.reason, version: { increment: 1 }, updatedById: actor.id, updatedAt: serverNow },
    });
    if (res.count !== 1) throw new AppError(409, "VERSION_CONFLICT", "A tétel időközben megváltozott.");
    await writeAudit(tx, { userId: actor.id, action: "INVALIDATE", entityType: "FeedingItem", entityId: id, changes: { status: { before: "VALID", after: "INVALIDATED" } }, reason: input.reason, requestId: input.requestId });
    return { replayed: false };
  });
}

// ---------------------------------------------------------------------------
// The day view (EGY-06, EGY-08: totals per unit, never across dimensions)
// ---------------------------------------------------------------------------

export type DayAnimal = { id: string; name: string; groupId: string | null; groupName: string | null; poolName: string | null; poolEmoji: string | null; selected: boolean };

export async function feedingDayView(d: string) {
  const { start, end } = dayBounds(d);
  const at = new Date(Math.min(end.getTime() - 1, Date.now()));
  const fd = await prisma.feedingDay.findUnique({ where: { businessDay: dayToDate(d) }, include: { journalDay: true } });
  const alive = await aliveOnDay(prisma, d);
  const animals = await prisma.animal.findMany({
    where: { id: { in: [...alive] } },
    include: {
      names: true,
      placements: { include: { pool: { include: { names: true } } } },
      memberships: { include: { group: { include: { names: true } } } },
    },
  });
  const selected = fd ? await selectedOn(prisma, fd.id) : new Set<string>();
  const items = fd
    ? await prisma.feedingItem.findMany({
        where: { feedingDayId: fd.id, status: "VALID" },
        include: { quantities: { include: { unit: true } }, participants: true, feed: { include: { names: true } } },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const unsorted: (DayAnimal & { sortOrder: number | null })[] = animals
    .map((a) => {
      const m = pickValid(a.memberships, at) ?? a.memberships.find((x) => x.validFrom < end && (!x.validTo || x.validTo > start));
      const p = pickValid(a.placements, at) ?? a.placements.find((x) => x.validFrom < end && (!x.validTo || x.validTo > start));
      return {
        id: a.id,
        name: pickValid(a.names, at)?.name ?? a.names.at(-1)?.name ?? "?",
        groupId: m?.groupId ?? null,
        groupName: m ? pickValid(m.group.names, at)?.name ?? "?" : null,
        poolName: p ? pickValid(p.pool.names, at)?.displayName ?? p.pool.code : null,
        poolEmoji: p?.pool.emoji ?? null,
        selected: selected.has(a.id),
        sortOrder: a.sortOrder,
      };
    });
  // by pool, then the admin's order, then by name (Lili 2026-10-26, card f67b1a06)
  const list = sortDayAnimals(unsorted);
  // row totals per recipient in the base unit of each dimension (EGY-06, EGY-08): 1 kg and 500 g are
  // 1500 g, pieces and grams never add up
  const baseOf = new Map((await prisma.unit.findMany({ where: { isBase: true } })).map((u) => [u.dimension, u.symbol]));
  const totals = new Map<string, Map<string, number>>();
  for (const it of items) {
    const key = it.animalId ?? `g:${it.groupId}`;
    const t = totals.get(key) ?? new Map<string, number>();
    for (const q of it.quantities) {
      const base = baseOf.get(q.unit.dimension) ?? q.unit.symbol;
      t.set(base, (t.get(base) ?? 0) + Number(q.quantity) * Number(q.unit.factorToBase ?? 1));
    }
    totals.set(key, t);
  }
  return {
    day: d,
    listState: fd?.listState ?? "NOT_FINALIZED",
    lock: fd?.journalDay.state ?? "OPEN",
    animals: list,
    /** 6fe63c9b: the day's feeds (the list's second step); empty = not chosen */
    feedIds: fd?.feedIds ?? [],
    items: items.map((it) => ({
      id: it.id,
      version: it.version,
      animalId: it.animalId,
      groupId: it.groupId,
      feedId: it.feedId,
      feed: pickValid(it.feed.names, it.createdAt)?.name ?? "?",
      otherName: it.otherName,
      quantities: it.quantities.map((q) => ({ value: canonicalDecimal(q.quantity), unit: q.unit.symbol })),
      // the feeding sheet's cells: the same amounts in the base unit of their dimension (g, ml, db)
      baseQuantities: it.quantities.map((q) => ({
        unit: baseOf.get(q.unit.dimension) ?? q.unit.symbol,
        value: Number(q.quantity) * Number(q.unit.factorToBase ?? 1),
      })),
      participants: it.participants.map((p) => p.animalId),
      noSelectedMember: it.groupId !== null && !it.participants.some((p) => selected.has(p.animalId)),
      createdById: it.createdById,
    })),
    totals: Object.fromEntries([...totals].map(([k, v]) => [k, Object.fromEntries(v)])),
  };
}

export type { Prisma };
