// Lili 2026-11-10 (Caparium channel, 08:39 UTC; her go-ahead 08:43:35 UTC, msg 1569633612159000577): the animals' group placement
// should start on the day the animals ARRIVED. A membership's start is the event that put the animal into the group (deriveLifecycle):
// most animals arrived alone and were put into their group months later, so on an archived feeding sheet (2026-08-01) the members of
// the ray and the predator groups come as separate rows.
//
// The correction is an EVENT correction, never a write into the derived rows: for an animal that is in a group now and got there by its
// ONLY group event (a group change, the arrival naming no group), that event is invalidated and the same group change is recorded again
// one second after the arrival (the arrival and the group change cannot share an instant: one valid event per instant). The memberships
// are derived again from the events, as for any lifecycle change, and the closed days' fasting is computed again from the earliest day.
//
// An animal that was in more than one group (an arrival into a group and a change later, two changes, a leave and a return) is LEFT OUT
// and named with the reason: which start is right there is a question for Lili, not a rule. A dry run first (the list: animal, group,
// old and new day), the run on its own request, in one transaction, every change audited under it. Feeding admins only.

import { z } from "zod";
import { lockAnimal, rebuildAnimal, refuseOrphanRows } from "./animals";
import { diffFields, writeAudit } from "./audit";
import { prisma, type Tx } from "./db";
import { AppError } from "./errors";
import { recomputeClosedDaysFrom } from "./feeding";
import { moduleLevel, nameAt } from "./master";
import { requireReason } from "./reasons";
import type { Actor } from "./measurements";
import { businessDayOf, dateToDay, dayToDate } from "./time";

export const groupPlacementFixSchema = z.object({
  requestId: z.string().min(8).max(60),
  mode: z.enum(["plan", "run"]),
  reason: z.string().trim().min(3, "Az indoklás legalább 3 karakter legyen.").max(500).optional(),
});

/** How far after the arrival the group change is put: the next second (one valid event per instant). */
export const AFTER_ARRIVAL_MS = 1000;

export interface PlacementChange {
  animalId: string;
  animalName: string;
  groupId: string;
  groupName: string;
  eventId: string;
  eventVersion: number;
  /** The group change's moment now, and the day the animal arrived. */
  from: string;
  arrivedAt: string;
  to: string;
  fromDay: string;
  toDay: string;
}

export interface PlacementSkip {
  animalId: string;
  animalName: string;
  reason: string;
}

type Plan = {
  changes: PlacementChange[];
  skipped: PlacementSkip[];
  /**
   * The CLOSED, finalized feeding days whose fasting the run computes again (from the earliest arrival day on; barracuda on #209):
   * a member's own rows on those days can then count as the group's. Said before the run, so Lili knows what may move on the old
   * sheets; after the run the audit under its request names the days that did change.
   */
  closedDays: { from: string | null; count: number };
};

async function requireFeedingAdmin(actor: Actor) {
  if ((await moduleLevel(prisma, actor.id, actor.role, "FEEDING")) !== "ADMIN") {
    throw new AppError(403, "ADMIN_ONLY", "A csoportba helyezés javítását adminisztrátor végzi.");
  }
}

/** The animals in a group now, and for each what the correction would do, or why it leaves the animal out. */
export async function planGroupPlacementFix(tx: Tx, now = new Date(), only?: readonly string[]): Promise<Plan> {
  const open = await tx.animalGroupMembership.findMany({
    where: { ...(only ? { animalId: { in: [...only] } } : {}), validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] },
    select: { animalId: true, groupId: true },
    orderBy: { animalId: "asc" },
  });
  const byAnimal = new Map<string, string[]>();
  for (const m of open) byAnimal.set(m.animalId, [...(byAnimal.get(m.animalId) ?? []), m.groupId]);
  const plan: Plan = { changes: [], skipped: [], closedDays: { from: null, count: 0 } };
  for (const [animalId, groupIds] of byAnimal) {
    const animal = await tx.animal.findUniqueOrThrow({ where: { id: animalId }, include: { names: true } });
    const animalName = nameAt(animal.names, now)?.name ?? "?";
    const skip = (reason: string) => plan.skipped.push({ animalId, animalName, reason });
    if (groupIds.length !== 1) {
      skip("egyszerre több csoportban van");
      continue;
    }
    const events = await tx.lifecycleEvent.findMany({
      where: { animalId, status: "VALID" },
      orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
    });
    const arrival = events[0];
    if (!arrival || arrival.type !== "ARRIVAL") {
      skip("nincs érvényes érkezése");
      continue;
    }
    const groupEvents = events.filter((e) => e.type === "GROUP_CHANGE");
    if (arrival.toGroupId) {
      // already a member from the arrival: nothing to correct, unless it changed group since
      if (groupEvents.length > 0) skip("több csoportban is volt (az érkezéskor csoportba került, később csoportot váltott)");
      continue;
    }
    if (groupEvents.length !== 1) {
      skip(`több csoportban is volt, vagy kikerült és visszakerült (${groupEvents.length} csoportváltás)`);
      continue;
    }
    const change = groupEvents[0]!;
    if (change.toGroupId !== groupIds[0]) {
      skip("a csoportba helyező esemény nem a mostani csoportjára szól");
      continue;
    }
    const to = new Date(arrival.occurredAt.getTime() + AFTER_ARRIVAL_MS);
    if (change.occurredAt.getTime() <= to.getTime()) continue; // already from the arrival
    const arrivalDay = businessDayOf(arrival.occurredAt);
    if (businessDayOf(to) !== arrivalDay) {
      skip("az érkezés a nap utolsó másodpercében volt, a javított időpont másik napra esne");
      continue;
    }
    if (events.some((e) => e.occurredAt.getTime() === to.getTime())) {
      skip("az érkezés utáni másodpercre már van eseménye");
      continue;
    }
    const group = await tx.animalGroup.findUniqueOrThrow({ where: { id: change.toGroupId }, include: { names: true } });
    plan.changes.push({
      animalId,
      animalName,
      groupId: group.id,
      groupName: nameAt(group.names, now)?.name ?? "?",
      eventId: change.id,
      eventVersion: change.version,
      from: change.occurredAt.toISOString(),
      arrivedAt: arrival.occurredAt.toISOString(),
      to: to.toISOString(),
      fromDay: businessDayOf(change.occurredAt),
      toDay: arrivalDay,
    });
  }
  plan.changes.sort((x, y) => x.groupName.localeCompare(y.groupName, "hu") || x.animalName.localeCompare(y.animalName, "hu"));
  plan.skipped.sort((x, y) => x.animalName.localeCompare(y.animalName, "hu"));
  const from = plan.changes.map((c) => c.toDay).sort()[0] ?? null;
  if (from)
    plan.closedDays = {
      from,
      count: await tx.feedingDay.count({ where: { businessDay: { gte: dayToDate(from) }, listState: "FINALIZED", journalDay: { state: "CLOSED" } } }),
    };
  return plan;
}

/** `only`: the test's own animals (the test database is shared by the files); the route never passes it. */
/**
 * What the run's fasting recompute changed on the closed days, from the audit under its request: the days, and the automatic fasting
 * days added and taken off (barracuda on #209: what moved on the old sheets is said after the run, not guessed).
 */
export async function closedDayChanges(tx: Tx, requestId: string) {
  const audits = await tx.auditEntry.findMany({ where: { requestId, entityType: "EatingStatus" }, select: { action: true, entityId: true } });
  const rows = await tx.eatingStatus.findMany({
    where: { id: { in: audits.map((a) => a.entityId) } },
    select: { id: true, feedingDay: { select: { businessDay: true } } },
  });
  const dayOf = new Map(rows.map((r) => [r.id, dateToDay(r.feedingDay.businessDay)]));
  return {
    days: [...new Set(audits.map((a) => dayOf.get(a.entityId)).filter((d): d is string => !!d))].sort(),
    fastingAdded: audits.filter((a) => a.action === "CREATE").length,
    fastingRemoved: audits.filter((a) => a.action === "INVALIDATE").length,
  };
}

export async function fixGroupPlacements(actor: Actor, raw: z.input<typeof groupPlacementFixSchema>, now = new Date(), only?: readonly string[]) {
  const input = groupPlacementFixSchema.parse(raw);
  await requireFeedingAdmin(actor);
  if (input.mode === "plan") return { plan: await planGroupPlacementFix(prisma, now, only) };

  await requireReason(prisma, true, input.reason, "A javításhoz indoklás kell.");
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  return prisma.$transaction(
    async (tx) => {
      // the animals' locks in id order (two runs, or a run and a lifecycle change, wait for each other), then planned again under them:
      // the run follows the events as they are, not as the dry run saw them
      const first = await planGroupPlacementFix(tx, now, only);
      const locked = new Set(first.changes.map((c) => c.animalId));
      for (const id of [...locked].sort()) await lockAnimal(tx, id);
      const p = await planGroupPlacementFix(tx, now, only);
      // an animal the plan under the locks brings and the first one did not (a lifecycle change committed meanwhile) is not locked:
      // stop rather than write it unlocked (barracuda on #209); a run again plans afresh
      if (p.changes.some((c) => !locked.has(c.animalId)))
        throw new AppError(409, "PLAN_CHANGED", "Az állatok eseményei a futás közben megváltoztak. Futtasd újra a javítást.");
      if (!p.changes.length) throw new AppError(422, "NO_CHANGE", "Nincs javítandó csoportba helyezés.");
      const why = `csoportba helyezés az érkezés napjára (Lili kérése, 2026-11-10)${input.reason ? `: ${input.reason}` : ""}`.slice(0, 500);
      for (const c of p.changes) {
        const old = await tx.lifecycleEvent.findUniqueOrThrow({ where: { id: c.eventId } });
        const res = await tx.lifecycleEvent.updateMany({
          where: { id: c.eventId, version: c.eventVersion, status: "VALID" },
          data: { status: "INVALIDATED", invalidationReason: why, version: { increment: 1 }, updatedById: actor.id, updatedAt: now },
        });
        if (res.count !== 1) throw new AppError(409, "VERSION_CONFLICT", `${c.animalName} eseménye időközben megváltozott.`);
        const created = await tx.lifecycleEvent.create({
          data: {
            animalId: c.animalId,
            type: "GROUP_CHANGE",
            occurredAt: new Date(c.to),
            businessDay: dayToDate(c.toDay),
            toPoolId: null,
            toGroupId: c.groupId,
            note: old.note,
            requestId: `${input.requestId}:${c.animalId}`,
            createdById: actor.id,
            updatedById: actor.id,
          },
        });
        await rebuildAnimal(tx, c.animalId);
        await refuseOrphanRows(tx, c.animalId);
        const fact = { correctedFrom: { before: c.from, after: c.to } };
        await writeAudit(tx, {
          userId: actor.id,
          action: "INVALIDATE",
          entityType: "LifecycleEvent",
          entityId: c.eventId,
          changes: { status: { before: "VALID", after: "INVALIDATED" }, ...fact },
          reason: input.reason ?? null,
          requestId: input.requestId,
        });
        await writeAudit(tx, {
          userId: actor.id,
          action: "CREATE",
          entityType: "LifecycleEvent",
          entityId: created.id,
          changes: { ...diffFields(null, { animalId: c.animalId, type: "GROUP_CHANGE", occurredAt: c.to, toGroupId: c.groupId }), ...fact },
          reason: input.reason ?? null,
          requestId: input.requestId,
        });
      }
      // the closed days' fasting from the earliest day the memberships changed on, once (the arrival day of the earliest animal)
      const earliest = p.changes.map((c) => c.toDay).sort()[0]!;
      await recomputeClosedDaysFrom(tx, earliest, actor.id, input.requestId);
      return { replayed: false, fixed: p, closedDaysChanged: await closedDayChanges(tx, input.requestId) };
    },
    { timeout: 120_000 },
  );
}
