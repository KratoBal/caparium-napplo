"use client";

import { useHydrated } from "./useHydrated";

/**
 * The page's main area, inert until React has taken the page over (card 51426546, measured on #246). On a slow tablet the markup shows
 * first, and a value typed into a controlled field then (a water cell) showed in the field, never reached the form's state, and the
 * Mentés after it said "Minden érték mentve." with nothing saved. Inert, the area takes no click, focus or typing in that moment; the
 * menu around it is plain links and works. The server's markup carries the attribute too, so the hydration matches.
 */
export function HydratedMain({ className, children }: { className: string; children: React.ReactNode }) {
  const hydrated = useHydrated();
  return (
    <main className={className} inert={!hydrated} data-testid="main">
      {children}
    </main>
  );
}
