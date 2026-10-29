// The copies the old basic data lookup made (Lili 2026-10-29, package item 14), removed by an admin with a dry run,
// as the feeding day's restore (barracuda and acrobot on #121: never at a start, without a person). A copy is a feed
//   - with the name of a basic data list entry (BASE_FEEDS, INITIAL_FEEDS) that a correction took away from the
//     entry's feed (the MASTER_CORRECTION audit row),
//   - another feed than that one, created after the correction,
//   - never in a person's hands: no Feed audit row by anyone but the System user. An admin who added the same name on
//     purpose (createFeed writes one), or changed the copy since, keeps it (barracuda, 1a).
// The run makes every copy INACTIVE, it deletes nothing: a feed is never deleted, only made inactive (DAT-02, the feed
// list), and the app's database role has no DELETE on the feed tables (measured: 42501 on feed_name); a delete would
// be a permission change, not this fix. A copy that cannot be changed is reported and the run goes on (1c).
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { BASE_FEEDS } from "./base-data";
import { correctedFrom } from "./base-feed-marks";
import { prisma, SYSTEM_USER_ID } from "./db";
import { AppError } from "./errors";
import { INITIAL_FEEDS } from "./initial-data";
import { moduleLevel, pickValid } from "./master";
import type { Actor } from "./measurements";
import { requireReason } from "./reasons";

export type FeedUses = { items: number; withdrawals: number; lists: number; doses: number; days: number };
export type FeedCopy = { id: string; name: string; createdAt: string; originalId: string; originalName: string; uses: FeedUses };

async function usesOf(feedId: string): Promise<FeedUses> {
  const [items, withdrawals, lists, doses, days] = await Promise.all([
    prisma.feedingItem.count({ where: { feedId } }),
    prisma.withdrawalItem.count({ where: { feedId } }),
    prisma.feedingListFeed.count({ where: { feedId } }),
    prisma.coralFeedDose.count({ where: { feedId } }),
    // feeding_day.feedIds has no foreign key: a deleted feed would leave its id behind there
    prisma.feedingDay.count({ where: { feedIds: { has: feedId } } }),
  ]);
  return { items, withdrawals, lists, doses, days };
}

/** The copies as they are now, each with what refers to it. Reads only. */
export async function feedCopyCandidates(now = new Date()): Promise<FeedCopy[]> {
  const names = [...new Set([...BASE_FEEDS.map((f) => f.name), ...INITIAL_FEEDS.map((f) => f.name)])];
  const out: FeedCopy[] = [];
  for (const name of names) {
    const corr = await correctedFrom(prisma, name);
    if (!corr) continue;
    const original = await prisma.feed.findUnique({ where: { id: corr.entityId }, include: { names: true } });
    const copies = await prisma.feed.findMany({ where: { id: { not: corr.entityId }, createdAt: { gt: corr.at }, names: { some: { name } } }, orderBy: { createdAt: "asc" } });
    for (const c of copies) {
      if (await prisma.auditEntry.count({ where: { entityType: "Feed", entityId: c.id, userId: { not: SYSTEM_USER_ID } } })) continue;
      out.push({
        id: c.id,
        name,
        createdAt: c.createdAt.toISOString(),
        originalId: corr.entityId,
        originalName: (original && pickValid(original.names, now)?.name) ?? original?.names.at(-1)?.name ?? "?",
        uses: await usesOf(c.id),
      });
    }
  }
  return out;
}

export const feedCopiesSchema = z.object({
  requestId: z.string().min(8).max(100),
  mode: z.enum(["plan", "run"]),
  reason: z.string().trim().min(3, "Az indoklás legalább 3 karakter legyen.").max(500).optional(),
});

export type CopyOutcome = { id: string; name: string; outcome: "inactivated" | "failed"; error?: string };

export async function feedCopies(actor: Actor, raw: z.input<typeof feedCopiesSchema>, now = new Date()) {
  const input = feedCopiesSchema.parse(raw);
  if ((await moduleLevel(prisma, actor.id, actor.role, "SETTINGS")) !== "ADMIN") {
    throw new AppError(403, "ADMIN_ONLY", "A takarmánylistát csak adminisztrátor módosíthatja.");
  }
  if (input.mode === "plan") return { copies: await feedCopyCandidates(now) };
  await requireReason(prisma, true, input.reason, "Az eltávolításhoz indoklás kell.");
  if (await prisma.auditEntry.findFirst({ where: { requestId: { startsWith: input.requestId } } })) return { replayed: true };
  // planned again: what the admin saw may have moved meanwhile, the run follows the list as it is
  const copies = await feedCopyCandidates(now);
  if (!copies.length) throw new AppError(422, "NO_CHANGE", "Nincs alapadat-másodpéldány.");
  const why = (name: string) =>
    `alapadat-másodpéldány (${name}): a takarmányt korábban átnevezték, és a régi, név szerinti betöltés újra létrehozta${input.reason ? `; ${input.reason}` : ""}`;
  const results: CopyOutcome[] = [];
  for (const [n, c] of copies.entries()) {
    try {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.feed.update({ where: { id: c.id }, data: { active: false } });
        await tx.auditEntry.create({
          data: { userId: actor.id, action: "MASTER_CHANGE", entityType: "Feed", entityId: c.id, changes: { active: { before: true, after: false } }, reason: why(c.name), requestId: `${input.requestId}:${n}` },
        });
      });
      results.push({ id: c.id, name: c.name, outcome: "inactivated" });
    } catch (e) {
      // one copy never stops the rest; the answer names it
      results.push({ id: c.id, name: c.name, outcome: "failed", error: e instanceof Error ? e.message.split("\n").at(-1) ?? e.message : String(e) });
    }
  }
  return { results };
}
