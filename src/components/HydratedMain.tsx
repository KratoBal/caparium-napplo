"use client";

import { useTr } from "./LangProvider";
import { useHydrated } from "./useHydrated";

/**
 * The page's main area, inert until React has taken the page over (card 51426546, measured on #246). On a slow tablet the markup shows
 * first, and a value typed into a controlled field then (a water cell) showed in the field, never reached the form's state, and the
 * Mentés after it said "Minden érték mentve." with nothing saved. Inert, the area takes no click, focus or typing in that moment; the
 * menu around it is plain links and works. The server's markup carries the attribute too, so the hydration matches.
 *
 * A PAGE THAT NEVER HYDRATES (barracuda on #246, measured on #247): a script error or blocked scripts would leave the area inert for
 * good, a page that looks ready and ignores every tap. The server's markup carries a message for that; the CSS shows it only after a
 * few seconds (.hydration-failed), and hydration removes it before that, so a normal load never shows it.
 */
export function HydratedMain({ className, children }: { className: string; children: React.ReactNode }) {
  const hydrated = useHydrated();
  const tr = useTr();
  return (
    <>
      {/* beside the main area, not in it: inert content is hidden from screen readers too, and an alert there would be silent */}
      {!hydrated && (
        <p className="banner banner-error hydration-failed" role="alert" data-testid="hydration-failed">
          {tr("Az oldal nem töltődött be teljesen, ezért most nem fogad bevitelt. Frissítsd az oldalt; ha így marad, szólj az adminisztrátornak.")}
        </p>
      )}
      <main className={className} inert={!hydrated} data-testid="main">
        {children}
      </main>
    </>
  );
}
