// Reads of time-versioned master data (adatmodell K3): everything is "valid at an instant".

import type { AppModule, JournalKind, Prisma } from "@prisma/client";
import { prisma, type Tx } from "./db";
import { takesDilution } from "./dilution";
import { effectiveLevel, type Level, type Role } from "./permissions";
import { dayToDate } from "./time";

export function validAt(at: Date) {
  return {
    validFrom: { lte: at },
    OR: [{ validTo: null }, { validTo: { gt: at } }],
  } satisfies { validFrom: Prisma.DateTimeFilter; OR: unknown[] };
}

type Versioned = { validFrom: Date; validTo: Date | null };

export function pickValid<T extends Versioned>(rows: T[], at: Date): T | undefined {
  return rows.find((r) => r.validFrom <= at && (r.validTo === null || r.validTo > at));
}

export const SETTING_DEFAULTS = {
  late_save_grace_minutes: "30",
  late_save_max_hours: "48",
  business_day_time_zone: "Europe/Budapest",
  show_reference_on_deviation: "true",
  // JAV-06, the body weight log: our proposal, not the customer's request; hidden, not deleted (Balázs 2026-10-20
  // 08:10 UTC, msg 1562015239485128707, caparium-hibak-2). Code, table and data stay; a setting row with "true"
  // brings the calculator page's log back. There is no screen for it on purpose: it is not to be seen.
  body_weight_log_visible: "false",
  // caparium-hibak-4 (Balázs 2026-10-20 09:45 UTC): where "Vízmérés kiküldése" sends; empty = not set yet
  water_report_recipient: "",
  // caparium-indoklas-ki (Balázs 2026-10-20 19:21 UTC, msg 1562184077489209436): the reasons are off; a setting row
  // "true" brings every reason rule back as it was (src/lib/reasons.ts).
  reason_required: "false",
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export async function getSetting(tx: Tx, key: SettingKey, at: Date = new Date()): Promise<string> {
  const row = await tx.setting.findFirst({
    where: { key, validFrom: { lte: at } },
    orderBy: { validFrom: "desc" },
  });
  return row?.value ?? SETTING_DEFAULTS[key];
}

export async function moduleLevel(tx: Tx, userId: string, role: Role, module: AppModule): Promise<Level> {
  const override = await tx.modulePermission.findUnique({ where: { userId_module: { userId, module } } });
  return effectiveLevel(role, override?.level ?? null);
}

export type LayoutPool = { id: string; name: string };
export type LayoutParameter = {
  id: string;
  code: string;
  name: string;
  /** the weekly dilution and RO/SW fields belong to this parameter (src/lib/dilution.ts) */
  dilution: boolean;
  decimals: number;
  unit: { id: string; symbol: string; dimension: string; factorToBase: string | null };
  plausibleMin: string | null;
  plausibleMax: string | null;
};

/** The rows (pools) and columns (parameters) of a measurement group at an instant. */
export async function groupLayout(
  tx: Tx,
  groupId: string,
  at: Date,
): Promise<{ pools: LayoutPool[]; parameters: LayoutParameter[] }> {
  const [memberships, params] = await Promise.all([
    tx.groupMembership.findMany({
      where: { groupId, ...validAt(at) },
      orderBy: { sortOrder: "asc" },
      include: { pool: { include: { names: true } } },
    }),
    tx.groupParameter.findMany({
      where: { groupId, ...validAt(at) },
      orderBy: { sortOrder: "asc" },
      include: { parameter: { include: { names: true, unit: true } } },
    }),
  ]);
  return {
    pools: memberships.map((m) => ({ id: m.pool.id, name: pickValid(m.pool.names, at)?.displayName ?? m.pool.code })),
    parameters: params.map((gp) => ({
      id: gp.parameter.id,
      code: gp.parameter.code,
      name: pickValid(gp.parameter.names, at)?.displayName ?? gp.parameter.code,
      dilution: takesDilution(gp.parameter.code),
      decimals: gp.parameter.decimals,
      unit: {
        id: gp.parameter.unit.id,
        symbol: gp.parameter.unit.symbol,
        dimension: gp.parameter.unit.dimension,
        factorToBase: gp.parameter.unit.factorToBase?.toString() ?? null,
      },
      plausibleMin: gp.parameter.plausibleMin?.toString() ?? null,
      plausibleMax: gp.parameter.plausibleMax?.toString() ?? null,
    })),
  };
}

/**
 * Finds the reference range of a parameter in a pool valid at the measurement instant (R-10): the pool's own
 * range, else the common one every pool starts from (caparium-hibak-3, Balázs 2026-10-20: per pool, not one for all).
 */
export async function referenceAt(tx: Tx, parameterId: string, poolId: string, at: Date) {
  return (
    (await tx.referenceRange.findFirst({ where: { parameterId, poolId, ...validAt(at) }, include: { unit: true } })) ??
    (await tx.referenceRange.findFirst({ where: { parameterId, poolId: null, ...validAt(at) }, include: { unit: true } }))
  );
}

/**
 * Returns the journal day (the day's lock), creating it if the scheduled run has not yet (R-15).
 * Idempotent under concurrency: a lost creation race re-reads the winner.
 */
export async function ensureJournalDay(tx: Tx, kind: JournalKind, groupId: string | null, day: string) {
  const businessDay = dayToDate(day);
  const existing = await tx.journalDay.findFirst({ where: { kind, groupId, businessDay } });
  if (existing) return existing;
  // ON CONFLICT DO NOTHING keeps the surrounding transaction usable when another request wins the race.
  await tx.$executeRaw`
    INSERT INTO "journal_day" ("id", "kind", "groupId", "businessDay", "state")
    VALUES (gen_random_uuid(), ${kind}::"JournalKind", ${groupId}::uuid, ${businessDay}::date, 'OPEN')
    ON CONFLICT DO NOTHING`;
  const row = await tx.journalDay.findFirst({ where: { kind, groupId, businessDay } });
  if (!row) throw new Error("journal day could not be created");
  return row;
}

/** Monogram valid at an instant for many users at once (R-13: the single source). */
export async function monogramResolver(userIds: string[]) {
  const ids = [...new Set(userIds)];
  const rows = ids.length
    ? await prisma.userMonogram.findMany({ where: { userId: { in: ids } }, orderBy: { validFrom: "asc" } })
    : [];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : [];
  const byUser = new Map<string, typeof rows>();
  for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  return {
    monogram(userId: string, at: Date): string {
      return pickValid(byUser.get(userId) ?? [], at)?.monogram ?? names.get(userId) ?? "?";
    },
    name(userId: string): string {
      return names.get(userId) ?? "?";
    },
  };
}
