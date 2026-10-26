// DAT-03 (stage 4): an icon (emoji) for each pool and feed type, set by an admin and shown next to the
// name. Display only: no export carries it, and a missing icon is simply none.

import { z } from "zod";
import { writeAudit } from "./audit";
import { prisma } from "./db";
import { AppError } from "./errors";
import { moduleLevel } from "./master";
import type { Actor } from "./measurements";

// one emoji, possibly with skin tone, variation selector or zero-width joiners; nothing that reads as text
const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️){1,8}$/u;

/** One icon or nothing; shared with the new-pool form, which takes the icon as an optional field. */
export const emojiField = z.string().trim().max(16).refine((v) => v === "" || EMOJI.test(v), "Ide egyetlen ikon (emoji) írható, szöveg nem.");

export const iconSchema = z.object({
  requestId: z.string().min(8).max(100),
  target: z.enum(["pool", "feedType"]),
  id: z.uuid(),
  emoji: emojiField,
});

export async function setIcon(actor: Actor, raw: z.input<typeof iconSchema>) {
  const input = iconSchema.parse(raw);
  if ((await moduleLevel(prisma, actor.id, actor.role, "SETTINGS")) !== "ADMIN") throw new AppError(403, "ADMIN_ONLY", "Az ikonokat adminisztrátor állítja.");
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  const emoji = input.emoji === "" ? null : input.emoji;
  return prisma.$transaction(async (tx) => {
    const before =
      input.target === "pool"
        ? (await tx.pool.findUnique({ where: { id: input.id } }))?.emoji
        : (await tx.feedType.findUnique({ where: { id: input.id } }))?.emoji;
    if (before === undefined) throw new AppError(404, "NOT_FOUND", "Nem található.");
    if (input.target === "pool") await tx.pool.update({ where: { id: input.id }, data: { emoji } });
    else await tx.feedType.update({ where: { id: input.id }, data: { emoji } });
    await writeAudit(tx, {
      userId: actor.id,
      action: "MASTER_CHANGE",
      entityType: input.target === "pool" ? "Pool" : "FeedType",
      entityId: input.id,
      changes: { emoji: { before: before ?? null, after: emoji } },
      requestId: input.requestId,
    });
    return { replayed: false };
  });
}

/** "🦐 Rákok", or the bare name when there is no icon. */
export function withIcon(emoji: string | null | undefined, name: string): string {
  return emoji ? `${emoji} ${name}` : name;
}
