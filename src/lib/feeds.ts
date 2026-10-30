// The feed list (adatmodell 11. terület; DAT-02, TAK-02, TAK-07, T-08, T-12, T-13).
// A feed belongs to a type, carries the dimensions its quantities may have (darab and gramm are never
// added up, DN-16; the Litopenaeus is counted in both) and a default unit. Names are K3-versioned;
// a feed is never deleted, only made inactive, so an old period's export keeps its columns.

import type { Dimension } from "@prisma/client";
import { z } from "zod";
import { diffFields, writeAudit } from "./audit";
import { prisma } from "./db";
import { AppError } from "./errors";
import { orderAssignments } from "./animal-order";
import { canonicalDecimal } from "./decimal";
import { doseAt, setDose } from "./feed-dose";
import { moduleLevel, pickValid, validAt } from "./master";
import { requireReason } from "./reasons";
import type { Actor } from "./measurements";

const name = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .refine((v) => !/^[=+\-@]/.test(v), "A név nem kezdődhet =, +, -, @ jellel.");

// A dimension once: ["MASS", "MASS"] is no list of dimensions (barracuda on #84)
const dimensionList = z
  .array(z.enum(["MASS", "COUNT", "VOLUME"]))
  .min(1)
  .max(3)
  .refine((d) => new Set(d).size === d.length, "Egy dimenzió csak egyszer szerepelhet.");

// The two choices of the form say what is missing, not "Invalid UUID": an empty select sends an empty
// string, and the raw zod message reached the user (Balázs, 2026-10-19, the stage had no feed type).
export const createFeedSchema = z.object({
  requestId: z.string().min(8).max(100),
  typeId: z.uuid({ error: "Válassz takarmánytípust." }),
  name,
  dimensions: dimensionList,
  defaultUnitId: z.uuid({ error: "Válassz alapértelmezett egységet." }),
});

export const updateFeedSchema = z.object({
  requestId: z.string().min(8).max(100),
  name: name.optional(),
  mode: z.enum(["change", "correction"]).optional(),
  active: z.boolean().optional(),
  // Lili 2026-10-27 22:42 UTC: the default unit and the dimensions too, but only on a feed nothing was recorded with
  dimensions: dimensionList.optional(),
  defaultUnitId: z.uuid({ error: "Válassz alapértelmezett egységet." }).optional(),
  // Lili 2026-10-29 (package item 3): the base amount the feeding sheet's tick records; null ends it
  dose: z.object({ value: z.string().trim().min(1).max(32), unitId: z.uuid({ error: "Válassz egységet az alapmennyiséghez." }) }).nullable().optional(),
  reason: z.string().trim().min(3).max(500).optional(),
});

/**
 * What was recorded with a feed: feeding items, withdrawals and intake, valid or not. Its unit or dimensions change only at
 * zero, because a recorded amount is read in them: "12" taken in grams would turn into 12 pieces.
 */
export async function feedUses(tx: Pick<typeof prisma, "feedingItem" | "withdrawalItem" | "feedIntakeItem">, feedId: string): Promise<number> {
  const [items, withdrawals, intakes] = await Promise.all([
    tx.feedingItem.count({ where: { feedId } }),
    tx.withdrawalItem.count({ where: { feedId } }),
    tx.feedIntakeItem.count({ where: { feedId } }),
  ]);
  return items + withdrawals + intakes;
}

async function requireAdmin(actor: Actor) {
  if ((await moduleLevel(prisma, actor.id, actor.role, "SETTINGS")) !== "ADMIN") {
    throw new AppError(403, "ADMIN_ONLY", "A takarmánylistát csak adminisztrátor módosíthatja.");
  }
}

export async function createFeed(actor: Actor, input: z.infer<typeof createFeedSchema>, now = new Date()) {
  // caparium-hibak-4 (Balázs 2026-10-20 09:34 UTC, msg 1562036209449050256): an aquarist who records feeding may add
  // an "Egyéb" feed to the list; every other type stays the admin's
  const type = await prisma.feedType.findUnique({ where: { id: input.typeId } });
  if (!type) throw new AppError(404, "TYPE_NOT_FOUND", "A takarmánytípus nem található.");
  if (type.code === "EGYEB") {
    const level = await moduleLevel(prisma, actor.id, actor.role, "FEEDING");
    if (level !== "RECORD" && level !== "ADMIN") throw new AppError(403, "READ_ONLY", "Egyéb takarmányt rögzítési joggal lehet felvenni.");
  } else {
    await requireAdmin(actor);
  }
  return prisma.$transaction(async (tx) => {
    const unit = await tx.unit.findUnique({ where: { id: input.defaultUnitId } });
    if (!unit || !input.dimensions.includes(unit.dimension as "MASS" | "COUNT" | "VOLUME")) {
      throw new AppError(422, "UNIT_DIMENSION", "Az alapértelmezett egység a megengedett dimenziók egyike legyen.");
    }
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
  await requireReason(prisma, Boolean(input.name) && input.mode === "correction", input.reason, "A helyesbítés a régi naplókban is átírja a nevet, ezért indoklás kell.");
  return prisma.$transaction(async (tx) => {
    // the feed's row first: an item or withdrawal being saved holds it FOR SHARE (feeding.ts, withdrawal.ts), so the
    // use count below cannot miss one that commits meanwhile (barracuda on #84). NO KEY: an insert's foreign-key
    // check on the feed is not held up by it
    await tx.$queryRaw`SELECT "id" FROM "feed" WHERE "id" = ${id}::uuid FOR NO KEY UPDATE`;
    const f = await tx.feed.findUnique({ where: { id } });
    if (!f) throw new AppError(404, "NOT_FOUND", "A takarmány nem található.");
    const before: Record<string, unknown> = { active: f.active };
    const after: Record<string, unknown> = { active: f.active };
    // the dimensions after this change: the base amount is checked against these, not the ones read above
    // (barracuda on #113: a PATCH may change both, and a stale check would let a tick fail T-08 later)
    let dimensionsNow = f.allowedDimensions as Dimension[];
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
    if (input.dimensions !== undefined || input.defaultUnitId !== undefined) {
      const dimensions = (input.dimensions ?? f.allowedDimensions) as Dimension[];
      const unit = await tx.unit.findUnique({ where: { id: input.defaultUnitId ?? f.defaultUnitId } });
      if (!unit || !dimensions.includes(unit.dimension as Dimension)) {
        throw new AppError(422, "UNIT_DIMENSION", "Az alapértelmezett egység a megengedett dimenziók egyike legyen.");
      }
      const same = unit.id === f.defaultUnitId && [...dimensions].sort().join() === [...f.allowedDimensions].sort().join();
      if (!same) {
        const uses = await feedUses(tx, id);
        if (uses > 0) {
          throw new AppError(409, "FEED_IN_USE", `A mértékegység csak olyan takarmánynál változtatható, amire még nincs tétel; erre ${uses} van.`);
        }
        const old = await tx.unit.findUnique({ where: { id: f.defaultUnitId } });
        before.defaultUnit = old?.symbol ?? null;
        before.dimensions = f.allowedDimensions;
        after.defaultUnit = unit.symbol;
        after.dimensions = dimensions;
        await tx.feed.update({ where: { id }, data: { defaultUnitId: unit.id, allowedDimensions: dimensions } });
        dimensionsNow = dimensions;
      }
    }
    if (input.dose !== undefined) {
      const d = await setDose(tx, { id, allowedDimensions: dimensionsNow }, input.dose, now);
      if (d) {
        before.dose = d.before;
        after.dose = d.after;
      }
    }
    // a base amount left open in a dimension the feed no longer has would make every tick fail T-08 at the aquarist:
    // refused, the admin changes or ends it in the same step (barracuda on #113)
    if (input.dose === undefined && dimensionsNow !== f.allowedDimensions) {
      const open = await doseAt(tx, id, now);
      const openUnit = open ? await tx.unit.findUnique({ where: { id: open.unitId } }) : null;
      if (openUnit && !dimensionsNow.includes(openUnit.dimension)) {
        throw new AppError(422, "DOSE_UNIT", `Az alapmennyiség (${open!.value} ${open!.symbol}) egysége nem marad a takarmány dimenziói között: módosítsd vagy töröld vele együtt.`);
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
  const doses = new Map(
    (await prisma.coralFeedDose.findMany({ where: validAt(at), include: { unit: true } })).map((d) => [d.feedId, { value: canonicalDecimal(d.dose), unitId: d.unitId, symbol: d.unit.symbol }]),
  );
  const types = await prisma.feedType.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      feeds: {
        orderBy: { sortOrder: "asc" },
        include: { names: true, defaultUnit: true, _count: { select: { items: true, withdrawals: true, intakes: true } } },
      },
    },
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
      defaultUnitId: f.defaultUnitId,
      /** recorded items, withdrawals and intake: the unit stays while this is not 0 */
      uses: f._count.items + f._count.withdrawals + f._count.intakes,
      active: f.active,
      temporary: f.temporary,
      sheetTick: f.sheetTick,
      /** the base amount the tick records (package item 3), or null */
      dose: doses.get(f.id) ?? null,
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

// ---------------------------------------------------------------------------
// The admin's order of the feeds inside a type (Lili 2026-10-28 13:22 UTC, acrobot 37529)
// ---------------------------------------------------------------------------

export const feedOrderSchema = z.object({
  requestId: z.string().min(8).max(100),
  typeId: z.uuid(),
  /** the type's feeds in the order the admin gave; the ones not listed follow them in their old order */
  ids: z.array(z.uuid()).min(1).max(1000),
});
export type FeedOrderInput = z.input<typeof feedOrderSchema>;

/** The animals' rule (lib/animals setAnimalOrder) for one feed type: the admin only, one audit row, no gaps. */
export async function setFeedOrder(actor: Actor, raw: FeedOrderInput) {
  const input = feedOrderSchema.parse(raw);
  if (new Set(input.ids).size !== input.ids.length) throw new AppError(422, "ORDER_DUPLICATE", "Egy takarmány csak egyszer szerepelhet a sorrendben.");
  if (await prisma.auditEntry.findFirst({ where: { requestId: input.requestId } })) return { replayed: true };
  if ((await moduleLevel(prisma, actor.id, actor.role, "FEEDING")) !== "ADMIN") {
    throw new AppError(403, "ADMIN_ONLY", "A takarmányok sorrendjét csak adminisztrátor állíthatja.");
  }
  return prisma.$transaction(async (tx) => {
    const type = await tx.feedType.findUnique({ where: { id: input.typeId }, select: { id: true, name: true } });
    if (!type) throw new AppError(404, "FEED_TYPE_NOT_FOUND", "A takarmánytípus nem található.");
    const feeds = await tx.feed.findMany({ where: { typeId: type.id }, select: { id: true, sortOrder: true, names: true } });
    const known = new Set(feeds.map((x) => x.id));
    // a feed of another type cannot be ordered here: each type has its own order
    if (input.ids.some((id) => !known.has(id))) throw new AppError(404, "FEED_NOT_FOUND", "Az egyik takarmány nem ebbe a típusba tartozik, vagy nem található.");
    const nameOf = (x: (typeof feeds)[number]) => pickValid(x.names, new Date())?.name ?? x.names.at(-1)?.name ?? "?";
    const current = [...feeds].sort((a, b) => a.sortOrder - b.sortOrder || nameOf(a).localeCompare(nameOf(b), "hu"));
    const next = orderAssignments(
      input.ids,
      current.map((x) => x.id),
    );
    const before = new Map(feeds.map((x) => [x.id, x.sortOrder]));
    const changed = next.filter((n) => before.get(n.id) !== n.sortOrder);
    if (changed.length === 0) throw new AppError(422, "NO_CHANGE", "Nincs változás.");
    for (const n of changed) await tx.feed.update({ where: { id: n.id }, data: { sortOrder: n.sortOrder } });
    const nameById = new Map(feeds.map((x) => [x.id, nameOf(x)]));
    await writeAudit(tx, {
      userId: actor.id,
      action: "MASTER_CHANGE",
      entityType: "FeedOrder",
      entityId: type.id,
      changes: diffFields({ order: current.map((x) => nameById.get(x.id)) }, { order: next.map((n) => nameById.get(n.id)) }),
      requestId: input.requestId,
    });
    return { replayed: false, changed: changed.length };
  });
}
