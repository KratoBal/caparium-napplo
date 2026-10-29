"use client";

// The helper's switch in the header (card 8b22c3c2). It turns the figure and its bubble off; the urgent
// notices stay (Helper.tsx shows them in a small strip).
import { useEffect, useState } from "react";
import { readOff, SWITCH_EVENT, writeOff } from "@/lib/helper-switch";

export function HelperToggle() {
  const [off, setOff] = useState<boolean | null>(null);
  useEffect(() => {
    setOff(readOff());
    const on = (e: Event) => setOff((e as CustomEvent<boolean>).detail);
    window.addEventListener(SWITCH_EVENT, on);
    return () => window.removeEventListener(SWITCH_EVENT, on);
  }, []);
  // before the stored state is read the switch is not shown: a click could flip the wrong way
  if (off === null) return null;
  // the switch the other pages use (Lili 2026-10-29): the same `switch` input, with a small label
  return (
    <label className="switch-wrap helper-toggle no-print">
      <input className="switch" type="checkbox" role="switch" checked={!off} onChange={() => writeOff(!off)} aria-label="Segítő" data-testid="helper-toggle" />
      <span className="helper-toggle-label">Segítő</span>
    </label>
  );
}
