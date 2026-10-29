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
  return (
    <button className="btn btn-soft helper-toggle no-print" type="button" aria-pressed={!off} onClick={() => writeOff(!off)} data-testid="helper-toggle">
      {off ? "Segítő: ki" : "Segítő: be"}
    </button>
  );
}
