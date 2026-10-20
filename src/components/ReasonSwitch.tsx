"use client";

// The reason switch on the client (caparium-indoklas-ki, src/lib/reasons.ts): the Shell reads the setting on the
// server and every form below it asks here whether to show a reason field or ask for one. Off: no field, no prompt;
// the server does not require one either. The default is off, as on the server.

import { createContext, useContext } from "react";

const ReasonsOn = createContext(false);

export function ReasonProvider({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <ReasonsOn.Provider value={on}>{children}</ReasonsOn.Provider>;
}

/** Whether the forms ask for a reason. */
export function useReasonsOn(): boolean {
  return useContext(ReasonsOn);
}

/**
 * The reason of an invalidation, a rejection or a reopening. On: the prompt as before (cancel or fewer than three
 * characters stops). Off: only a confirmation, so a stray click still changes nothing. null: stopped.
 */
export function askReason(on: boolean, question: string, confirmation: string): { reason?: string } | null {
  if (!on) return window.confirm(confirmation) ? {} : null;
  const r = window.prompt(question);
  if (!r || r.trim().length < 3) return null;
  return { reason: r.trim() };
}
