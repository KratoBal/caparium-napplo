// THE REASON SWITCH (caparium-indoklas-ki; Balázs 2026-10-20 19:21 UTC, msg 1562184077489209436: "egyelore ezt az
// indoklas dolgot kapcsoljuk ki"). Every rule that asks for a reason (an earlier or closed day, a correction, an
// invalidation, a reopening, a rejection) asks through here. Off (the default, SETTING_DEFAULTS.reason_required):
// no reason is required and the forms do not show the field; the change itself is still audited (who, when, what),
// only without a reason. A setting row "true" brings every rule back exactly as it was. The reasons already given stay.

import { AppError } from "./errors";
import type { Tx } from "./db";
import { getSetting } from "./master";

/** Whether the reasons are required now. An operational switch: read at the real now, not at a business time. */
export async function reasonsRequired(tx: Tx): Promise<boolean> {
  return (await getSetting(tx, "reason_required")) === "true";
}

/**
 * REASON_REQUIRED when the rule needs a reason (`needed`), none came, and the switch is on. Off, or with a reason,
 * it passes; the reason given is stored either way.
 */
export async function requireReason(tx: Tx, needed: boolean, reason: string | null | undefined, message: string): Promise<void> {
  if (!needed || reason) return;
  if (await reasonsRequired(tx)) throw new AppError(422, "REASON_REQUIRED", message);
}
