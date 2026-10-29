// The basic data step's feeds by a stable key, not by name (Lili 2026-10-29, package item 14). The feed lists
// (BASE_FEEDS, INITIAL_FEEDS) were looked up by NAME at every container start: the feed list's "Módosítás" renames as
// a CORRECTION, which overwrites the old name, so after "Artemia" -> "Artemia táblás" no feed carried "Artemia" any
// more and the next start created a new one (on the stage: Artemia, Mysis and Krill came back after the evening's
// deploys). Now a list entry, once created or found, is marked (base_data_mark) and never created again.
//
// The step only marks and creates, it never removes: the copies the old lookup made are an admin's operation with a
// dry run (src/lib/feed-copies.ts; barracuda and acrobot on #121: no deletion without a person, at a start).
//   1. a feed corrected away from the entry's name (the MASTER_CORRECTION audit row's before.name) is the entry's feed;
//   2. else a feed that carries or carried the name;
//   3. else the entry's feed is created.
import type { Prisma, PrismaClient } from "@prisma/client";

/** The audit row of a feed's name corrected away from `name`, the first one: the feed the list entry was. */
export async function correctedFrom(prisma: Pick<PrismaClient, "auditEntry">, name: string) {
  const corrections = await prisma.auditEntry.findMany({ where: { entityType: "Feed", action: "MASTER_CORRECTION" }, orderBy: { at: "asc" } });
  return corrections.find((c) => {
    const n = (c.changes as Prisma.JsonObject | null)?.name as Prisma.JsonObject | undefined;
    return n?.before === name;
  });
}

/** The entry's feed: marked, found or created (`create` makes it and returns its id). */
export async function ensureListFeed(prisma: PrismaClient, key: string, name: string, create: () => Promise<string>): Promise<"marked" | "claimed" | "created"> {
  if (await prisma.baseDataMark.findUnique({ where: { key } })) return "marked";
  const mark = (entityId: string) => prisma.baseDataMark.create({ data: { key, entityId } });
  const renamed = await correctedFrom(prisma, name);
  if (renamed) {
    await mark(renamed.entityId);
    return "claimed";
  }
  const named = await prisma.feedName.findFirst({ where: { name }, orderBy: { validFrom: "asc" } });
  if (named) {
    await mark(named.feedId);
    return "claimed";
  }
  await mark(await create());
  return "created";
}
