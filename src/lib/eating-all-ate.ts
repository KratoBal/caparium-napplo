// "Mindenki evett" (Lili 2026-11-11 09:14 UTC, msg 1570003887203688529): one click marks every row of the day's list that is
// still empty as EATEN. Kept apart from the component so the rule ("never overwrite a filled row") is tested on its own.

export type AllAteRow = { animalId: string; selected: boolean; manualStatus: boolean };

/**
 * The rows the button fills: on the day's list, no manual status, and nothing picked in the unsaved draft either. A row
 * filled by someone (saved, or picked and not yet saved) is left as it is; an automatic status does not count as filled
 * (the save replaces it, as a single row's save does).
 */
export function allAteTargets(rows: readonly AllAteRow[], drafts: Readonly<Record<string, { state: string } | undefined>>): string[] {
  return rows.filter((r) => r.selected && !r.manualStatus && !drafts[r.animalId]?.state).map((r) => r.animalId);
}

/**
 * Where the button stands (Lili 2026-11-11 10:38 UTC, via acrobot 46859): at the TOP, next to the day picker, because she
 * presses it first and then corrects the exceptions; the Save button stays at the bottom. The day picker is in the page's
 * server-rendered toolbar, the button's state in the eating table, so the page leaves an empty slot with this id and the
 * table renders the button into it. Here, not in the client module: the page cannot import a value from a client module.
 */
export const EATING_TOP_ACTIONS_ID = "eating-top-actions";
