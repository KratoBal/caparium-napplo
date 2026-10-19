// Permission rules for journal events (adatmodell 1. terület, DN-09, ÁLT-05, ÁLT-16, R-6, R-17, K9).
// Pure functions: the service layer feeds them the facts, they return a decision.

export type Role = "AQUARIST" | "ADMIN" | "SYSTEM";
export type Level = "NONE" | "READ" | "RECORD" | "ADMIN";

/** The role default, overridden in a module by an explicit module permission (R-17, both ways). */
export function effectiveLevel(role: Role, moduleOverride: Level | null): Level {
  if (moduleOverride) return moduleOverride;
  if (role === "ADMIN") return "ADMIN";
  if (role === "AQUARIST") return "RECORD";
  return "NONE";
}

export type Decision =
  | { kind: "ALLOW"; reasonRequired: false }
  | { kind: "ALLOW"; reasonRequired: true } // admin on a past or closed day: the reason is mandatory
  | { kind: "DENY"; code: DenyCode; message: string };

export type DenyCode = "NO_ACCESS" | "READ_ONLY" | "NOT_OWN" | "NOT_TODAY" | "DAY_CLOSED";

export type DayFacts = {
  /** business day of the event ("YYYY-MM-DD") */
  day: string;
  /** today's business day at the effective time */
  today: string;
  closed: boolean;
};

const DENY = {
  NO_ACCESS: "Ehhez a modulhoz nincs jogosultságod.",
  READ_ONLY: "Ebben a modulban csak olvasási jogod van.",
  NOT_OWN: "Csak a saját bejegyzésedet módosíthatod.",
  NOT_TODAY: "Korábbi napot csak adminisztrátor módosíthat.",
  DAY_CLOSED: "A nap le van zárva; módosítani csak adminisztrátor tud.",
} as const satisfies Record<DenyCode, string>;

function deny(code: DenyCode): Decision {
  return { kind: "DENY", code, message: DENY[code] };
}

/** May the user create a new event on this day? */
export function canCreate(level: Level, f: DayFacts): Decision {
  if (level === "NONE") return deny("NO_ACCESS");
  if (level === "READ") return deny("READ_ONLY");
  if (level === "ADMIN") {
    return f.day === f.today && !f.closed ? { kind: "ALLOW", reasonRequired: false } : { kind: "ALLOW", reasonRequired: true };
  }
  if (f.day !== f.today) return deny("NOT_TODAY");
  if (f.closed) return deny("DAY_CLOSED");
  return { kind: "ALLOW", reasonRequired: false };
}

/**
 * May the user modify or invalidate an existing event?
 * `targetDay` is the business day after the change (a measurement moved to another time, R-6).
 */
export function canModify(
  level: Level,
  f: DayFacts & { isOwn: boolean; targetDay?: string; targetClosed?: boolean },
): Decision {
  if (level === "NONE") return deny("NO_ACCESS");
  if (level === "READ") return deny("READ_ONLY");
  const targetDay = f.targetDay ?? f.day;
  const targetClosed = f.targetClosed ?? f.closed;
  if (level === "ADMIN") {
    const quiet = f.day === f.today && !f.closed && targetDay === f.today && !targetClosed;
    return quiet ? { kind: "ALLOW", reasonRequired: false } : { kind: "ALLOW", reasonRequired: true };
  }
  if (!f.isOwn) return deny("NOT_OWN");
  if (f.day !== f.today || targetDay !== f.today) return deny("NOT_TODAY");
  if (f.closed || targetClosed) return deny("DAY_CLOSED");
  return { kind: "ALLOW", reasonRequired: false };
}

/**
 * K9: which instant counts as "now" for the day rule.
 * Within the grace period the client's original timestamp counts (the request was made
 * before midnight but arrived after it). A client clock ahead of the server is not trusted.
 * Returns `late: true` when the client time is older than the grace period: such a save,
 * if it would only be allowed at the client time, becomes PENDING instead of being lost.
 */
export function effectiveNow(
  serverNow: Date,
  clientTimestamp: Date | null,
  graceMinutes: number,
): { now: Date; late: boolean; clientNow: Date | null } {
  if (!clientTimestamp || Number.isNaN(clientTimestamp.getTime())) return { now: serverNow, late: false, clientNow: null };
  const ageMs = serverNow.getTime() - clientTimestamp.getTime();
  if (ageMs < 0) return { now: serverNow, late: false, clientNow: null };
  if (ageMs <= graceMinutes * 60_000) return { now: clientTimestamp, late: false, clientNow: clientTimestamp };
  return { now: serverNow, late: true, clientNow: clientTimestamp };
}
