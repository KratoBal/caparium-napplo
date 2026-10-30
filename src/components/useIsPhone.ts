"use client";

import { useSyncExternalStore } from "react";

// The phone breakpoint of the CSS (max-width: 720px), for the few places that render a different element on a phone, not only
// a different layout (the feeding sheet's collapsed cards: a button on the name). The server and the first client render say
// "not a phone", so nothing changes for the tablet and the desktop and the hydration matches.
const QUERY = "(max-width: 720px)";

function subscribe(onChange: () => void) {
  const m = window.matchMedia(QUERY);
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
}

export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
