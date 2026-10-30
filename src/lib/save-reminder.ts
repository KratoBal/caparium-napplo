// "NE FELEJTSD EL MENTENI!" (card 0d617f0c; Lili 2026-10-30 11:39 UTC: "ha érzékeli a rendszer, hogy pl a
// vízméréseknél már minden ki van töltve, hogy a kis segéd szóljon, hogy ne felejtsd el menteni/lezárni", and "csak addig,
// amíg nem lesz rutin"). The helper speaks when every field of the form is filled but something is not saved, and either
// nothing happened for REMINDER_IDLE_MS or the page is about to be left. An admin switches it off in Beállítások
// (setting save_reminder); a viewer who switched the whole helper off does not see it either.
//
// The form and the figure are two components (MeasurementGrid, Helper), so the form announces with a window event, as the
// helper's own switch does (helper-switch.ts). Pure of React here, so the unit tests drive it with a fake clock.

export const REMINDER_TEXT = "Ne felejtsd el menteni!";
export const REMINDER_EVENT = "caparium-mentes-emlekezteto";
/** How long a filled, unsaved form may sit quietly before the helper speaks. */
export const REMINDER_IDLE_MS = 60_000;

/** Every field filled: each key has a value, typed or saved; an empty form is not a filled one. */
export function formComplete(keys: readonly string[], valueOf: (key: string) => string | undefined): boolean {
  return keys.length > 0 && keys.every((k) => (valueOf(k) ?? "").trim() !== "");
}

/** Whether the reminder is due: on, a filled form, something unsaved. */
export function reminderWanted(state: { on: boolean; complete: boolean; unsaved: number }): boolean {
  return state.on && state.complete && state.unsaved > 0;
}

export type ReminderClock = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

/**
 * The idle timer: `poke()` on every input restarts it while the reminder is wanted; when it runs out, `speak(true)`.
 * `update(wanted)` follows the form: no longer wanted (saved, a field emptied, switched off) silences the helper and stops
 * the timer. `leaving()` speaks at once, for the moment the page is about to be left with the form in that state.
 */
export function reminderTimer(speak: (on: boolean) => void, clock: ReminderClock, idleMs = REMINDER_IDLE_MS) {
  let wanted = false;
  let handle: unknown = null;
  let spoken = false;
  const stop = () => {
    if (handle !== null) clock.clearTimeout(handle);
    handle = null;
  };
  const start = () => {
    stop();
    handle = clock.setTimeout(() => {
      handle = null;
      spoken = true;
      speak(true);
    }, idleMs);
  };
  return {
    update(next: boolean) {
      if (next === wanted) return;
      wanted = next;
      if (wanted) start();
      else {
        stop();
        if (spoken) speak(false);
        spoken = false;
      }
    },
    poke() {
      if (wanted) start();
    },
    leaving() {
      if (!wanted) return;
      stop();
      spoken = true;
      speak(true);
    },
    dispose() {
      stop();
    },
  };
}

/** The form's announcement: true shows the reminder, false takes it back. */
export function announceReminder(on: boolean, win: Pick<Window, "dispatchEvent"> = window): void {
  win.dispatchEvent(new CustomEvent<boolean>(REMINDER_EVENT, { detail: on }));
}
