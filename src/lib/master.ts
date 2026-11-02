// Reads of time-versioned master data (adatmodell K3): everything is "valid at an instant".

import type { AppModule, JournalKind, Prisma } from "@prisma/client";
import { writeAudit } from "./audit";
import { prisma, type Tx } from "./db";
import { canonicalDecimal } from "./decimal";
import { takesDilution } from "./dilution";
import { effectiveLevel, effectiveNow, type Level, type Role } from "./permissions";
import type { ReadingConversion } from "./reading";
import { businessDayOf, dateToDay, dayToDate } from "./time";

export function validAt(at: Date) {
  return {
    validFrom: { lte: at },
    OR: [{ validTo: null }, { validTo: { gt: at } }],
  } satisfies { validFrom: Prisma.DateTimeFilter; OR: unknown[] };
}

type Versioned = { validFrom: Date; validTo: Date | null };

/**
 * A DOLGOZÓ ELSŐ ZIMS-NEVÉNEK KEZDETE: az idők kezdete, nem a beírás pillanata (acrobot 34448, a lili-eset
 * 2026-10-21). A méréseket visszadátumozva is rögzítik, és egy csak a beírástól élő név az előtte lévő napokra
 * nem ad nevet: a ZIMS-export ott „nincs ZIMS-neve” hibával megáll.
 */
export const FIRST_NAME_FROM = new Date("1970-01-01T00:00:00.000Z");

export function pickValid<T extends Versioned>(rows: T[], at: Date): T | undefined {
  return rows.find((r) => r.validFrom <= at && (r.validTo === null || r.validTo > at));
}

/**
 * The name row valid at `at`, or, before the first one began, that first one (Lili 2026-10-27 23:07 UTC: a day
 * recorded back in time, before the group's name was given, read "? (csoport)"). Whatever was named on a day
 * existed then; its first name is the one it is known by, not a question mark.
 */
export function nameAt<T extends Versioned>(rows: T[], at: Date): T | undefined {
  return pickValid(rows, at) ?? [...rows].sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime()).find((r) => r.validFrom > at);
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
  // Lili's package (2026-10-29): where the monthly ZIMS package's mail goes; empty = no mail is sent
  monthly_zims_recipient: "",
  // caparium-indoklas-ki (Balázs 2026-10-20 19:21 UTC, msg 1562184077489209436): the reasons are off; a setting row
  // "true" brings every reason rule back as it was (src/lib/reasons.ts).
  reason_required: "false",
  // Lili 2026-10-30 (Takarmányhűtő, acrobot 38592): the day the feed stock starts counting, set by an admin on the
  // Takarmányhűtő page; empty = each feed counts from its first intake that was not sent back. What lies before it stays
  // in the logs, the reports and the exports at full value and is not in the stock (src/lib/feed-intake.ts feedStock).
  feed_stock_start: "",
  // card 0d617f0c (Lili 2026-10-30 11:39 UTC: "csak addig, amíg nem lesz rutin"): the helper's "Ne felejtsd el menteni!"
  // on a fully filled, unsaved form (src/lib/save-reminder.ts). On until an admin switches it off in Beállítások.
  save_reminder: "true",
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

/**
 * `active`: the pool is in use on the day of `at` (Lili 2026-11-01, point 16: a period of it covers that day); one not in use (a
 * renovation, or before it was taken into use) takes no new measurement that day; its other measurements stay
 */
export type LayoutPool = { id: string; name: string; active: boolean };
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
  /** point 13: in force, what is typed is a tester's reading, converted to the value (src/lib/reading.ts) */
  conversion: ReadingConversion | null;
  /** point 9: the pools this column is filled in; null = every pool of the group */
  pools: string[] | null;
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
      include: { pool: { include: { names: true, periods: true } } },
    }),
    tx.groupParameter.findMany({
      where: { groupId, ...validAt(at) },
      // Lili 2026-11-02 (acrobot 39956, point 4): one order everywhere, the measurements' own (src/lib/parameter-order.ts)
      orderBy: [{ parameter: { sortOrder: "asc" } }, { sortOrder: "asc" }],
      include: { parameter: { include: { names: true, unit: true, conversions: { where: validAt(at), orderBy: { validFrom: "desc" }, take: 1 } } } },
    }),
  ]);
  return {
    pools: memberships.map((m) => ({
      id: m.pool.id,
      name: pickValid(m.pool.names, at)?.displayName ?? m.pool.code,
      active: m.pool.periods.some((p) => {
        const day = businessDayOf(at);
        return dateToDay(p.firstDay) <= day && (p.lastDay === null || day <= dateToDay(p.lastDay));
      }),
    })),
    parameters: params.map((gp) => ({
      id: gp.parameter.id,
      code: gp.parameter.code,
      name: pickValid(gp.parameter.names, at)?.displayName ?? gp.parameter.code,
      // a unit change's successor keeps the built-in behaviour (src/lib/measurement-types.ts)
      dilution: takesDilution(gp.parameter.baseCode ?? gp.parameter.code),
      decimals: gp.parameter.decimals,
      unit: {
        id: gp.parameter.unit.id,
        symbol: gp.parameter.unit.symbol,
        dimension: gp.parameter.unit.dimension,
        factorToBase: gp.parameter.unit.factorToBase?.toString() ?? null,
      },
      plausibleMin: gp.parameter.plausibleMin?.toString() ?? null,
      plausibleMax: gp.parameter.plausibleMax?.toString() ?? null,
      conversion: gp.parameter.conversions[0]
        ? (({ id, label, factor, decimals }) => ({ id, label, factor: canonicalDecimal(factor), decimals }))(gp.parameter.conversions[0])
        : null,
      pools: gp.poolIds.length ? gp.poolIds : null,
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

/**
 * "Today" for ensureJournalDayForEntry: the business day of the client's clock when it is at most 48 hours behind the server
 * (a save made yesterday evening that arrives after midnight is yesterday's own entry, not a backfill: the K9 late rule decides
 * it), else the server's.
 */
export function entryToday(serverNow: Date, clientTs: Date | null): string {
  const e = effectiveNow(serverNow, clientTs, 0, 48);
  return businessDayOf(e.clientNow ?? e.now);
}

/** The reason of the open reopening a past day's lock is born with when an entry keys the day in afterwards. */
export const BACKFILL_REASON = "Visszamenőleges bevitel";

/**
 * The lock of a day an entry is recorded on. A day before `today` whose lock this entry creates (an old day keyed in afterwards,
 * back to 2018) is born with an open reopening: the scheduled close passes a reopened day over, so the day stays open while the
 * old entries go in and an admin closes it once, by hand, however long ago it was (Lili 2026-11-02, Takarmánykivétel: the day
 * closed by itself between two rows). An existing lock is returned as it is: a day closed before stays closed.
 */
export async function ensureJournalDayForEntry(tx: Tx, kind: JournalKind, groupId: string | null, day: string, opener: { actorId: string; today: string }) {
  const existed = await tx.journalDay.findFirst({ where: { kind, groupId, businessDay: dayToDate(day) } });
  if (existed) return existed;
  const row = await ensureJournalDay(tx, kind, groupId, day);
  if (day >= opener.today) return row;
  // two first entries of the same old day at once: the second waits here for the first's reopening, sees it and makes no second
  // one (barracuda on #194: two REOPEN audit rows otherwise, harmless but doubled)
  await tx.$queryRaw`SELECT "id" FROM "journal_day" WHERE "id" = ${row.id}::uuid FOR UPDATE`;
  if (!(await tx.journalReopen.findFirst({ where: { journalDayId: row.id, reclosedAt: null } }))) {
    await tx.journalReopen.create({ data: { journalDayId: row.id, reopenedById: opener.actorId, reason: BACKFILL_REASON } });
    await writeAudit(tx, {
      userId: opener.actorId,
      action: "REOPEN",
      entityType: "JournalDay",
      entityId: row.id,
      changes: { state: { before: null, after: "OPEN" }, businessDay: { before: null, after: day } },
      reason: BACKFILL_REASON,
    });
  }
  return row;
}

/**
 * The people the "Mérést végezte" may name on a day: the active aquarists and admins, and for an earlier day the inactive ones too
 * (a former colleague of an old measurement; acrobot 40205, C9), marked so. The server checks the same (measurements.ts).
 */
export async function responsiblePeople(day: string, today: string) {
  const rows = await prisma.user.findMany({
    where: { role: { in: ["AQUARIST", "ADMIN"] }, ...(day < today ? {} : { active: true }) },
    orderBy: [{ active: "desc" }, { fullName: "asc" }],
    select: { id: true, fullName: true, active: true },
  });
  return rows.map((u) => ({ id: u.id, fullName: u.active ? u.fullName : `${u.fullName} (inaktív)` }));
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
      // before the worker's first monogram began (a measurement recorded back in time): that first one (Lili 2026-11-01, point 1)
      return nameAt(byUser.get(userId) ?? [], at)?.monogram ?? names.get(userId) ?? "?";
    },
    name(userId: string): string {
      return names.get(userId) ?? "?";
    },
  };
}
