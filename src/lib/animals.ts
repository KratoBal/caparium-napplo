// Animals, groups and their lifecycle (adatmodell 6. és 7. terület; DAT-01, DAT-05, EVE-03, T-09, R-1).
// The lifecycle is a list of dated events (arrival, transfer, group change, death, release). Where an
// animal is and which group it belongs to is DERIVED: on every event change the placements and the
// memberships of that animal are rebuilt from its valid events, in the same transaction, so a later
// date fix or an invalidation can never leave them contradicting the events.
// Permissions (NY-20 default, R-1): an aquarist records today's events; an earlier date is admin
// work with a reason; an arrival (a new animal) is master data, admin only.

import type { LifecycleEvent, LifecycleType, Sex } from "@prisma/client";
import { z } from "zod";
import { diffFields, writeAudit } from "./audit";
import { prisma, type Tx } from "./db";
import { AppError } from "./errors";
import { moduleLevel, pickValid, validAt } from "./master";
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
  reason,
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

function enforce(decision: ReturnType<typeof canCreate>, reasonText: string | undefined) {
  if (decision.kind === "DENY") throw new AppError(403, decision.code, decision.message);
  if (decision.reasonRequired && !reasonText) {
    throw new AppError(422, "REASON_REQUIRED", "Korábbi napra rögzített eseményhez indoklás kell.");
  }
}

export async function createLifecycleEvent(actor: Actor, input: LifecycleInput, serverNow = new Date()) {
  const prior = await prisma.lifecycleEvent.findUnique({ where: { requestId: input.requestId } });
  if (prior) return { eventId: prior.id, animalId: prior.animalId, replayed: true };
  const level = await moduleLevel(prisma, actor.id, actor.role, "FEEDING");
  if (input.type === "ARRIVAL" && level !== "ADMIN") {
    throw new AppError(403, "ADMIN_ONLY", "Új állatot (érkezést) csak adminisztrátor rögzíthet.");
  }
  const clientTs = input.clientTimestamp ? new Date(input.clientTimestamp) : null;
  const eff = effectiveNow(serverNow, clientTs, 30, 48);
  const occurredAt = input.occurredAtLocal ? resolveLocalDateTime(input.occurredAtLocal)?.instant : eff.now;
  if (!occurredAt) throw new AppError(422, "INVALID_TIME", "Az esemény időpontja érvénytelen.");
  if (occurredAt.getTime() > serverNow.getTime() + 5 * 60_000) throw new AppError(422, "FUTURE_TIME", "Jövőbeli eseményt nem lehet rögzíteni.");
  const day = businessDayOf(occurredAt);
  enforce(canCreate(level, { day, today: businessDayOf(eff.now), closed: false }), input.reason);

  return prisma.$transaction(async (tx) => {
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
    } else if (!animalId || !(await tx.animal.findUnique({ where: { id: animalId } }))) {
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
  });
}

export async function invalidateLifecycleEvent(
  actor: Actor,
  id: string,
  input: z.infer<typeof lifecycleInvalidateSchema>,
  serverNow = new Date(),
) {
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId, entityId: id } })) return { replayed: true };
  const level = await moduleLevel(prisma, actor.id, actor.role, "FEEDING");
  return prisma.$transaction(async (tx) => {
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
    const res = await tx.lifecycleEvent.updateMany({
      where: { id, version: input.expectedVersion, status: "VALID" },
      data: { status: "INVALIDATED", invalidationReason: input.reason, version: { increment: 1 }, updatedById: actor.id, updatedAt: serverNow },
    });
    if (res.count !== 1) throw new AppError(409, "VERSION_CONFLICT", "Az esemény időközben megváltozott.");
    await rebuildAnimal(tx, cur.animalId);
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
  if (input.mode === "correction" && !input.reason) throw new AppError(422, "REASON_REQUIRED", "A helyesbítéshez indoklás kell.");
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
// Reads
// ---------------------------------------------------------------------------

export type AnimalRow = {
  id: string;
  name: string;
  species: string;
  sex: Sex;
  poolId: string | null;
  poolName: string | null;
  groupId: string | null;
  groupName: string | null;
  alive: boolean;
  arrived: string | null;
  ended: { type: LifecycleType; day: string } | null;
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
      groupId: m?.groupId ?? null,
      groupName: m ? pickValid(m.group.names, at)?.name ?? "?" : null,
      alive: !!arrival && arrival.occurredAt <= at && !end,
      arrived: arrival ? businessDayOf(arrival.occurredAt) : null,
      ended: end ? { type: end.type, day: businessDayOf(end.occurredAt) } : null,
    };
  });
  return rows.sort((x, y) => Number(y.alive) - Number(x.alive) || x.name.localeCompare(y.name, "hu"));
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
