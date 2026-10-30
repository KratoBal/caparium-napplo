// The admin's switch of the save reminder (card 0d617f0c; src/lib/save-reminder.ts). One setting row per change, audited,
// as the mail recipients (water-mail.ts): the history says who switched it off and when.
import { z } from "zod";
import { writeAudit } from "./audit";
import { prisma, type Tx } from "./db";
import { AppError } from "./errors";
import { getSetting, moduleLevel } from "./master";
import type { Actor } from "./measurements";

export const saveReminderSchema = z.object({ requestId: z.string().min(8).max(100), on: z.boolean() });

/** Whether the helper reminds of an unsaved, filled form now. */
export async function saveReminderOn(tx: Tx, at: Date = new Date()): Promise<boolean> {
  return (await getSetting(tx, "save_reminder", at)) === "true";
}

export async function setSaveReminder(actor: Actor, raw: z.input<typeof saveReminderSchema>, now = new Date()) {
  const input = saveReminderSchema.parse(raw);
  if ((await moduleLevel(prisma, actor.id, actor.role, "SETTINGS")) !== "ADMIN") {
    throw new AppError(403, "ADMIN_ONLY", "A beállításokat csak adminisztrátor módosíthatja.");
  }
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  const value = input.on ? "true" : "false";
  return prisma.$transaction(async (tx) => {
    const before = await getSetting(tx, "save_reminder", now);
    if (before === value) throw new AppError(422, "NO_CHANGE", "Nincs változás.");
    const row = await tx.setting.create({ data: { key: "save_reminder", value, validFrom: now, changedById: actor.id } });
    await writeAudit(tx, {
      userId: actor.id,
      action: "MASTER_CHANGE",
      entityType: "Setting",
      entityId: row.id,
      changes: { save_reminder: { before, after: value } },
      requestId: input.requestId,
    });
    return { replayed: false };
  });
}
