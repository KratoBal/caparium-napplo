// Master data administration (ÁLT-08, ÁLT-09, DAT-04, VIZ-22; adatmodell K3, 1–3. terület).
// K3: a CHANGE closes the current version and opens a new one (the past keeps the old value);
// a CORRECTION fixes the current version in place (it acts on the past too) and needs a reason.
// Every write is audited in the same transaction; a password never enters the audit.

import { z } from "zod";
import { diffFields, writeAudit } from "./audit";
import { hashPassword } from "./auth";
import { prisma, type Tx } from "./db";
import { compareDecimal, parseDecimalInput } from "./decimal";
import { AppError, isUniqueViolation } from "./errors";
import { emojiField } from "./icons";
import { FIRST_NAME_FROM, moduleLevel, validAt } from "./master";
import { requireReason } from "./reasons";
import type { Actor } from "./measurements";

const reason = z.string().trim().min(3, "Az indoklás legalább 3 karakter legyen.").max(500);

/**
 * A name that ends up in the ZIMS CSV or the Excel export must not start with a character a
 * spreadsheet reads as a formula (=, +, -, @, tab, CR): opening the CSV in Excel would run it
 * (review of #3). The ZIMS names must stay letter-exact, so they are refused, not prefixed.
 */
const exportSafe = (s: z.ZodString) =>
  s.refine((v) => !/^[=+\-@\t\r]/.test(v), "A név nem kezdődhet =, +, -, @ jellel (táblázatkezelőben képletként futna).");
const requestId = z.string().min(8).max(100);

async function requireSettingsAdmin(actor: Actor) {
  const level = await moduleLevel(prisma, actor.id, actor.role, "SETTINGS");
  if (level !== "ADMIN") throw new AppError(403, "ADMIN_ONLY", "A beállításokat csak adminisztrátor módosíthatja.");
}

/**
 * User management is for the ADMIN ROLE only, not for a module level (review of #2): an aquarist
 * with a SETTINGS=ADMIN override for the reference values must not be able to promote anyone,
 * create an admin, or set someone else's password and log in as them.
 */
function requireUserAdmin(actor: Actor) {
  if (actor.role !== "ADMIN") throw new AppError(403, "ADMIN_ROLE_ONLY", "Felhasználókat csak adminisztrátor szerepű dolgozó kezelhet.");
}

async function replayed(id: string) {
  return (await prisma.auditEntry.findFirst({ where: { requestId: id } })) !== null;
}

// ---------------------------------------------------------------------------
// Reference ranges (DN-08: per parameter; caparium-hibak-3: and per pool). Without poolId the COMMON range, which
// every pool without its own starts from; with poolId that pool's own range.
// ---------------------------------------------------------------------------

export const referenceSchema = z.object({
  requestId,
  parameterId: z.uuid(),
  poolId: z.uuid().nullable().optional(),
  min: z.string().max(32).nullable(),
  max: z.string().max(32).nullable(),
  mode: z.enum(["change", "correction"]),
  reason: reason.optional(),
});
export type ReferenceInput = z.infer<typeof referenceSchema>;

function bound(raw: string | null, label: string): string | null {
  if (raw === null || raw.trim() === "") return null;
  const v = parseDecimalInput(raw);
  if (v === null) throw new AppError(422, "INVALID_VALUE", `A ${label} nem szám.`);
  return v;
}

export async function setReference(actor: Actor, input: ReferenceInput, now = new Date()) {
  await requireSettingsAdmin(actor);
  const min = bound(input.min, "minimum");
  const max = bound(input.max, "maximum");
  if (min === null && max === null) throw new AppError(422, "EMPTY_RANGE", "Legalább az egyik határt add meg.");
  if (min !== null && max !== null && compareDecimal(min, max) > 0) {
    throw new AppError(422, "MIN_ABOVE_MAX", "A minimum nem lehet nagyobb a maximumnál.");
  }
  await requireReason(prisma, input.mode === "correction", input.reason, "A helyesbítés a múltbeli méréseket is érinti, ezért indoklás kell.");
  if (await replayed(input.requestId)) return { replayed: true };
  return prisma.$transaction(async (tx) => {
    const param = await tx.parameter.findUnique({ where: { id: input.parameterId } });
    if (!param) throw new AppError(404, "NOT_FOUND", "A paraméter nem található.");
    const poolId = input.poolId ?? null;
    if (poolId && !(await tx.pool.findUnique({ where: { id: poolId } }))) throw new AppError(404, "POOL_NOT_FOUND", "A medence nem található.");
    // a pool's correction fixes its OWN range: the common one is corrected without poolId
    const current = await tx.referenceRange.findFirst({ where: { parameterId: param.id, poolId, ...validAt(now) } });
    const before = current ? { min: current.min?.toString() ?? null, max: current.max?.toString() ?? null } : null;
    if (input.mode === "correction") {
      if (!current) throw new AppError(409, "NO_CURRENT", "Nincs érvényes referencia, amit helyesbíteni lehetne.");
      await tx.referenceRange.update({ where: { id: current.id }, data: { min, max } });
      await writeAudit(tx, {
        userId: actor.id,
        action: "MASTER_CORRECTION",
        entityType: "ReferenceRange",
        entityId: current.id,
        changes: diffFields(before ? { poolId, ...before } : null, { poolId, min, max }),
        reason: input.reason,
        requestId: input.requestId,
      });
      return { replayed: false, id: current.id };
    }
    if (current) await tx.referenceRange.update({ where: { id: current.id }, data: { validTo: now } });
    const created = await tx.referenceRange.create({
      data: { parameterId: param.id, poolId, min, max, unitId: param.unitId, validFrom: now, createdById: actor.id },
    });
    await writeAudit(tx, {
      userId: actor.id,
      action: "MASTER_CHANGE",
      entityType: "ReferenceRange",
      entityId: created.id,
      changes: diffFields(before ? { poolId, ...before } : null, { poolId, min, max }),
      reason: input.reason ?? null,
      requestId: input.requestId,
    });
    return { replayed: false, id: created.id };
  });
}

// ---------------------------------------------------------------------------
// Pool volume (caparium-hibak-3, Balázs 2026-10-20 08:44 UTC): litres, the chemical calculator works with it.
// A plain value, not versioned: the calculator always uses today's, and nothing past is judged by it.
// ---------------------------------------------------------------------------

export const poolVolumeSchema = z.object({
  requestId,
  poolId: z.uuid(),
  volumeLiters: z.string().max(32).nullable(),
});

export async function setPoolVolume(actor: Actor, input: z.infer<typeof poolVolumeSchema>) {
  await requireSettingsAdmin(actor);
  const raw = input.volumeLiters?.trim() ?? "";
  const volume = raw === "" ? null : parseDecimalInput(raw);
  if (raw !== "" && (volume === null || compareDecimal(volume, "0") <= 0)) {
    throw new AppError(422, "INVALID_VOLUME", "Az űrtartalom pozitív szám legyen (liter).");
  }
  if (await replayed(input.requestId)) return { replayed: true };
  return prisma.$transaction(async (tx) => {
    const pool = await tx.pool.findUnique({ where: { id: input.poolId } });
    if (!pool) throw new AppError(404, "POOL_NOT_FOUND", "A medence nem található.");
    const before = pool.volumeLiters?.toString() ?? null;
    const same = before === null ? volume === null : volume !== null && compareDecimal(before, volume) === 0;
    if (same) throw new AppError(422, "NO_CHANGE", "Nincs változás.");
    await tx.pool.update({ where: { id: pool.id }, data: { volumeLiters: volume } });
    await writeAudit(tx, {
      userId: actor.id,
      action: "MASTER_CHANGE",
      entityType: "Pool",
      entityId: pool.id,
      changes: { volumeLiters: { before, after: volume } },
      requestId: input.requestId,
    });
    return { replayed: false };
  });
}

// ---------------------------------------------------------------------------
// Pool display names (VIZ-22: stable id, changeable name)
// ---------------------------------------------------------------------------

export const poolNameSchema = z.object({
  requestId,
  poolId: z.uuid(),
  name: exportSafe(z.string().trim().min(2).max(60)),
  mode: z.enum(["change", "correction"]),
  reason: reason.optional(),
});
export type PoolNameInput = z.infer<typeof poolNameSchema>;

async function assertUniquePoolName(tx: Tx, poolId: string, name: string, now: Date) {
  const clash = await tx.poolName.findFirst({
    where: { displayName: { equals: name, mode: "insensitive" }, poolId: { not: poolId }, pool: { active: true }, ...validAt(now) },
  });
  if (clash) throw new AppError(409, "NAME_TAKEN", "Ilyen nevű aktív medence már van.");
}

export async function renamePool(actor: Actor, input: PoolNameInput, now = new Date()) {
  await requireSettingsAdmin(actor);
  await requireReason(prisma, input.mode === "correction", input.reason, "A helyesbítés a régi naplókban is átírja a nevet, ezért indoklás kell.");
  if (await replayed(input.requestId)) return { replayed: true };
  return prisma.$transaction(async (tx) => {
    const current = await tx.poolName.findFirst({ where: { poolId: input.poolId, ...validAt(now) } });
    if (!current) throw new AppError(404, "NOT_FOUND", "A medence nem található.");
    await assertUniquePoolName(tx, input.poolId, input.name, now);
    if (input.mode === "correction") {
      await tx.poolName.update({ where: { id: current.id }, data: { displayName: input.name } });
    } else {
      await tx.poolName.update({ where: { id: current.id }, data: { validTo: now } });
      await tx.poolName.create({ data: { poolId: input.poolId, displayName: input.name, validFrom: now } });
    }
    await writeAudit(tx, {
      userId: actor.id,
      action: input.mode === "correction" ? "MASTER_CORRECTION" : "MASTER_CHANGE",
      entityType: "Pool",
      entityId: input.poolId,
      changes: diffFields({ displayName: current.displayName }, { displayName: input.name }),
      reason: input.reason ?? null,
      requestId: input.requestId,
    });
    return { replayed: false };
  });
}

// ---------------------------------------------------------------------------
// A new pool (Lili 2026-10-26, Caparium channel msg 1564351191281049815, point 3; Balázs "Mehet" 1564352369205186581):
// the admin adds a pool with its name, code and volume, and optionally an icon. It ONLY adds a row: no existing pool,
// measurement or name is touched, and nothing is deleted. The pool is not in any measurement group yet (the group
// membership is the starting data's, base-data.ts), so it takes no measurements until that is decided.
// ---------------------------------------------------------------------------

export const createPoolSchema = z.object({
  requestId,
  name: exportSafe(z.string().trim().min(2).max(60)),
  // the internal, never shown key, in the shape of the starting data's codes (NAGY, KIS_SOZO); typed in any case
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,29}$/, "A kód 2–30 karakter: nagybetű, szám, alsó vonás, betűvel kezdődik."),
  volumeLiters: z.string().trim().min(1, "Az űrtartalom kötelező (liter).").max(32),
  emoji: emojiField.optional(),
});
export type CreatePoolInput = z.infer<typeof createPoolSchema>;

export async function createPool(actor: Actor, input: CreatePoolInput, now = new Date()) {
  // the admin ROLE, like user management: a SETTINGS=ADMIN override on an aquarist does not add pools
  if (actor.role !== "ADMIN") throw new AppError(403, "ADMIN_ROLE_ONLY", "Új medencét csak adminisztrátor szerepű dolgozó vehet fel.");
  await requireSettingsAdmin(actor);
  const volume = parseDecimalInput(input.volumeLiters);
  if (volume === null || compareDecimal(volume, "0") <= 0) throw new AppError(422, "INVALID_VOLUME", "Az űrtartalom pozitív szám legyen (liter).");
  if (await replayed(input.requestId)) return { replayed: true };
  const emoji = input.emoji ? input.emoji : null;
  try {
    return await prisma.$transaction(async (tx) => {
      // the same name check as a rename; there is no pool of its own to leave out yet
      const clash = await tx.poolName.findFirst({
        where: { displayName: { equals: input.name, mode: "insensitive" }, pool: { active: true }, ...validAt(now) },
      });
      if (clash) throw new AppError(409, "NAME_TAKEN", "Ilyen nevű aktív medence már van.");
      const pool = await tx.pool.create({
        data: { code: input.code, emoji, volumeLiters: volume, names: { create: { displayName: input.name, validFrom: FIRST_NAME_FROM } } },
      });
      await writeAudit(tx, {
        userId: actor.id,
        action: "MASTER_CHANGE",
        entityType: "Pool",
        entityId: pool.id,
        changes: diffFields(null, { code: pool.code, displayName: input.name, volumeLiters: volume, emoji }),
        requestId: input.requestId,
      });
      return { replayed: false, id: pool.id };
    });
  } catch (e) {
    if (isUniqueViolation(e, "code")) throw new AppError(409, "CODE_TAKEN", "Ez a medencekód már foglalt.");
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Users (ÁLT-04, ÁLT-06, ÁLT-17; the monogram and the ZIMS name are K3-versioned)
// ---------------------------------------------------------------------------

const password = z.string().min(10, "A jelszó legalább 10 karakter legyen.").max(200);
const monogram = exportSafe(z.string().trim().min(1).max(6));

export const createUserSchema = z.object({
  requestId,
  loginId: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,40}$/, "A felhasználónév 3–40 karakter: kisbetű, szám, pont, kötőjel."),
  fullName: exportSafe(z.string().trim().min(2).max(100)),
  role: z.enum(["AQUARIST", "ADMIN"]),
  monogram,
  zimsName: exportSafe(z.string().trim().min(2).max(100)),
  password,
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  requestId,
  role: z.enum(["AQUARIST", "ADMIN"]).optional(),
  active: z.boolean().optional(),
  monogram: monogram.optional(),
  zimsName: exportSafe(z.string().trim().min(2).max(100)).optional(),
  /**
   * A ZIMS-NÉV MÓDOSÍTÁSÁNAK FAJTÁJA (acrobot 34388/34448, a lili-eset 2026-10-21): CORRECTION, ha elírás volt,
   * és a javított név a korábbi mérésekre is áll (a meglévő sort írja át); RENAME, ha a dolgozó neve változott
   * (a régi név a korábbi mérésekre marad, az új mostantól él). Ha van érvényes név, kötelező.
   */
  zimsNameMode: z.enum(["CORRECTION", "RENAME"]).optional(),
  password: password.optional(),
  reason: reason.optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

async function assertUniqueMonogram(tx: Tx, userId: string | null, mono: string, now: Date) {
  const clash = await tx.userMonogram.findFirst({
    where: { monogram: { equals: mono, mode: "insensitive" }, user: { active: true }, ...validAt(now), ...(userId ? { userId: { not: userId } } : {}) },
  });
  if (clash) throw new AppError(409, "MONOGRAM_TAKEN", "Ez a monogram már egy aktív dolgozóé.");
}

export async function createUser(actor: Actor, input: CreateUserInput, now = new Date()) {
  requireUserAdmin(actor);
  await requireSettingsAdmin(actor);
  if (await replayed(input.requestId)) return { replayed: true };
  const passwordHash = await hashPassword(input.password);
  try {
    return await prisma.$transaction(async (tx) => {
      await assertUniqueMonogram(tx, null, input.monogram, now);
      const u = await tx.user.create({
        data: {
          loginId: input.loginId,
          fullName: input.fullName,
          role: input.role,
          passwordHash,
          monograms: { create: { monogram: input.monogram, validFrom: now } },
          // az első név az idők kezdetétől él: egy visszadátumozott mérés is megtalálja (a lili-eset)
          zimsNames: { create: { zimsName: input.zimsName, validFrom: FIRST_NAME_FROM } },
        },
      });
      await writeAudit(tx, {
        userId: actor.id,
        action: "MASTER_CHANGE",
        entityType: "User",
        entityId: u.id,
        changes: diffFields(null, {
          loginId: u.loginId,
          fullName: u.fullName,
          role: u.role,
          monogram: input.monogram,
          zimsName: input.zimsName,
          password: "beállítva",
        }),
        requestId: input.requestId,
      });
      return { replayed: false, id: u.id };
    });
  } catch (e) {
    if (isUniqueViolation(e, "loginId")) throw new AppError(409, "LOGIN_TAKEN", "Ez a felhasználónév már foglalt.");
    throw e;
  }
}

export async function updateUser(actor: Actor, id: string, input: UpdateUserInput, now = new Date()) {
  requireUserAdmin(actor);
  await requireSettingsAdmin(actor);
  // nobody changes their own role (either way) or deactivates themselves: another admin does
  if (id === actor.id && (input.active === false || input.role !== undefined)) {
    throw new AppError(422, "SELF_LOCKOUT", "A saját szerepedet és fiókodat nem módosíthatod; kérj meg egy másik adminisztrátort.");
  }
  if (await replayed(input.requestId)) return { replayed: true };
  const passwordHash = input.password ? await hashPassword(input.password) : undefined;
  return prisma.$transaction(async (tx) => {
    const u = await tx.user.findUnique({ where: { id }, include: { monograms: true, zimsNames: true } });
    if (!u || u.role === "SYSTEM") throw new AppError(404, "NOT_FOUND", "A felhasználó nem található.");
    const curMono = u.monograms.find((m) => m.validFrom <= now && (m.validTo === null || m.validTo > now));
    const curZims = u.zimsNames.find((m) => m.validFrom <= now && (m.validTo === null || m.validTo > now));
    const before: Record<string, unknown> = { role: u.role, active: u.active, monogram: curMono?.monogram ?? null, zimsName: curZims?.zimsName ?? null };
    const after: Record<string, unknown> = { ...before };

    if (input.role && input.role !== u.role) after.role = input.role;
    if (input.active !== undefined && input.active !== u.active) after.active = input.active;
    await tx.user.update({
      where: { id },
      data: {
        role: after.role as "AQUARIST" | "ADMIN",
        active: after.active as boolean,
        deactivatedAt: after.active === false && u.active ? now : after.active === true ? null : undefined,
        ...(passwordHash ? { passwordHash } : {}),
      },
    });
    if (input.monogram && input.monogram !== curMono?.monogram) {
      await assertUniqueMonogram(tx, id, input.monogram, now);
      if (curMono) await tx.userMonogram.update({ where: { id: curMono.id }, data: { validTo: now } });
      await tx.userMonogram.create({ data: { userId: id, monogram: input.monogram, validFrom: now } });
      after.monogram = input.monogram;
    }
    if (input.zimsName && input.zimsName !== curZims?.zimsName) {
      if (!curZims) {
        // még soha nem volt neve: az idők kezdetétől; volt, de lezárult: mostantól
        const first = u.zimsNames.length === 0;
        await tx.userZimsName.create({ data: { userId: id, zimsName: input.zimsName, validFrom: first ? FIRST_NAME_FROM : now } });
      } else if (input.zimsNameMode === "CORRECTION") {
        await tx.userZimsName.update({ where: { id: curZims.id }, data: { zimsName: input.zimsName } });
        after.zimsNameMode = "elírás javítása (a korábbi mérésekre is)";
      } else if (input.zimsNameMode === "RENAME") {
        await tx.userZimsName.update({ where: { id: curZims.id }, data: { validTo: now } });
        await tx.userZimsName.create({ data: { userId: id, zimsName: input.zimsName, validFrom: now } });
        after.zimsNameMode = "névváltozás (mostantól)";
      } else {
        throw new AppError(
          422,
          "ZIMS_NAME_MODE",
          "Add meg, hogy a ZIMS-név elírását javítod (a korábbi mérésekre is), vagy a dolgozó neve változott (mostantól).",
        );
      }
      after.zimsName = input.zimsName;
    }
    // a deactivated user, or one with a new password, is logged out everywhere
    if (after.active === false || passwordHash) await tx.session.deleteMany({ where: { userId: id } });
    const changes = diffFields(before, after);
    if (passwordHash) changes.password = { before: null, after: "új jelszó beállítva" };
    if (Object.keys(changes).length === 0) throw new AppError(422, "NO_CHANGE", "Nincs változás.");
    await writeAudit(tx, {
      userId: actor.id,
      action: "MASTER_CHANGE",
      entityType: "User",
      entityId: id,
      changes,
      reason: input.reason ?? null,
      requestId: input.requestId,
    });
    return { replayed: false };
  });
}
