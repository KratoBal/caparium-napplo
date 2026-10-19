// JAV-08 (stage 4): the feeding and fasting plan of an animal, to prefill the day's list. The plan is
// not the fact (V-15): it only selects animals on the list, which stays common and editable (R-7), and a
// fasting day still comes only from the finalized list at the close. D-34: the plan is per animal.

import { z } from "zod";
import { writeAudit } from "./audit";
import { prisma } from "./db";
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

/** Sets an animal's plan from now on (a new version; the old one stays for the record). */
export async function setFeedingPlan(actor: Actor, raw: z.input<typeof planSchema>, serverNow = new Date()) {
  const input = planSchema.parse(raw);
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  const level = await moduleLevel(prisma, actor.id, actor.role, "FEEDING");
  if (level === "NONE" || level === "READ") throw new AppError(403, "READ_ONLY", "A tervet rögzítési joggal lehet módosítani.");
  const weekdays = [...new Set(input.weekdays)].sort();
  return prisma.$transaction(async (tx) => {
    // the animal's row first, so two saves cannot both leave an open plan (as the reference, #14)
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "animal" WHERE "id" = ${input.animalId}::uuid FOR NO KEY UPDATE`;
    if (rows.length !== 1) throw new AppError(404, "ANIMAL_NOT_FOUND", "Az állat nem található.");
    const open = await tx.feedingPlan.findFirst({ where: { animalId: input.animalId, validTo: null } });
    if (open && open.weekdays.join(",") === weekdays.join(",")) return { replayed: false, changed: false };
    if (open) await tx.feedingPlan.update({ where: { id: open.id }, data: { validTo: serverNow } });
    const plan = await tx.feedingPlan.create({ data: { animalId: input.animalId, weekdays, validFrom: serverNow, createdById: actor.id } });
    await writeAudit(tx, {
      userId: actor.id,
      action: "UPDATE",
      entityType: "FeedingPlan",
      entityId: plan.id,
      changes: { weekdays: { before: open?.weekdays ?? null, after: weekdays } },
      requestId: input.requestId,
    });
    return { replayed: false, changed: true };
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
  const alive = await aliveOnDay(prisma, input.day, planned);
  const fd = await prisma.$transaction((tx) => ensureFeedingDay(tx, input.day));
  const already = await selectedOn(prisma, fd.fd.id);
  const candidates = planned.filter((id) => alive.has(id) && !already.has(id));
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

async function animalNames(ids: string[], at: Date): Promise<string[]> {
  if (ids.length === 0) return [];
  const animals = await prisma.animal.findMany({ where: { id: { in: ids } }, include: { names: true } });
  return animals.map((a) => pickValid(a.names, at)?.name ?? a.names.at(-1)?.name ?? "?").sort((a, b) => a.localeCompare(b, "hu"));
}
