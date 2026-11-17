// THE EATING LOG'S DRAFTS ACROSS A REFRESH (Lili 2026-11-17 09:13 UTC, msg 1572177794304188527): "0 sor mentve, 4 nem: …: Az
// állapot időközben megváltozott." The page refreshed only when at least one row went up, so a save in which every row
// was refused left the stale ids and versions on the page, and every retry was refused the same way until a manual
// reload. The page now refreshes after every save; a row whose server state changed starts again from it, EXCEPT a row
// whose save was just refused: what was typed into it stays, and saving again writes it over the newer state.

/** The rows whose draft starts again from the server: the changed ones, but not the ones just refused. */
export function rowsToReset(changed: readonly string[], refused: ReadonlySet<string>): string[] {
  return changed.filter((id) => !refused.has(id));
}

/** The sentence after a save that had refused rows: the typed values stay, and the page holds the newer state. */
export function refusedNote(failed: number): string | null {
  return failed > 0 ? " A frissebb állapot betöltve; a be nem mentett sorokban a beírt érték megmaradt, újra mentve azt írja be." : null;
}
