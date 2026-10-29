// The helper's on/off switch (AST-01; in the header since Lili 2026-10-27 13:25 UTC, card 8b22c3c2): a
// viewer's convenience, kept in localStorage. The header switch and the corner figure are two components,
// so a change is announced with a window event, and each reads the same key.

export const OFF_KEY = "caparium-segito-ki";
export const SWITCH_EVENT = "caparium-segito-kapcsolo";

export function readOff(): boolean {
  try {
    return localStorage.getItem(OFF_KEY) === "1";
  } catch {
    return false; // no storage: the helper stays on
  }
}

export function writeOff(off: boolean): void {
  try {
    if (off) localStorage.setItem(OFF_KEY, "1");
    else localStorage.removeItem(OFF_KEY);
  } catch {
    /* not stored: it is back on the next page */
  }
  window.dispatchEvent(new CustomEvent<boolean>(SWITCH_EVENT, { detail: off }));
}
