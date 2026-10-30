// The admin's activity page (card 70cadcf8, Lili 2026-10-30 10:33 UTC: "who did what, but not an endless table:
// a summary to click into"). It reads the audit log only; nothing here writes.
//
// Two rules decide every number on the page:
// - ONE SAVE COUNTS ONCE. A save writes several audit rows under one requestId: a feeding save also writes the
//   automatic fasting and invalidated eating statuses (src/lib/feeding.ts), a withdrawal its journal day. The page
//   counts saves, never rows; a row without a requestId (an export, a day close) is a save of its own.
// - A SAVE BELONGS TO ONE KIND: the first of ACTIVITY_KINDS, in their order, that its rows touch. The eating log is
//   last because other saves write eating statuses as a side effect; a save that writes ONLY eating statuses (or
//   body weights) is an eating-log save.
// The system's own writes (the automatic day close, SYSTEM_USER_ID) and the login rows are not anybody's data entry.

import type { AuditAction } from "@prisma/client";
import { prisma, SYSTEM_USER_ID } from "./db";
import { addDays, businessDayOf, resolveLocalDateTime } from "./time";

export type ActivityKindKey = "water" | "feeding" | "withdrawal" | "dosing" | "animals" | "settings" | "export" | "eating";

export type ActivityKind = { key: ActivityKindKey; label: string; entityTypes: readonly string[] };

/**
 * Every entity type an audit row is written for, by kind, in the order that decides a save's kind. A new entity
 * type must be added here: tests/unit/activity.test.ts reads every `entityType: "..."` in src and fails on one
 * that has no kind, so a new kind of record cannot drop out of the page unnoticed.
 */
export const ACTIVITY_KINDS: readonly ActivityKind[] = [
  { key: "water", label: "Vízmérés", entityTypes: ["Measurement", "MeasurementRound", "PoolTick"] },
  {
    key: "feeding",
    label: "Takarmánynapló",
    entityTypes: ["FeedingDay", "FeedingItem", "FeedingList", "FeedingSelection", "FeedingPlan", "FeedingReference", "CalculatorRun"],
  },
  { key: "withdrawal", label: "Fagyasztó és kivétel", entityTypes: ["FeedIntakeItem", "WithdrawalItem"] },
  { key: "dosing", label: "Vegyszeradagolás", entityTypes: ["Dosing", "StockMovement"] },
  { key: "animals", label: "Állatok", entityTypes: ["Animal", "AnimalGroup", "AnimalOrder", "LifecycleEvent", "InitialAnimalList", "Species"] },
  {
    key: "settings",
    label: "Beállítások",
    entityTypes: ["Feed", "FeedOrder", "Chemical", "Pool", "ReferenceRange", "Setting", "User"],
  },
  { key: "export", label: "Export, levél, napzárás", entityTypes: ["ExportRun", "MonthlyZimsMail", "WaterReportMail", "JournalDay"] },
  { key: "eating", label: "Evési napló", entityTypes: ["EatingStatus", "BodyWeight"] },
];

const KIND_OF = new Map<string, ActivityKindKey>(ACTIVITY_KINDS.flatMap((k) => k.entityTypes.map((t) => [t, k.key] as const)));
const KIND_ORDER = new Map<ActivityKindKey, number>(ACTIVITY_KINDS.map((k, i) => [k.key, i]));

/** The kind of one entity type, or null for one that is not in ACTIVITY_KINDS. */
export function kindOf(entityType: string): ActivityKindKey | null {
  return KIND_OF.get(entityType) ?? null;
}

/** Not data entry: who logged in or out. */
export const EXCLUDED_ACTIONS: readonly AuditAction[] = ["LOGIN", "LOGIN_FAILED", "LOGOUT"];

/** The longest period the page reads at once (days, both ends counted). */
export const MAX_ACTIVITY_DAYS = 31;

export type ActivityRow = {
  id: bigint;
  at: Date;
  userId: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  requestId: string | null;
  reason: string | null;
};

export type ActivitySave = {
  key: string;
  day: string;
  userId: string;
  kind: ActivityKindKey | "other";
  /** the first row's instant */
  at: Date;
  rows: ActivityRow[];
};

/** The rows grouped into saves (one requestId, or one row without it), each with its day, user and kind. */
export function groupSaves(rows: readonly ActivityRow[]): ActivitySave[] {
  const byKey = new Map<string, ActivityRow[]>();
  for (const r of rows) {
    if (r.userId === SYSTEM_USER_ID || EXCLUDED_ACTIONS.includes(r.action)) continue;
    // a requestId is the client's, so it is keyed with the user too: two users cannot share one save
    const key = r.requestId ? `${r.userId}|${r.requestId}` : `${r.userId}|row:${r.id}`;
    const list = byKey.get(key);
    if (list) list.push(r);
    else byKey.set(key, [r]);
  }
  const saves: ActivitySave[] = [];
  for (const [key, list] of byKey) {
    list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    let kind: ActivityKindKey | "other" = "other";
    let best = Infinity;
    for (const r of list) {
      const k = kindOf(r.entityType);
      if (k !== null && KIND_ORDER.get(k)! < best) {
        best = KIND_ORDER.get(k)!;
        kind = k;
      }
    }
    saves.push({ key, day: businessDayOf(list[0].at), userId: list[0].userId, kind, at: list[0].at, rows: list });
  }
  return saves.sort((a, b) => b.at.getTime() - a.at.getTime());
}

export type ActivitySummaryRow = { day: string; userId: string; counts: Partial<Record<ActivityKindKey | "other", number>>; total: number };

/** One row per day and user that has a save, newest day first; the cells count saves. */
export function summarize(saves: readonly ActivitySave[]): ActivitySummaryRow[] {
  const byKey = new Map<string, ActivitySummaryRow>();
  for (const s of saves) {
    const key = `${s.day}|${s.userId}`;
    let row = byKey.get(key);
    if (!row) {
      row = { day: s.day, userId: s.userId, counts: {}, total: 0 };
      byKey.set(key, row);
    }
    row.counts[s.kind] = (row.counts[s.kind] ?? 0) + 1;
    row.total += 1;
  }
  return [...byKey.values()].sort((a, b) => (a.day === b.day ? a.userId.localeCompare(b.userId) : a.day < b.day ? 1 : -1));
}

/** The first and the last business day of the period, clamped to MAX_ACTIVITY_DAYS ending at `to`. */
export function clampPeriod(from: string, to: string): { from: string; to: string } {
  const earliest = addDays(to, -(MAX_ACTIVITY_DAYS - 1));
  return { from: from < earliest ? earliest : from > to ? to : from, to };
}

/**
 * The audit rows of the period's business days (Europe/Budapest), optionally of one user. A row's day is the
 * business day of its server time: an activity log says when the save reached the server.
 */
export async function loadActivityRows(period: { from: string; to: string }, userId?: string): Promise<ActivityRow[]> {
  const start = resolveLocalDateTime(`${period.from}T00:00`)!.instant;
  const end = resolveLocalDateTime(`${addDays(period.to, 1)}T00:00`)!.instant;
  return prisma.auditEntry.findMany({
    where: {
      at: { gte: start, lt: end },
      userId: userId ? userId : { not: SYSTEM_USER_ID },
      action: { notIn: [...EXCLUDED_ACTIONS] },
    },
    select: { id: true, at: true, userId: true, action: true, entityType: true, entityId: true, requestId: true, reason: true },
    orderBy: { id: "asc" },
  });
}

/** What a save touched, in the words of the app's menus. */
export const ENTITY_LABEL: Readonly<Record<string, string>> = {
  Measurement: "vízmérés",
  MeasurementRound: "mérési kör",
  PoolTick: "medence-pipa",
  FeedingDay: "etetési nap",
  FeedingItem: "takarmánytétel",
  FeedingList: "etetési lista",
  FeedingSelection: "etetett állat",
  FeedingPlan: "etetési terv",
  FeedingReference: "etetési referencia",
  CalculatorRun: "kalkuláció",
  FeedIntakeItem: "takarmány-beérkezés",
  WithdrawalItem: "takarmánykivétel",
  Dosing: "adagolás",
  StockMovement: "vegyszerkészlet",
  Animal: "állat",
  AnimalGroup: "állatcsoport",
  AnimalOrder: "állat-sorrend",
  LifecycleEvent: "életciklus-esemény",
  InitialAnimalList: "kezdő állatlista",
  Species: "faj",
  Feed: "takarmány",
  FeedOrder: "takarmány-sorrend",
  Chemical: "vegyszer",
  Pool: "medence",
  ReferenceRange: "referenciaérték",
  Setting: "beállítás",
  User: "felhasználó",
  ExportRun: "export",
  MonthlyZimsMail: "havi ZIMS-levél",
  WaterReportMail: "vízmérés-kiküldés",
  JournalDay: "napzárás",
  EatingStatus: "evési állapot",
  BodyWeight: "testtömeg",
};

export const ACTION_LABEL: Readonly<Record<AuditAction, string>> = {
  CREATE: "rögzítés",
  UPDATE: "módosítás",
  INVALIDATE: "érvénytelenítés",
  CLOSE: "lezárás",
  REOPEN: "újranyitás",
  MASTER_CHANGE: "törzsadat-változás",
  MASTER_CORRECTION: "törzsadat-helyesbítés",
  EXPORT: "export",
  LOGIN: "belépés",
  LOGIN_FAILED: "sikertelen belépés",
  LOGOUT: "kilépés",
  CONFLICT_REJECTED: "ütközés miatt elutasítva",
  PENDING_CREATED: "függő mentés",
  PENDING_APPROVED: "függő mentés elfogadva",
  PENDING_REJECTED: "függő mentés elutasítva",
  ANONYMIZE: "anonimizálás",
};

/** "rögzítés: 2 vízmérés, mérési kör": a save's rows in one line, the action first. */
export function describeSave(rows: readonly ActivityRow[]): string {
  const byAction = new Map<AuditAction, Map<string, number>>();
  for (const r of rows) {
    const m = byAction.get(r.action) ?? new Map<string, number>();
    m.set(r.entityType, (m.get(r.entityType) ?? 0) + 1);
    byAction.set(r.action, m);
  }
  return [...byAction]
    .map(([action, types]) => {
      const what = [...types].map(([t, n]) => `${n > 1 ? `${n} ` : ""}${ENTITY_LABEL[t] ?? t}`).join(", ");
      return `${ACTION_LABEL[action]}: ${what}`;
    })
    .join("; ");
}

/** The page's query keys: `ember` filters the summary, `ki` is the person of the opened cell. */
export type ActivityParams = Partial<Record<"tol" | "ig" | "ember" | "ki" | "nap" | "fajta" | "oldal", string>>;

/**
 * The page's query, one value per key. Next.js gives a key that appears twice as an array; its first value counts.
 * Before this, a cell link repeated `ember` and the detail vanished on the second click (barracuda, #136).
 */
export function readActivityParams(raw: Record<string, string | string[] | undefined>): ActivityParams {
  const out: ActivityParams = {};
  for (const key of ["tol", "ig", "ember", "ki", "nap", "fajta", "oldal"] as const) {
    const v = raw[key];
    const value = Array.isArray(v) ? v[0] : v;
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** A link of the page: the period and the filter, then what the link opens; every key at most once. */
export function activityHref(view: { from: string; to: string; filter?: string }, open?: { day: string; person: string; kind: string; page?: number }): string {
  const q = new URLSearchParams({ tol: view.from, ig: view.to });
  if (view.filter) q.set("ember", view.filter);
  if (open) {
    q.set("nap", open.day);
    q.set("ki", open.person);
    q.set("fajta", open.kind);
    if (open.page && open.page > 1) q.set("oldal", String(open.page));
  }
  return `/aktivitas?${q.toString()}${open ? "#reszlet" : ""}`;
}
