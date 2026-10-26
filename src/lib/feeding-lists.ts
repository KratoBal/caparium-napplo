// NAMED FEEDING LISTS (Lili 2026-10-26, Caparium channel msg 1564356412946124921, item 1; Balázs "Mehet" 1564357004217159823):
// an admin composes a list under a name ("Puhatestű nap": animals and feeds) with checkboxes; a user picks it in the feeding
// page's header and it ticks the list's animals on the day's list and adds its feeds to the day's feeds. Afterwards the user
// adds or removes as usual. A template, not a fact (V-15): it only ADDS, like "Lista a terv szerint" (the weekly timetable),
// which stays beside it; removing stays a person's step. The day's permissions are setSelection's and setDayFeeds'.

import { z } from "zod";
import { diffFields, writeAudit } from "./audit";
import { prisma } from "./db";
import { AppError, isUniqueViolation } from "./errors";
import { dayFeedsSchema, setDayFeeds } from "./feeding";
import { addAnimalsToDay } from "./feeding-plan";
import { moduleLevel } from "./master";
import type { Actor } from "./measurements";
import { dayToDate } from "./time";

const requestId = z.string().min(8).max(100);
const members = {
  animalIds: z.array(z.uuid()).max(300).transform((ids) => [...new Set(ids)]),
  feedIds: z.array(z.uuid()).max(100).transform((ids) => [...new Set(ids)]),
};
const name = z.string().trim().min(2, "A lista neve legalább 2 karakter legyen.").max(60);
const needMembers = (v: { animalIds: string[]; feedIds: string[] }) => v.animalIds.length + v.feedIds.length > 0;
const NEED_MEMBERS = "Legalább egy állatot vagy takarmányt jelölj ki a listába.";

export const createListSchema = z.object({ requestId, name, ...members }).refine(needMembers, { message: NEED_MEMBERS });
export const updateListSchema = z.object({ requestId, listId: z.uuid(), name, ...members }).refine(needMembers, { message: NEED_MEMBERS });
export const archiveListSchema = z.object({ requestId, listId: z.uuid() });
export const applyListSchema = z.object({
  requestId,
  clientTimestamp: z.iso.datetime({ offset: true }).optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  listId: z.uuid(),
  reason: z.string().trim().min(3).max(500).optional(),
});

async function requireListAdmin(actor: Actor) {
  if ((await moduleLevel(prisma, actor.id, actor.role, "FEEDING")) !== "ADMIN") {
    throw new AppError(403, "ADMIN_ONLY", "A névvel ellátott listákat adminisztrátor állítja össze.");
  }
}

const replayed = async (id: string) => (await prisma.auditEntry.findFirst({ where: { requestId: id } })) !== null;

export type FeedingListView = { id: string; name: string; animalIds: string[]; feedIds: string[] };

/** The active lists, by name, with their members. */
export async function activeFeedingLists(): Promise<FeedingListView[]> {
  const lists = await prisma.feedingList.findMany({ where: { active: true }, include: { animals: true, feeds: true } });
  return lists
    .map((l) => ({ id: l.id, name: l.name, animalIds: l.animals.map((a) => a.animalId), feedIds: l.feeds.map((f) => f.feedId) }))
    .sort((a, b) => a.name.localeCompare(b.name, "hu"));
}

async function checkMembers(tx: Pick<typeof prisma, "animal" | "feed">, animalIds: string[], feedIds: string[]) {
  const animals = await tx.animal.count({ where: { id: { in: animalIds } } });
  if (animals !== animalIds.length) throw new AppError(422, "ANIMAL_NOT_FOUND", "Ismeretlen állat a listában.");
  const feeds = await tx.feed.count({ where: { id: { in: feedIds }, active: true } });
  if (feeds !== feedIds.length) throw new AppError(422, "FEED_NOT_FOUND", "Ismeretlen vagy inaktív takarmány a listában.");
}

const nameTaken = (e: unknown) => isUniqueViolation(e) && new AppError(409, "NAME_TAKEN", "Ilyen nevű lista már van.");

export async function createFeedingList(actor: Actor, raw: z.input<typeof createListSchema>) {
  const input = createListSchema.parse(raw);
  await requireListAdmin(actor);
  if (await replayed(input.requestId)) return { replayed: true };
  try {
    return await prisma.$transaction(async (tx) => {
      await checkMembers(tx, input.animalIds, input.feedIds);
      const list = await tx.feedingList.create({
        data: {
          name: input.name,
          createdById: actor.id,
          animals: { create: input.animalIds.map((animalId) => ({ animalId })) },
          feeds: { create: input.feedIds.map((feedId) => ({ feedId })) },
        },
      });
      await writeAudit(tx, {
        userId: actor.id,
        action: "MASTER_CHANGE",
        entityType: "FeedingList",
        entityId: list.id,
        changes: diffFields(null, { name: input.name, animals: input.animalIds.length, feeds: input.feedIds.length }),
        requestId: input.requestId,
      });
      return { replayed: false, id: list.id };
    });
  } catch (e) {
    throw nameTaken(e) || e;
  }
}

/** The list's name and members are replaced by the given ones. */
export async function updateFeedingList(actor: Actor, raw: z.input<typeof updateListSchema>) {
  const input = updateListSchema.parse(raw);
  await requireListAdmin(actor);
  if (await replayed(input.requestId)) return { replayed: true };
  try {
    return await prisma.$transaction(async (tx) => {
      const list = await tx.feedingList.findFirst({ where: { id: input.listId, active: true }, include: { animals: true, feeds: true } });
      if (!list) throw new AppError(404, "LIST_NOT_FOUND", "A lista nem található.");
      await checkMembers(tx, input.animalIds, input.feedIds);
      await tx.feedingList.update({ where: { id: list.id }, data: { name: input.name } });
      await tx.feedingListAnimal.deleteMany({ where: { listId: list.id } });
      await tx.feedingListFeed.deleteMany({ where: { listId: list.id } });
      await tx.feedingListAnimal.createMany({ data: input.animalIds.map((animalId) => ({ listId: list.id, animalId })) });
      await tx.feedingListFeed.createMany({ data: input.feedIds.map((feedId) => ({ listId: list.id, feedId })) });
      await writeAudit(tx, {
        userId: actor.id,
        action: "MASTER_CHANGE",
        entityType: "FeedingList",
        entityId: list.id,
        changes: diffFields(
          { name: list.name, animals: list.animals.map((a) => a.animalId).sort(), feeds: list.feeds.map((f) => f.feedId).sort() },
          { name: input.name, animals: [...input.animalIds].sort(), feeds: [...input.feedIds].sort() },
        ),
        requestId: input.requestId,
      });
      return { replayed: false };
    });
  } catch (e) {
    throw nameTaken(e) || e;
  }
}

/** Archived, never deleted: the list leaves the dropdown, its name is free again. */
export async function archiveFeedingList(actor: Actor, raw: z.input<typeof archiveListSchema>) {
  const input = archiveListSchema.parse(raw);
  await requireListAdmin(actor);
  if (await replayed(input.requestId)) return { replayed: true };
  return prisma.$transaction(async (tx) => {
    const list = await tx.feedingList.findFirst({ where: { id: input.listId, active: true } });
    if (!list) throw new AppError(404, "LIST_NOT_FOUND", "A lista nem található.");
    await tx.feedingList.update({ where: { id: list.id }, data: { active: false } });
    await writeAudit(tx, {
      userId: actor.id,
      action: "MASTER_CHANGE",
      entityType: "FeedingList",
      entityId: list.id,
      changes: { active: { before: true, after: false } },
      requestId: input.requestId,
    });
    return { replayed: false };
  });
}

/**
 * Picks a list for a day: its animals (alive that day, not on the list yet, no manual fasting day) are ticked, and its
 * active feeds are added to the day's feeds. It only adds: nothing on the day is taken off, and a day with no feeds chosen
 * (every feed offered) is narrowed to the list's feeds only when the list has feeds.
 */
export async function applyFeedingList(actor: Actor, raw: z.input<typeof applyListSchema>, serverNow = new Date()) {
  const input = applyListSchema.parse(raw);
  const list = await prisma.feedingList.findFirst({ where: { id: input.listId, active: true }, include: { animals: true, feeds: { include: { feed: true } } } });
  if (!list) throw new AppError(404, "LIST_NOT_FOUND", "A lista nem található.");
  const animalIds = list.animals.map((a) => a.animalId);
  const feedIds = list.feeds.filter((f) => f.feed.active).map((f) => f.feedId);
  const base = { clientTimestamp: input.clientTimestamp, day: input.day, reason: input.reason };
  const animals = animalIds.length
    ? await addAnimalsToDay(actor, { requestId: input.requestId, ...base }, animalIds, serverNow)
    : { replayed: false, added: 0, skipped: [] as string[] };
  let feedsAdded = 0;
  if (feedIds.length) {
    const fd = await prisma.feedingDay.findUnique({ where: { businessDay: dayToDate(input.day) } });
    const current = fd?.feedIds ?? [];
    const next = [...new Set([...current, ...feedIds])];
    feedsAdded = next.length - current.length;
    if (feedsAdded > 0) {
      const body = dayFeedsSchema.parse({ requestId: `${input.requestId}:feeds`, ...base, feedIds: next });
      await setDayFeeds(actor, body, serverNow);
    }
  }
  return { replayed: animals.replayed, name: list.name, added: animals.added, skipped: animals.skipped, feedsAdded };
}
