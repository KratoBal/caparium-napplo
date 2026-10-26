// Animals, groups and their lifecycle (adatmodell 6. és 7. terület; DAT-01, DAT-05, EVE-03, T-09, R-1).
// The lifecycle is a list of dated events (arrival, transfer, group change, death, release). Where an
// animal is and which group it belongs to is DERIVED: on every event change the placements and the
// memberships of that animal are rebuilt from its valid events, in the same transaction, so a later
// date fix or an invalidation can never leave them contradicting the events.
// Permissions (Lili 2026-10-26, msg 1564214896453750805, overriding NY-20): every lifecycle event is admin
// work; an earlier date also needs a reason. The rule is lifecycle-access.ts.

import { compareAnimals, orderAssignments } from "./animal-order";
import { lifecycleAccessProblem, lifecycleInvalidateProblem } from "./lifecycle-access";
import type { LifecycleEvent, LifecycleType, Sex } from "@prisma/client";
import { z } from "zod";
import { diffFields, writeAudit } from "./audit";
import { manualRowsOutsideLife, recomputeClosedDaysFrom } from "./feeding";
import { prisma, type Tx } from "./db";
import { AppError, isUniqueViolation } from "./errors";
import { moduleLevel, pickValid, validAt } from "./master";
import { requireReason } from "./reasons";
import type { Actor } from "./measurements";
import { canCreate, canModify, effectiveNow } from "./permissions";
import { businessDayOf, dateToDay, dayToDate, resolveLocalDateTime } from "./time";

const reason = z.string().trim().min(3, "Az indoklás legalább 3 karakter legyen.").max(500);
const exportSafeName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((v) => !/^[=+\-@]/.test(v), "A név nem kezdődhet =, +, -, @ jellel.");

export const lifecycleSchema = z.object({
  requestId: z.string().min(8).max(100),
  clientTimestamp: z.iso.datetime({ offset: true }).optional(),
  type: z.enum(["ARRIVAL", "TRANSFER", "GROUP_CHANGE", "DEATH", "RELEASE"]),
  animalId: z.uuid().optional(),
  newAnimal: z.object({ speciesId: z.uuid(), name: exportSafeName, sex: z.enum(["MALE", "FEMALE", "UNKNOWN"]) }).optional(),
  occurredAtLocal: z.string().optional(),
  toPoolId: z.uuid().nullable().optional(),
  toGroupId: z.uuid().nullable().optional(),
  note: z.string().trim().max(500).optional(),
  reason: reason.optional(),
});
export type LifecycleInput = z.infer<typeof lifecycleSchema>;

export const lifecycleInvalidateSchema = z.object({
  requestId: z.string().min(8).max(100),
  expectedVersion: z.number().int().min(1),
  reason: reason.optional(),
});

const TERMINAL: LifecycleType[] = ["DEATH", "RELEASE"];

type Built = {
  placements: { poolId: string; validFrom: Date; validTo: Date | null; eventId: string }[];
  memberships: { groupId: string; validFrom: Date; validTo: Date | null; eventId: string }[];
};

/** The placements and memberships the valid events say, or the reason they contradict each other. */
export function deriveLifecycle(events: Pick<LifecycleEvent, "id" | "type" | "occurredAt" | "toPoolId" | "toGroupId">[]): Built | { error: string } {
  const out: Built = { placements: [], memberships: [] };
  if (events.length === 0) return out;
  if (events[0].type !== "ARRIVAL") return { error: "Az első eseménynek érkezésnek kell lennie." };
  let ended = false;
  for (const [i, e] of events.entries()) {
    if (ended) return { error: "Elhullás vagy kiadás után nem lehet újabb esemény." };
    if (e.type === "ARRIVAL" && i > 0) return { error: "Egy állatnak csak egy érkezése lehet." };
    const openP = out.placements.at(-1);
    const openM = out.memberships.at(-1);
    if (e.type === "ARRIVAL" || e.type === "TRANSFER") {
      if (!e.toPoolId) return { error: "Az érkezéshez és az áthelyezéshez medence kell." };
      if (e.type === "TRANSFER" && openP && openP.validTo === null && openP.poolId === e.toPoolId) {
        return { error: "Az állat már ebben a medencében van." };
      }
      if (openP && openP.validTo === null) openP.validTo = e.occurredAt;
      out.placements.push({ poolId: e.toPoolId, validFrom: e.occurredAt, validTo: null, eventId: e.id });
    }
    if (e.type === "ARRIVAL" || e.type === "GROUP_CHANGE") {
      if (openM && openM.validTo === null) openM.validTo = e.occurredAt;
      if (e.toGroupId) out.memberships.push({ groupId: e.toGroupId, validFrom: e.occurredAt, validTo: null, eventId: e.id });
    }
    if (TERMINAL.includes(e.type)) {
      if (openP && openP.validTo === null) openP.validTo = e.occurredAt;
      if (openM && openM.validTo === null) openM.validTo = e.occurredAt;
      ended = true;
    }
  }
  return out;
}

/** Rebuilds the derived rows of one animal from its valid events; refuses a contradiction. */
export async function rebuildAnimal(tx: Tx, animalId: string): Promise<void> {
  const events = await tx.lifecycleEvent.findMany({
    where: { animalId, status: "VALID" },
    orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
  });
  const built = deriveLifecycle(events);
  if ("error" in built) throw new AppError(409, "LIFECYCLE_INVALID", built.error);
  await tx.placement.deleteMany({ where: { animalId } });
  await tx.animalGroupMembership.deleteMany({ where: { animalId } });
  if (built.placements.length) await tx.placement.createMany({ data: built.placements.map((p) => ({ ...p, animalId })) });
  if (built.memberships.length) await tx.animalGroupMembership.createMany({ data: built.memberships.map((m) => ({ ...m, animalId })) });
}

function eventSnapshot(e: LifecycleEvent): Record<string, unknown> {
  return {
    type: e.type,
    occurredAt: e.occurredAt.toISOString(),
    toPoolId: e.toPoolId,
    toGroupId: e.toGroupId,
    note: e.note,
    status: e.status,
    invalidationReason: e.invalidationReason,
  };
}

/** R-1 (2): stop, with the list, if the change leaves manual rows on days the animal was not alive. */
async function refuseOrphanRows(tx: Tx, animalId: string) {
  const rows = await manualRowsOutsideLife(tx, animalId);
  if (rows.length) {
    throw new AppError(409, "MANUAL_ROWS_CONFLICT", "Az állatnak a módosítás után olyan napokon is maradna kiválasztása, etetési tétele vagy evési állapota, amikor nem élt. Előbb ezeket kell érvényteleníteni, vagy az esemény dátumát javítani.", { rows });
  }
}

async function enforce(tx: Tx, decision: ReturnType<typeof canCreate>, reasonText: string | undefined) {
  if (decision.kind === "DENY") throw new AppError(403, decision.code, decision.message);
  await requireReason(tx, decision.reasonRequired, reasonText, "Korábbi napra rögzített eseményhez indoklás kell.");
}

/**
 * Serializes the event changes of one animal (review of #9): the sequence check reads the valid events,
 * and under READ COMMITTED two transactions would not see each other's insert (a death and a later
 * transfer at the same moment would both pass). The row lock makes the second one wait and re-read.
 */
// FOR NO KEY UPDATE, not FOR UPDATE: it still serializes the event changes of one animal, but it does
// not block the foreign-key checks (FOR KEY SHARE) of a feeding-day writer inserting a row for the same
// animal. With FOR UPDATE a lifecycle change (animal, then day) and a day writer (day, then the
// animal's key) would deadlock.
async function lockAnimal(tx: Tx, animalId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "animal" WHERE "id" = ${animalId}::uuid FOR NO KEY UPDATE`;
  return rows.length === 1;
}

const SAME_INSTANT = "Erre az állatra ugyanerre az időpontra már van érvényes esemény. Adj meg másik időpontot.";

export async function createLifecycleEvent(actor: Actor, input: LifecycleInput, serverNow = new Date()) {
  const prior = await prisma.lifecycleEvent.findUnique({ where: { requestId: input.requestId } });
  if (prior) return { eventId: prior.id, animalId: prior.animalId, replayed: true };
  const level = await moduleLevel(prisma, actor.id, actor.role, "FEEDING");
  const denied = lifecycleAccessProblem(level, input.type);
  if (denied) throw new AppError(403, "ADMIN_ONLY", denied);
  const clientTs = input.clientTimestamp ? new Date(input.clientTimestamp) : null;
  const eff = effectiveNow(serverNow, clientTs, 30, 48);
  const occurredAt = input.occurredAtLocal ? resolveLocalDateTime(input.occurredAtLocal)?.instant : eff.now;
  if (!occurredAt) throw new AppError(422, "INVALID_TIME", "Az esemény időpontja érvénytelen.");
  if (occurredAt.getTime() > serverNow.getTime() + 5 * 60_000) throw new AppError(422, "FUTURE_TIME", "Jövőbeli eseményt nem lehet rögzíteni.");
  const day = businessDayOf(occurredAt);
  await enforce(prisma, canCreate(level, { day, today: businessDayOf(eff.now), closed: false }), input.reason);

  try {
    return await prisma.$transaction(async (tx) => createInTx(tx, actor, input, { occurredAt, day, clientTs }));
  } catch (e) {
    if (isUniqueViolation(e, "occurredAt") || isUniqueViolation(e, "one_valid_per_instant")) throw new AppError(409, "SAME_INSTANT", SAME_INSTANT);
    throw e;
  }
}

async function createInTx(tx: Tx, actor: Actor, input: LifecycleInput, at: { occurredAt: Date; day: string; clientTs: Date | null }) {
  const { occurredAt, day, clientTs } = at;
  let animalId = input.animalId;
  if (input.type === "ARRIVAL") {
    if (!input.newAnimal) throw new AppError(422, "NEW_ANIMAL_REQUIRED", "Az érkezéshez az új állat adatai kellenek.");
    const species = await tx.species.findUnique({ where: { id: input.newAnimal.speciesId } });
    if (!species || !species.active) throw new AppError(422, "SPECIES_NOT_FOUND", "A faj nem található.");
    const a = await tx.animal.create({
      data: {
        speciesId: species.id,
        sex: input.newAnimal.sex as Sex,
        names: { create: { name: input.newAnimal.name, validFrom: occurredAt } },
      },
    });
    animalId = a.id;
  } else if (!animalId || !(await lockAnimal(tx, animalId))) {
    throw new AppError(404, "ANIMAL_NOT_FOUND", "Az állat nem található.");
  }
  const e = await tx.lifecycleEvent.create({
    data: {
      animalId: animalId!,
      type: input.type,
      occurredAt,
      businessDay: dayToDate(day),
      toPoolId: input.toPoolId ?? null,
      toGroupId: input.toGroupId ?? null,
      note: input.note ?? null,
      requestId: input.requestId,
      createdById: actor.id,
      updatedById: actor.id,
    },
  });
  await rebuildAnimal(tx, animalId!);
  await refuseOrphanRows(tx, animalId!);
  // R-1: a death or arrival dated into a closed, finalized feeding day changes its fasting days
  await recomputeClosedDaysFrom(tx, day, actor.id, input.requestId);
  await writeAudit(tx, {
    userId: actor.id,
    action: "CREATE",
    entityType: "LifecycleEvent",
    entityId: e.id,
    changes: diffFields(null, { animalId, ...eventSnapshot(e) }),
    reason: input.reason ?? null,
    requestId: input.requestId,
    clientTimestamp: clientTs,
  });
  return { eventId: e.id, animalId: animalId!, replayed: false };
}

export async function invalidateLifecycleEvent(
  actor: Actor,
  id: string,
  input: z.infer<typeof lifecycleInvalidateSchema>,
  serverNow = new Date(),
) {
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId, entityId: id } })) return { replayed: true };
  const level = await moduleLevel(prisma, actor.id, actor.role, "FEEDING");
  const denied = lifecycleInvalidateProblem(level);
  if (denied) throw new AppError(403, "ADMIN_ONLY", denied);
  return prisma.$transaction(async (tx) => {
    // the animal's lock first, then the event read again under it (lockAnimal)
    const owner = await tx.lifecycleEvent.findUnique({ where: { id }, select: { animalId: true } });
    if (!owner) throw new AppError(404, "NOT_FOUND", "Az esemény nem található.");
    await lockAnimal(tx, owner.animalId);
    const cur = await tx.lifecycleEvent.findUnique({ where: { id } });
    if (!cur) throw new AppError(404, "NOT_FOUND", "Az esemény nem található.");
    if (cur.status !== "VALID") throw new AppError(409, "NOT_EDITABLE", "Ez az esemény már nem érvényes.");
    if (cur.version !== input.expectedVersion) throw new AppError(409, "VERSION_CONFLICT", "Az esemény időközben megváltozott.");
    const d = canModify(level, {
      day: dateToDay(cur.businessDay),
      today: businessDayOf(serverNow),
      closed: false,
      isOwn: cur.createdById === actor.id,
    });
    if (d.kind === "DENY") throw new AppError(403, d.code, d.message);
    await requireReason(tx, true, input.reason, "Az érvénytelenítéshez indoklás kell.");
    const res = await tx.lifecycleEvent.updateMany({
      where: { id, version: input.expectedVersion, status: "VALID" },
      data: { status: "INVALIDATED", invalidationReason: input.reason, version: { increment: 1 }, updatedById: actor.id, updatedAt: serverNow },
    });
    if (res.count !== 1) throw new AppError(409, "VERSION_CONFLICT", "Az esemény időközben megváltozott.");
    await rebuildAnimal(tx, cur.animalId);
    await refuseOrphanRows(tx, cur.animalId);
    await recomputeClosedDaysFrom(tx, dateToDay(cur.businessDay), actor.id, input.requestId);
    const after = await tx.lifecycleEvent.findUniqueOrThrow({ where: { id } });
    await writeAudit(tx, {
      userId: actor.id,
      action: "INVALIDATE",
      entityType: "LifecycleEvent",
      entityId: id,
      changes: diffFields(eventSnapshot(cur), eventSnapshot(after)),
      reason: input.reason,
      requestId: input.requestId,
    });
    return { replayed: false };
  });
}

// ---------------------------------------------------------------------------
// Master data: species, groups, animal names (admin, K3)
// ---------------------------------------------------------------------------

async function requireAdmin(actor: Actor) {
  if ((await moduleLevel(prisma, actor.id, actor.role, "SETTINGS")) !== "ADMIN") {
    throw new AppError(403, "ADMIN_ONLY", "Ezt csak adminisztrátor módosíthatja.");
  }
}

export const speciesSchema = z.object({
  requestId: z.string().min(8).max(100),
  scientificName: exportSafeName,
  hungarianName: exportSafeName.optional(),
});

export async function createSpecies(actor: Actor, input: z.infer<typeof speciesSchema>) {
  await requireAdmin(actor);
  return prisma.$transaction(async (tx) => {
    const s = await tx.species.create({ data: { scientificName: input.scientificName, hungarianName: input.hungarianName ?? null } });
    await writeAudit(tx, {
      userId: actor.id,
      action: "MASTER_CHANGE",
      entityType: "Species",
      entityId: s.id,
      changes: diffFields(null, { scientificName: s.scientificName, hungarianName: s.hungarianName }),
      requestId: input.requestId,
    });
    return { id: s.id };
  });
}

export const groupSchema = z.object({ requestId: z.string().min(8).max(100), name: exportSafeName });

export async function createGroup(actor: Actor, input: z.infer<typeof groupSchema>, now = new Date()) {
  await requireAdmin(actor);
  return prisma.$transaction(async (tx) => {
    const g = await tx.animalGroup.create({ data: { names: { create: { name: input.name, validFrom: now } } } });
    await writeAudit(tx, {
      userId: actor.id,
      action: "MASTER_CHANGE",
      entityType: "AnimalGroup",
      entityId: g.id,
      changes: diffFields(null, { name: input.name }),
      requestId: input.requestId,
    });
    return { id: g.id };
  });
}

export const renameSchema = z.object({
  requestId: z.string().min(8).max(100),
  name: exportSafeName,
  mode: z.enum(["change", "correction"]),
  reason: reason.optional(),
});

/** K3 for animal and group names: a change opens a new version, a correction fixes the current one. */
export async function renameEntity(actor: Actor, kind: "animal" | "group", id: string, input: z.infer<typeof renameSchema>, now = new Date()) {
  await requireAdmin(actor);
  await requireReason(prisma, input.mode === "correction", input.reason, "A helyesbítéshez indoklás kell.");
  return prisma.$transaction(async (tx) => {
    const rows =
      kind === "animal"
        ? await tx.animalName.findMany({ where: { animalId: id, ...validAt(now) } })
        : await tx.animalGroupName.findMany({ where: { groupId: id, ...validAt(now) } });
    const cur = rows[0];
    if (!cur) throw new AppError(404, "NOT_FOUND", "Nem található.");
    if (input.mode === "correction") {
      if (kind === "animal") await tx.animalName.update({ where: { id: cur.id }, data: { name: input.name } });
      else await tx.animalGroupName.update({ where: { id: cur.id }, data: { name: input.name } });
    } else if (kind === "animal") {
      await tx.animalName.update({ where: { id: cur.id }, data: { validTo: now } });
      await tx.animalName.create({ data: { animalId: id, name: input.name, validFrom: now } });
    } else {
      await tx.animalGroupName.update({ where: { id: cur.id }, data: { validTo: now } });
      await tx.animalGroupName.create({ data: { groupId: id, name: input.name, validFrom: now } });
    }
    await writeAudit(tx, {
      userId: actor.id,
      action: input.mode === "correction" ? "MASTER_CORRECTION" : "MASTER_CHANGE",
      entityType: kind === "animal" ? "Animal" : "AnimalGroup",
      entityId: id,
      changes: diffFields({ name: cur.name }, { name: input.name }),
      reason: input.reason ?? null,
      requestId: input.requestId,
    });
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Editing an animal (caparium-hibak-5, Balázs 2026-10-20 11:24 UTC: "Lehessen modositani az allatokat")
// ---------------------------------------------------------------------------
// Every field given at the arrival can be changed later, by whoever may record an arrival (FEEDING admin):
// - name: a CHANGE (from now on; the past keeps the old name) or a CORRECTION (a typo; the past too, reason needed),
//   the same K3 rule as the settings;
// - species and sex: attributes without a history; changed in place;
// - the ARRIVAL itself (time, pool, group, note): corrected in place, as a past fact (reason needed); the placement
//   and membership are derived again (deriveLifecycle), and a correction that would contradict a later event or
//   leave manual feeding rows outside the animal's life is refused, as for any lifecycle change.
// Where the animal is NOW is still a transfer or a group change (AnimalActions), not an edit of the arrival.
// One audit row per save names every changed field, before and after.

export const editAnimalSchema = z.object({
  requestId: z.string().min(8).max(100),
  name: exportSafeName.optional(),
  nameMode: z.enum(["change", "correction"]).default("correction"),
  speciesId: z.uuid().optional(),
  sex: z.enum(["MALE", "FEMALE", "UNKNOWN"]).optional(),
  arrival: z
    .object({
      expectedVersion: z.number().int().min(1),
      occurredAtLocal: z.string().optional(),
      toPoolId: z.uuid().optional(),
      toGroupId: z.uuid().nullable().optional(),
      note: z.string().trim().max(500).nullable().optional(),
    })
    .optional(),
  reason: reason.optional(),
});
export type EditAnimalInput = z.input<typeof editAnimalSchema>;

export async function editAnimal(actor: Actor, animalId: string, raw: EditAnimalInput, serverNow = new Date()) {
  const input = editAnimalSchema.parse(raw);
  if (!z.uuid().safeParse(animalId).success) throw new AppError(404, "ANIMAL_NOT_FOUND", "Az állat nem található.");
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId, entityId: animalId } })) return { replayed: true };
  if ((await moduleLevel(prisma, actor.id, actor.role, "FEEDING")) !== "ADMIN") {
    throw new AppError(403, "ADMIN_ONLY", "Állatot az módosíthat, aki érkezést is rögzíthet (adminisztrátor).");
  }
  try {
    return await prisma.$transaction(async (tx) => {
      if (!(await lockAnimal(tx, animalId))) throw new AppError(404, "ANIMAL_NOT_FOUND", "Az állat nem található.");
      const animal = await tx.animal.findUniqueOrThrow({ where: { id: animalId }, include: { species: true } });
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      let corrects = false;

      if (input.name !== undefined) {
        const cur = await tx.animalName.findFirst({ where: { animalId, ...validAt(serverNow) } });
        if (!cur) throw new AppError(404, "NOT_FOUND", "Az állat mai neve nem található.");
        if (cur.name !== input.name) {
          before.name = cur.name;
          after.name = input.name;
          if (input.nameMode === "correction") {
            corrects = true;
            await tx.animalName.update({ where: { id: cur.id }, data: { name: input.name } });
          } else {
            await tx.animalName.update({ where: { id: cur.id }, data: { validTo: serverNow } });
            await tx.animalName.create({ data: { animalId, name: input.name, validFrom: serverNow } });
          }
        }
      }
      if (input.speciesId !== undefined && input.speciesId !== animal.speciesId) {
        const sp = await tx.species.findUnique({ where: { id: input.speciesId } });
        if (!sp || !sp.active) throw new AppError(422, "SPECIES_NOT_FOUND", "A faj nem található.");
        before.species = animal.species.scientificName;
        after.species = sp.scientificName;
        await tx.animal.update({ where: { id: animalId }, data: { speciesId: sp.id } });
      }
      if (input.sex !== undefined && input.sex !== animal.sex) {
        before.sex = animal.sex;
        after.sex = input.sex;
        await tx.animal.update({ where: { id: animalId }, data: { sex: input.sex as Sex } });
      }

      let fromDay: string | null = null;
      if (input.arrival) {
        const a = input.arrival;
        const arr = await tx.lifecycleEvent.findFirst({ where: { animalId, type: "ARRIVAL", status: "VALID" } });
        if (!arr) throw new AppError(409, "NO_ARRIVAL", "Az állatnak nincs érvényes érkezése, amit javítani lehetne.");
        if (arr.version !== a.expectedVersion) throw new AppError(409, "VERSION_CONFLICT", "Az érkezés időközben megváltozott.");
        const data: Record<string, unknown> = {};
        if (a.occurredAtLocal !== undefined) {
          const at = resolveLocalDateTime(a.occurredAtLocal)?.instant;
          if (!at) throw new AppError(422, "INVALID_TIME", "Az érkezés időpontja érvénytelen.");
          if (at.getTime() > serverNow.getTime() + 5 * 60_000) throw new AppError(422, "FUTURE_TIME", "Jövőbeli érkezést nem lehet rögzíteni.");
          if (at.getTime() !== arr.occurredAt.getTime()) {
            data.occurredAt = at;
            data.businessDay = dayToDate(businessDayOf(at));
            before.arrivalAt = arr.occurredAt.toISOString();
            after.arrivalAt = at.toISOString();
          }
        }
        if (a.toPoolId !== undefined && a.toPoolId !== arr.toPoolId) {
          if (!(await tx.pool.findUnique({ where: { id: a.toPoolId } }))) throw new AppError(422, "POOL_NOT_FOUND", "A medence nem található.");
          data.toPoolId = a.toPoolId;
          before.arrivalPool = arr.toPoolId;
          after.arrivalPool = a.toPoolId;
        }
        if (a.toGroupId !== undefined && a.toGroupId !== arr.toGroupId) {
          if (a.toGroupId && !(await tx.animalGroup.findUnique({ where: { id: a.toGroupId } }))) {
            throw new AppError(422, "GROUP_NOT_FOUND", "A csoport nem található.");
          }
          data.toGroupId = a.toGroupId;
          before.arrivalGroup = arr.toGroupId;
          after.arrivalGroup = a.toGroupId;
        }
        if (a.note !== undefined && (a.note || null) !== arr.note) {
          data.note = a.note || null;
          before.arrivalNote = arr.note;
          after.arrivalNote = a.note || null;
        }
        if (Object.keys(data).length) {
          corrects = true;
          const res = await tx.lifecycleEvent.updateMany({
            where: { id: arr.id, version: a.expectedVersion, status: "VALID" },
            data: { ...data, version: { increment: 1 }, updatedById: actor.id, updatedAt: serverNow },
          });
          if (res.count !== 1) throw new AppError(409, "VERSION_CONFLICT", "Az érkezés időközben megváltozott.");
          await rebuildAnimal(tx, animalId);
          await refuseOrphanRows(tx, animalId);
          const newDay = data.businessDay ? dateToDay(data.businessDay as Date) : dateToDay(arr.businessDay);
          const oldDay = dateToDay(arr.businessDay);
          fromDay = newDay < oldDay ? newDay : oldDay;
        }
      }

      if (Object.keys(after).length === 0) throw new AppError(422, "NO_CHANGE", "Nincs változás.");
      await requireReason(tx, corrects, input.reason, "A javítás a múltra is hat (név helyesbítése vagy az érkezés adatai), ezért indoklás kell.");
      // a moved arrival changes which closed, finalized days the animal was alive on: their fasting days follow
      if (fromDay) await recomputeClosedDaysFrom(tx, fromDay, actor.id, input.requestId);
      await writeAudit(tx, {
        userId: actor.id,
        action: corrects ? "MASTER_CORRECTION" : "MASTER_CHANGE",
        entityType: "Animal",
        entityId: animalId,
        changes: diffFields(before, after),
        reason: input.reason ?? null,
        requestId: input.requestId,
      });
      return { replayed: false, changed: Object.keys(after) };
    });
  } catch (e) {
    if (isUniqueViolation(e, "occurredAt") || isUniqueViolation(e, "one_valid_per_instant")) throw new AppError(409, "SAME_INSTANT", SAME_INSTANT);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type AnimalRow = {
  id: string;
  name: string;
  species: string;
  sex: Sex;
  poolId: string | null;
  poolName: string | null;
  /** DAT-03: display only */
  poolEmoji: string | null;
  groupId: string | null;
  groupName: string | null;
  alive: boolean;
  arrived: string | null;
  ended: { type: LifecycleType; day: string } | null;
  /** the admin's position (item 4 of card f67b1a06); null = never placed */
  sortOrder: number | null;
};

/** Every animal as of an instant, alive ones first (EVE-10: the dead stay listed with their end). */
export async function listAnimals(at = new Date()): Promise<AnimalRow[]> {
  const animals = await prisma.animal.findMany({
    include: {
      names: true,
      species: true,
      placements: { include: { pool: { include: { names: true } } } },
      memberships: { include: { group: { include: { names: true } } } },
      events: { where: { status: "VALID" }, orderBy: { occurredAt: "asc" } },
    },
  });
  const rows = animals.map((a) => {
    const p = pickValid(a.placements, at);
    const m = pickValid(a.memberships, at);
    const arrival = a.events.find((e) => e.type === "ARRIVAL");
    const end = a.events.find((e) => TERMINAL.includes(e.type) && e.occurredAt <= at);
    return {
      id: a.id,
      name: pickValid(a.names, at)?.name ?? a.names.at(-1)?.name ?? "?",
      species: a.species.hungarianName ? `${a.species.scientificName} (${a.species.hungarianName})` : a.species.scientificName,
      sex: a.sex,
      poolId: p?.poolId ?? null,
      poolName: p ? pickValid(p.pool.names, at)?.displayName ?? p.pool.code : null,
      poolEmoji: p ? p.pool.emoji : null,
      groupId: m?.groupId ?? null,
      groupName: m ? pickValid(m.group.names, at)?.name ?? "?" : null,
      alive: !!arrival && arrival.occurredAt <= at && !end,
      arrived: arrival ? businessDayOf(arrival.occurredAt) : null,
      ended: end ? { type: end.type, day: businessDayOf(end.occurredAt) } : null,
      sortOrder: a.sortOrder,
    };
  });
  return rows.sort((x, y) => Number(y.alive) - Number(x.alive) || compareAnimals(x, y));
}

// ---------------------------------------------------------------------------
// The admin's order of the animals (Lili 2026-10-26, card f67b1a06, item 4)
// ---------------------------------------------------------------------------

export const animalOrderSchema = z.object({
  requestId: z.string().min(8).max(100),
  /** the animals in the order the admin gave; the ones not listed (dead, just arrived) follow them */
  ids: z.array(z.uuid()).min(1).max(5000),
});
export type AnimalOrderInput = z.input<typeof animalOrderSchema>;

export async function setAnimalOrder(actor: Actor, raw: AnimalOrderInput) {
  const input = animalOrderSchema.parse(raw);
  if (new Set(input.ids).size !== input.ids.length) throw new AppError(422, "ORDER_DUPLICATE", "Egy állat csak egyszer szerepelhet a sorrendben.");
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  if ((await moduleLevel(prisma, actor.id, actor.role, "FEEDING")) !== "ADMIN") {
    throw new AppError(403, "ADMIN_ONLY", "Az állatok sorrendjét csak adminisztrátor állíthatja.");
  }
  return prisma.$transaction(async (tx) => {
    const all = await tx.animal.findMany({ select: { id: true, sortOrder: true, names: { select: { name: true, validTo: true } } } });
    const known = new Set(all.map((a) => a.id));
    const unknown = input.ids.filter((id) => !known.has(id));
    if (unknown.length > 0) throw new AppError(404, "ANIMAL_NOT_FOUND", "Az egyik állat nem található.");
    const nameOf = (a: (typeof all)[number]) => (a.names.find((n) => !n.validTo) ?? a.names.at(-1))?.name ?? "";
    const current = [...all]
      .map((a) => ({ id: a.id, name: nameOf(a), sortOrder: a.sortOrder }))
      .sort(compareAnimals);
    const next = orderAssignments(
      input.ids,
      current.map((a) => a.id),
    );
    const before = new Map(all.map((a) => [a.id, a.sortOrder]));
    const changed = next.filter((n) => before.get(n.id) !== n.sortOrder);
    if (changed.length === 0) throw new AppError(422, "NO_CHANGE", "Nincs változás.");
    for (const n of changed) await tx.animal.update({ where: { id: n.id }, data: { sortOrder: n.sortOrder } });
    const nameById = new Map(current.map((a) => [a.id, a.name]));
    await writeAudit(tx, {
      userId: actor.id,
      action: "MASTER_CHANGE",
      entityType: "AnimalOrder",
      entityId: "all",
      changes: diffFields({ order: current.map((a) => nameById.get(a.id)) }, { order: next.map((n) => nameById.get(n.id)) }),
      requestId: input.requestId,
    });
    return { replayed: false, changed: changed.length };
  });
}

export async function animalEvents(animalId: string) {
  return prisma.lifecycleEvent.findMany({
    where: { animalId },
    include: { toPool: { include: { names: true } }, toGroup: { include: { names: true } } },
    orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
  });
}

export async function listGroupsWithNames(at = new Date()) {
  const groups = await prisma.animalGroup.findMany({ where: { active: true }, include: { names: true } });
  return groups
    .map((g) => ({ id: g.id, name: pickValid(g.names, at)?.name ?? "?" }))
    .sort((a, b) => a.name.localeCompare(b.name, "hu"));
}
