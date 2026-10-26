import type { Level } from "./permissions";

export type LifecycleEventType = "ARRIVAL" | "TRANSFER" | "GROUP_CHANGE" | "DEATH" | "RELEASE";

/**
 * Who may record an animal's lifecycle event. Lili 2026-10-26 09:51 UTC (Caparium channel msg
 * 1564214896453750805; card f67b1a06 item 7; acrobot: close the API too): the animal list is seen and
 * managed by admins only for now, so arrival, transfer, group change, death and release are all admin work.
 * This overrides the earlier rule (NY-20) that an aquarist may record the events other than an arrival.
 * `null`: allowed; otherwise the sentence for the refusal.
 */
export function lifecycleAccessProblem(level: Level, type: LifecycleEventType): string | null {
  if (level === "ADMIN") return null;
  return type === "ARRIVAL"
    ? "Új állatot (érkezést) csak adminisztrátor rögzíthet."
    : "Az állatok eseményeit (áthelyezés, csoportváltás, elhullás, kiadás) csak adminisztrátor rögzíthet.";
}

/**
 * Who may invalidate an animal's lifecycle event. Acrobot 2026-10-26 (36167, after barracuda's note on #54):
 * managing the animals is admin work, and taking a recorded event back is part of it, also for an event an
 * aquarist recorded earlier (before the events became admin work). `null`: allowed.
 */
export function lifecycleInvalidateProblem(level: Level): string | null {
  return level === "ADMIN" ? null : "Az állatok eseményeit csak adminisztrátor érvényteleníthet.";
}

