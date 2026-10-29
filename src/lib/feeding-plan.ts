// JAV-08 (stage 4): the feeding and fasting plan of an animal, to prefill the day's list. The plan is
// not the fact (V-15): it only selects animals on the list, which stays common and editable (R-7), and a
// fasting day still comes only from the finalized list at the close. D-34: the plan is per animal.

import { z } from "zod";
import { writeAudit } from "./audit";
import { prisma, type Tx } from "./db";
import { AppError } from "./errors";
import { aliveOnDay, selectedOn, setSelection, ensureFeedingDay } from "./feeding";
import { moduleLevel, pickValid } from "./master";
import type { Actor } from "./measurements";
import { dayToDate } from "./time";

const requestId = z.string().min(8).max(100);

export const planSchema = z.object({ requestId, animalId: z.uuid(), weekdays: z.array(z.number().int().min(1).max(7)).max(7) });

/** The ISO weekday of a business day: 1 = Monday .. 7 = Sunday. */
export function weekdayOf(day: string): number {
  const w = dayToDate(day).getUTCDay();
  return w === 0 ? 7 : w;
}

/**
 * THE PLAN IS THE ADMIN'S (Lili 2026-10-26, Caparium channel msg 1564404799359946884: "az Etetési rend szerkesztése egyelőre CSAK
 * adminnak"): the server refuses everyone else (403), the page and the menu entry hide it too. Reading it stays open to everyone: "Lista
 * a terv szerint" (applyPlan) only reads the plan.
 */
async function requirePlanAdmin(actor: Actor) {
  if ((await moduleLevel(prisma, actor.id, actor.role, "FEEDING")) !== "ADMIN") {
    throw new AppError(403, "ADMIN_ONLY", "Az etetési rendet csak adminisztrátor módosíthatja.");
  }
}

/** Sets an animal's plan from now on (a new version; the old one stays for the record). */
export async function setFeedingPlan(actor: Actor, raw: z.input<typeof planSchema>, serverNow = new Date()) {
  const input = planSchema.parse(raw);
  await requirePlanAdmin(actor);
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  return prisma.$transaction(async (tx) => ({ replayed: false, changed: await planInTx(tx, actor, input.animalId, input.weekdays, input.requestId, serverNow) }));
}

/** One animal's new plan version inside a transaction; false when it is the same as the open one. */
async function planInTx(tx: Tx, actor: Actor, animalId: string, days: number[], requestId: string, serverNow: Date): Promise<boolean> {
  const weekdays = [...new Set(days)].sort();
  // the animal's row first, so two saves cannot both leave an open plan (as the reference, #14)
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "animal" WHERE "id" = ${animalId}::uuid FOR NO KEY UPDATE`;
  if (rows.length !== 1) throw new AppError(404, "ANIMAL_NOT_FOUND", "Az állat nem található.");
  const open = await tx.feedingPlan.findFirst({ where: { animalId, validTo: null } });
  if (open && open.weekdays.join(",") === weekdays.join(",")) return false;
  // no plan yet and no day ticked: nothing to record (the overview sends every row it shows)
  if (!open && weekdays.length === 0) return false;
  if (open) await tx.feedingPlan.update({ where: { id: open.id }, data: { validTo: serverNow } });
  const plan = await tx.feedingPlan.create({ data: { animalId, weekdays, validFrom: serverNow, createdById: actor.id } });
  await writeAudit(tx, {
    userId: actor.id,
    action: "UPDATE",
    entityType: "FeedingPlan",
    entityId: plan.id,
    changes: { weekdays: { before: open?.weekdays ?? null, after: weekdays } },
    requestId,
  });
  return true;
}

export const plansSchema = z.object({
  requestId,
  plans: z.array(z.object({ animalId: z.uuid(), weekdays: z.array(z.number().int().min(1).max(7)).max(7) })).min(1).max(500),
});

/**
 * THE FEEDING TIMETABLE (6fe63c9b, item 4; Lili: "az admin létrehoz egy heti órarendet"): every animal's days on
 * one screen, saved together in one transaction. Each changed row is a new plan version, exactly as the single
 * animal's form (setFeedingPlan); an unchanged row writes nothing. The same permission: the admin's.
 */
export async function setFeedingPlans(actor: Actor, raw: z.input<typeof plansSchema>, serverNow = new Date()) {
  const input = plansSchema.parse(raw);
  await requirePlanAdmin(actor);
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true, changed: 0 };
  const ids = input.plans.map((p) => p.animalId);
  if (new Set(ids).size !== ids.length) throw new AppError(422, "DUPLICATE_ANIMAL", "Egy állat egyszer szerepelhet.");
  // a stable lock order: two overlapping saves cannot wait on each other
  const plans = [...input.plans].sort((a, b) => a.animalId.localeCompare(b.animalId));
  return prisma.$transaction(async (tx) => {
    let changed = 0;
    for (const p of plans) if (await planInTx(tx, actor, p.animalId, p.weekdays, input.requestId, serverNow)) changed++;
    return { replayed: false, changed };
  });
}

/** The open plans by animal (for the animals page). */
export async function currentPlans(): Promise<Record<string, number[]>> {
  const plans = await prisma.feedingPlan.findMany({ where: { validTo: null } });
  return Object.fromEntries(plans.map((p) => [p.animalId, p.weekdays]));
}

export const applySchema = z.object({ requestId, clientTimestamp: z.iso.datetime({ offset: true }).optional(), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(3).max(500).optional() });

/**
 * "Lista a terv szerint": selects the animals alive that day whose plan includes its weekday and that
 * are not on the list yet. It only adds; removing stays a person's step (with its R-3 confirmation).
 * The day's permissions are setSelection's.
 */
export async function applyPlan(actor: Actor, raw: z.input<typeof applySchema>, serverNow = new Date()) {
  const input = applySchema.parse(raw);
  const wd = weekdayOf(input.day);
  const plans = await prisma.feedingPlan.findMany({ where: { validTo: null } });
  const planned = plans.filter((p) => p.weekdays.includes(wd)).map((p) => p.animalId);
  return addAnimalsToDay(actor, input, planned, serverNow);
}

/**
 * Puts the given animals on the day's list: the ones alive that day and not on it yet, without a manual fasting day.
 * Shared by the weekly plan ("Lista a terv szerint") and the named lists (src/lib/feeding-lists.ts): both only ADD.
 * The day's permissions are setSelection's.
 */
export async function addAnimalsToDay(
  actor: Actor,
  input: { requestId: string; clientTimestamp?: string | undefined; day: string; reason?: string | undefined },
  animalIds: string[],
  serverNow = new Date(),
) {
  const alive = await aliveOnDay(prisma, input.day, animalIds);
  const fd = await prisma.$transaction((tx) => ensureFeedingDay(tx, input.day));
  const already = await selectedOn(prisma, fd.fd.id);
  const candidates = animalIds.filter((id) => alive.has(id) && !already.has(id));
  // a manual fasting day is a person's decision for that day: the plan does not override it (setSelection
  // would ask for a confirmation and stop the whole list), so those animals are left out and named
  const fasting = await prisma.eatingStatus.findMany({
    where: { feedingDayId: fd.fd.id, animalId: { in: candidates }, status: "VALID", source: "MANUAL", state: "FASTING" },
    select: { animalId: true },
  });
  const fastingIds = new Set(fasting.map((f) => f.animalId));
  const skipped = await animalNames([...fastingIds], dayToDate(input.day));
  const toAdd = candidates.filter((id) => !fastingIds.has(id));
  if (toAdd.length === 0) return { replayed: false, added: 0, skipped };
  const r = await setSelection(actor, { requestId: input.requestId, clientTimestamp: input.clientTimestamp, day: input.day, animalIds: toAdd, selected: true, reason: input.reason }, serverNow);
  return { replayed: r.replayed, added: r.changed, skipped };
}

export async function animalNames(ids: string[], at: Date): Promise<string[]> {
  if (ids.length === 0) return [];
  const animals = await prisma.animal.findMany({ where: { id: { in: ids } }, include: { names: true } });
  return animals.map((a) => pickValid(a.names, at)?.name ?? a.names.at(-1)?.name ?? "?").sort((a, b) => a.localeCompare(b, "hu"));
}
