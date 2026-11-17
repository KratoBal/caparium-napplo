"use client";

import { useSyncExternalStore } from "react";

// False in the server's markup and during hydration, true once React has taken the page over (card 51426546, measured on #245): on a
// slow tablet a controlled box can be ticked in the markup before that, the box shows the tick, the component's state never gets it,
// and hydration takes it off again (a day's feed vanished, or would not have been saved with the list). A box disabled until then
// cannot be ticked in vain. The server snapshot is false, so the hydration matches; the same pattern as useIsPhone.
const subscribe = () => () => {};

export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
