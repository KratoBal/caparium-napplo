"use client";

import { useEffect, useRef } from "react";
import { attachLeaveWarning } from "@/lib/leave-warning";

/**
 * Leaving the page or an in-app link with unsaved values asks `message` first (the rule of #38, #45 and #51). The
 * caller passes how many values are unsaved at THIS render; the listeners are attached once and read the latest
 * count, so a change does not re-attach them. `message` is read when the page mounts: pass a constant.
 *
 * Returns the ref that holds the count, for a caller that asks the same question elsewhere (a new round, say).
 */
export function useLeaveWarning(unsavedCount: number, message: string) {
  const unsavedRef = useRef(0);
  unsavedRef.current = unsavedCount;
  useEffect(() => attachLeaveWarning(() => unsavedRef.current, message, window, document), []); // eslint-disable-line react-hooks/exhaustive-deps
  return unsavedRef;
}
