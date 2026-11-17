// The water grid's React key (card 7fdbf78f, task t-20261117-caparium-racs-banner). The grid keeps its own state (drafts,
// the save's banner); a change of key remounts it and drops that state. A real change of round (Új kör, 1 -> 2) must
// remount it; the day's FIRST save, which creates round 1 out of "no round yet", must not: with `?? 0` the refresh after
// it changed the key and took the "Minden érték mentve." banner away a moment after it showed. "No round yet" is round 1.
export function gridKey(groupId: string, day: string, roundSeq: number | null | undefined): string {
  return `${groupId}:${day}:${roundSeq ?? 1}`;
}
