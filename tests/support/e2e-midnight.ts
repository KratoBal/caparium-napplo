// The e2e suite takes about three minutes (six with a retry), and many tests compute "today" or "yesterday" in Budapest
// while the server computes its own business day from its clock. A run that crosses Budapest midnight tests a day that
// changes under it: #83's first CI run started its desktop half at 23:00:05 UTC, 00:00 CET, and the yesterday/today tests
// failed (card c94d26ba). The server has no test clock, and a fake one in the production build is not worth it, so a run
// that would start close to midnight waits until just after it.

/** The e2e run never starts within this many minutes before Budapest midnight. */
export const MIDNIGHT_WINDOW_MIN = 12;

/** Minutes past Budapest midnight, from the zone's own wall clock (CET and CEST alike). */
function budapestMinuteOfDay(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Budapest", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return n("hour") * 60 + n("minute") + n("second") / 60;
}

/** How long to wait before the run: 0, or until one minute past the coming Budapest midnight. */
export function waitBeforeRun(now: Date, windowMin = MIDNIGHT_WINDOW_MIN): number {
  const toMidnight = 24 * 60 - budapestMinuteOfDay(now);
  return toMidnight > windowMin ? 0 : Math.ceil((toMidnight + 1) * 60_000);
}

export default async function globalSetup(): Promise<void> {
  const ms = waitBeforeRun(new Date());
  if (ms === 0) return;
  console.log(`e2e: Budapest midnight is ${Math.round(ms / 60_000)} min away; waiting so the run does not cross it`);
  await new Promise((resolve) => setTimeout(resolve, ms));
}
