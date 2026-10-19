// The feed list (adatmodell 11. terület; DAT-02, TAK-02, TAK-07, T-08, T-12, T-13).
// A feed belongs to a type, carries the dimensions its quantities may have (darab and gramm are never
// added up, DN-16; the Litopenaeus is counted in both) and a default unit. Names are K3-versioned;
// a feed is never deleted, only made inactive, so an old period's export keeps its columns.

import type { Dimension } from "@prisma/client";
import { z } from "zod";
import { diffFields, writeAudit } from "./audit";
import { prisma } from "./db";
import { AppError } from "./errors";
import { moduleLevel, pickValid, validAt } from "./master";
import type { Actor } from "./measurements";

const name = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .refine((v) => !/^[=+\-@]/.test(v), "A név nem kezdődhet =, +, -, @ jellel.");

// The two choices of the form say what is missing, not "Invalid UUID": an empty select sends an empty
// string, and the raw zod message reached the user (Balázs, 2026-10-19, the stage had no feed type).
export const createFeedSchema = z.object({
  requestId: z.string().min(8).max(100),
  typeId: z.uuid({ error: "Válassz takarmánytípust." }),
  name,
  dimensions: z.array(z.enum(["MASS", "COUNT", "VOLUME"])).min(1).max(3),
  defaultUnitId: z.uuid({ error: "Válassz alapértelmezett egységet." }),
});

export const updateFeedSchema = z.object({
  requestId: z.string().min(8).max(100),
  name: name.optional(),
  mode: z.enum(["change", "correction"]).optional(),
  active: z.boolean().optional(),
  reason: z.string().trim().min(3).max(500).optional(),
});

async function requireAdmin(actor: Actor) {
  if ((await moduleLevel(prisma, actor.id, actor.role, "SETTINGS")) !== "ADMIN") {
    throw new AppError(403, "ADMIN_ONLY", "A takarmánylistát csak adminisztrátor módosíthatja.");
  }
}

export async function createFeed(actor: Actor, input: z.infer<typeof createFeedSchema>, now = new Date()) {
  await requireAdmin(actor);
  return prisma.$transaction(async (tx) => {
    const unit = await tx.unit.findUnique({ where: { id: input.defaultUnitId } });
    if (!unit || !input.dimensions.includes(unit.dimension as "MASS" | "COUNT" | "VOLUME")) {
      throw new AppError(422, "UNIT_DIMENSION", "Az alapértelmezett egység a megengedett dimenziók egyike legyen.");
    }
    const type = await tx.feedType.findUnique({ where: { id: input.typeId } });
    if (!type) throw new AppError(404, "TYPE_NOT_FOUND", "A takarmánytípus nem található.");
    const last = await tx.feed.findFirst({ where: { typeId: type.id }, orderBy: { sortOrder: "desc" } });
    const f = await tx.feed.create({
      data: {
        typeId: type.id,
        allowedDimensions: input.dimensions as Dimension[],
        defaultUnitId: unit.id,
        sortOrder: (last?.sortOrder ?? 0) + 1,
        names: { create: { name: input.name, validFrom: now } },
      },
    });
    await writeAudit(tx, {
      userId: actor.id,
      action: "MASTER_CHANGE",
      entityType: "Feed",
      entityId: f.id,
      changes: diffFields(null, { type: type.code, name: input.name, dimensions: input.dimensions, defaultUnit: unit.symbol }),
      requestId: input.requestId,
    });
    return { id: f.id };
  });
}

export async function updateFeed(actor: Actor, id: string, input: z.infer<typeof updateFeedSchema>, now = new Date()) {
  await requireAdmin(actor);
  if (input.name && input.mode === "correction" && !input.reason) {
    throw new AppError(422, "REASON_REQUIRED", "A helyesbítés a régi naplókban is átírja a nevet, ezért indoklás kell.");
  }
  return prisma.$transaction(async (tx) => {
    const f = await tx.feed.findUnique({ where: { id } });
    if (!f) throw new AppError(404, "NOT_FOUND", "A takarmány nem található.");
    const before: Record<string, unknown> = { active: f.active };
    const after: Record<string, unknown> = { active: f.active };
    if (input.name) {
      const cur = await tx.feedName.findFirst({ where: { feedId: id, ...validAt(now) } });
      before.name = cur?.name ?? null;
      after.name = input.name;
      if (cur && input.mode === "correction") await tx.feedName.update({ where: { id: cur.id }, data: { name: input.name } });
      else {
        if (cur) await tx.feedName.update({ where: { id: cur.id }, data: { validTo: now } });
        await tx.feedName.create({ data: { feedId: id, name: input.name, validFrom: now } });
      }
    }
    if (input.active !== undefined && input.active !== f.active) {
      await tx.feed.update({ where: { id }, data: { active: input.active } });
      after.active = input.active;
    }
    const changes = diffFields(before, after);
    if (Object.keys(changes).length === 0) throw new AppError(422, "NO_CHANGE", "Nincs változás.");
    await writeAudit(tx, {
      userId: actor.id,
      action: input.name && input.mode === "correction" ? "MASTER_CORRECTION" : "MASTER_CHANGE",
      entityType: "Feed",
      entityId: id,
      changes,
      reason: input.reason ?? null,
      requestId: input.requestId,
    });
    return { ok: true };
  });
}

export async function listFeeds(at = new Date()) {
  const types = await prisma.feedType.findMany({
    orderBy: { sortOrder: "asc" },
    include: { feeds: { orderBy: { sortOrder: "asc" }, include: { names: true, defaultUnit: true } } },
  });
  return types.map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    emoji: t.emoji,
    feeds: t.feeds.map((f) => ({
      id: f.id,
      name: pickValid(f.names, at)?.name ?? f.names.at(-1)?.name ?? "?",
      dimensions: f.allowedDimensions,
      defaultUnit: f.defaultUnit.symbol,
      active: f.active,
      temporary: f.temporary,
    })),
  }));
}

/**
 * EGY-03 (an idea): the other ("Egyéb") feed names used before, newest first, offered while typing; a
 * suggestion only, any name may still be written.
 */
export async function knownOtherNames(limit = 30): Promise<string[]> {
  const [fed, taken] = await Promise.all([
    prisma.feedingItem.findMany({ where: { status: "VALID", otherName: { not: null } }, select: { otherName: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.withdrawalItem.findMany({ where: { status: "VALID", otherName: { not: null } }, select: { otherName: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 200 }),
  ]);
  const seen = new Map<string, string>();
  for (const r of [...fed, ...taken].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    const key = r.otherName!.toLowerCase();
    if (!seen.has(key)) seen.set(key, r.otherName!);
  }
  return [...seen.values()].slice(0, limit);
}
