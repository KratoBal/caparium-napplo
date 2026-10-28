// The feeding sheet's row colour of an animal or a group (sheet-color-palette.ts), set by a SETTINGS admin; audited
// as a master change like the icons.

import { z } from "zod";
import { writeAudit } from "./audit";
import { prisma } from "./db";
import { AppError } from "./errors";
import { moduleLevel } from "./master";
import type { Actor } from "./measurements";
import { SHEET_COLOR_KEYS } from "./sheet-color-palette";

export const sheetColorSchema = z.object({
  requestId: z.string().min(8).max(100),
  target: z.enum(["animal", "group"]),
  id: z.uuid(),
  /** "" = no colour */
  color: z.union([z.enum(SHEET_COLOR_KEYS), z.literal("")]),
});

export async function setSheetColor(actor: Actor, raw: z.input<typeof sheetColorSchema>) {
  const input = sheetColorSchema.parse(raw);
  if ((await moduleLevel(prisma, actor.id, actor.role, "SETTINGS")) !== "ADMIN") throw new AppError(403, "ADMIN_ONLY", "A sorszínt adminisztrátor állítja.");
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  const sheetColor = input.color === "" ? null : input.color;
  return prisma.$transaction(async (tx) => {
    const before =
      input.target === "animal"
        ? (await tx.animal.findUnique({ where: { id: input.id } }))?.sheetColor
        : (await tx.animalGroup.findUnique({ where: { id: input.id } }))?.sheetColor;
    if (before === undefined) throw new AppError(404, "NOT_FOUND", "Nem található.");
    if (input.target === "animal") await tx.animal.update({ where: { id: input.id }, data: { sheetColor } });
    else await tx.animalGroup.update({ where: { id: input.id }, data: { sheetColor } });
    await writeAudit(tx, {
      userId: actor.id,
      action: "MASTER_CHANGE",
      entityType: input.target === "animal" ? "Animal" : "AnimalGroup",
      entityId: input.id,
      changes: { sheetColor: { before: before ?? null, after: sheetColor } },
      requestId: input.requestId,
    });
    return { replayed: false };
  });
}
