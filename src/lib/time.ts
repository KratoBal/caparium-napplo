// Business-day and wall-clock helpers (adatmodell K2).
// Every instant is stored with a time zone; the business day is the local date in
// Europe/Budapest, with midnight as the boundary. DST days are 23 or 25 hours long,
// so nothing here assumes 24-hour days.

export const BUSINESS_TZ = "Europe/Budapest";

const partsFormatter = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = partsFormatter.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    partsFormatter.set(tz, f);
  }
  return f;
}

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

export function wallClock(instant: Date, tz: string = BUSINESS_TZ): WallClock {
  const out: Record<string, number> = {};
  for (const p of formatterFor(tz).formatToParts(instant)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour,
    minute: out.minute,
    second: out.second,
  };
}

/** Local business day of an instant as "YYYY-MM-DD". */
export function businessDayOf(instant: Date, tz: string = BUSINESS_TZ): string {
  const w = wallClock(instant, tz);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** Local wall-clock time "HH:mm" of an instant. */
export function localTimeOf(instant: Date, tz: string = BUSINESS_TZ): string {
  const w = wallClock(instant, tz);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

/** "YYYY-MM-DDTHH:mm" in local time, the value format of <input type="datetime-local">. */
export function localDateTimeOf(instant: Date, tz: string = BUSINESS_TZ): string {
  return `${businessDayOf(instant, tz)}T${localTimeOf(instant, tz)}`;
}

function offsetMinutes(instant: Date, tz: string): number {
  const w = wallClock(instant, tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

export type LocalResolution = {
  instant: Date;
  /** The wall-clock time occurs twice (autumn fall-back hour); the earlier instant was chosen. */
  ambiguous: boolean;
  /** The wall-clock time does not exist (spring-forward gap); it was moved forward by the gap. */
  skipped: boolean;
};

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Converts a local wall-clock "YYYY-MM-DDTHH:mm" to an instant in the given zone.
 * Returns null for a malformed string.
 */
export function resolveLocalDateTime(local: string, tz: string = BUSINESS_TZ): LocalResolution | null {
  const m = LOCAL_RE.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(naive);
  if (check.getUTCDate() !== d || check.getUTCMonth() !== mo - 1) return null;

  // Candidate instants for the two offsets around this wall-clock time.
  const offsets = new Set<number>([
    offsetMinutes(new Date(naive - 36 * 3600_000), tz),
    offsetMinutes(new Date(naive + 36 * 3600_000), tz),
    offsetMinutes(new Date(naive), tz),
  ]);
  const matches: number[] = [];
  for (const off of offsets) {
    const candidate = naive - off * 60_000;
    const w = wallClock(new Date(candidate), tz);
    if (Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) === naive) matches.push(candidate);
  }
  matches.sort((a, b) => a - b);
  if (matches.length >= 1) {
    return { instant: new Date(matches[0]), ambiguous: matches.length > 1, skipped: false };
  }
  // Gap: interpret with the offset before the transition, which lands after the gap.
  const before = offsetMinutes(new Date(naive - 36 * 3600_000), tz);
  return { instant: new Date(naive - before * 60_000), ambiguous: false, skipped: true };
}

/** Business day string -> Date at UTC midnight (the representation of a SQL DATE in Prisma). */
export function dayToDate(day: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`invalid business day: ${day}`);
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) {
    throw new Error(`invalid business day: ${day}`);
  }
  return date;
}

/** Date at UTC midnight (SQL DATE) -> "YYYY-MM-DD". */
export function dateToDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isValidDay(day: string): boolean {
  try {
    dayToDate(day);
    return true;
  } catch {
    return false;
  }
}

export function addDays(day: string, n: number): string {
  const d = dayToDate(day);
  d.setUTCDate(d.getUTCDate() + n);
  return dateToDay(d);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

const HU_MONTHS = [
  "január",
  "február",
  "március",
  "április",
  "május",
  "június",
  "július",
  "augusztus",
  "szeptember",
  "október",
  "november",
  "december",
];
const HU_WEEKDAYS = ["vasárnap", "hétfő", "kedd", "szerda", "csütörtök", "péntek", "szombat"];

/** "2026. október 15." */
export function formatDayLong(day: string): string {
  const d = dayToDate(day);
  return `${d.getUTCFullYear()}. ${HU_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}.`;
}

export function weekdayName(day: string): string {
  return HU_WEEKDAYS[dayToDate(day).getUTCDay()];
}
