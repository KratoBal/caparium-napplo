// The basic data step's feeds by a stable key, not by name (Lili 2026-10-29, package item 14). The feed lists
// (BASE_FEEDS, INITIAL_FEEDS) were looked up by NAME at every container start: the feed list's "Módosítás" renames as
// a CORRECTION, which overwrites the old name, so after "Artemia" -> "Artemia táblás" no feed carried "Artemia" any
// more and the next start created a new one (on the stage: Artemia, Mysis and Krill came back after the evening's
// deploys). Now a list entry, once created or found, is marked (base_data_mark) and never created again.
//
// The first start with this code claims what is there, and repairs what the old lookup did:
//   1. a feed corrected away from the entry's name (the MASTER_CORRECTION audit row's before.name) is the entry's
//      feed; the copies the old lookup made after that correction (same name, another feed, created later) go: deleted
//      when nothing refers to them, made inactive when something does, each with an audit row; nothing recorded is lost;
//   2. else a feed that carries or carried the name is the entry's feed;
//   3. else the entry's feed is created.
import type { Prisma, PrismaClient } from "@prisma/client";
import { SYSTEM_USER_ID } from "./db";

/** Anything that refers to the feed: an item, a withdrawal, a named list, a base amount, a day's chosen feeds. */
async function feedInUse(prisma: PrismaClient, feedId: string): Promise<boolean> {
  const [items, withdrawals, lists, doses, days] = await Promise.all([
    prisma.feedingItem.count({ where: { feedId } }),
    prisma.withdrawalItem.count({ where: { feedId } }),
    prisma.feedingListFeed.count({ where: { feedId } }),
    prisma.coralFeedDose.count({ where: { feedId } }),
    // feeding_day.feedIds has no foreign key: a deleted feed would leave its id behind there
    prisma.feedingDay.count({ where: { feedIds: { has: feedId } } }),
  ]);
  return items + withdrawals + lists + doses + days > 0;
}

/** The entry's feed: marked, found, repaired or created (`create` makes it and returns its id). */
export async function ensureListFeed(prisma: PrismaClient, key: string, name: string, create: () => Promise<string>): Promise<"marked" | "claimed" | "repaired" | "created"> {
  if (await prisma.baseDataMark.findUnique({ where: { key } })) return "marked";
  const mark = (entityId: string) => prisma.baseDataMark.create({ data: { key, entityId } });

  const corrections = await prisma.auditEntry.findMany({ where: { entityType: "Feed", action: "MASTER_CORRECTION" }, orderBy: { at: "asc" } });
  const renamed = corrections.find((c) => (c.changes as Prisma.JsonObject | null)?.name && ((c.changes as Prisma.JsonObject).name as Prisma.JsonObject).before === name);
  if (renamed) {
    const copies = await prisma.feed.findMany({ where: { id: { not: renamed.entityId }, createdAt: { gt: renamed.at }, names: { some: { name } } } });
    for (const copy of copies) {
      const used = await feedInUse(prisma, copy.id);
      await prisma.$transaction(async (tx) => {
        if (used) await tx.feed.update({ where: { id: copy.id }, data: { active: false } });
        else {
          await tx.feedName.deleteMany({ where: { feedId: copy.id } });
          await tx.feed.delete({ where: { id: copy.id } });
        }
        await tx.auditEntry.create({
          data: {
            userId: SYSTEM_USER_ID,
            action: "MASTER_CHANGE",
            entityType: "Feed",
            entityId: copy.id,
            changes: used ? { active: { before: copy.active, after: false } } : { removed: { before: name, after: null } },
            reason: `Az alapadat-betöltés másodpéldánya (${name}): a takarmányt korábban átnevezték, és a régi, név szerinti betöltés újra létrehozta.`,
          },
        });
      });
    }
    await mark(renamed.entityId);
    return "repaired";
  }
  const named = await prisma.feedName.findFirst({ where: { name }, orderBy: { validFrom: "asc" } });
  if (named) {
    await mark(named.feedId);
    return "claimed";
  }
  await mark(await create());
  return "created";
}
