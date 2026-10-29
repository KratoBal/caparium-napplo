// What the helper already shows follows the page's data (barracuda on #109). A save refreshes the page
// (router.refresh), the alert's text changes (a pool measured, a level moved) or the alert goes (the last
// pool measured), but its key stays, so it does not speak again: what is already shown must not stay as it
// was, saying a measurement is missing after it was recorded. Pure, so a unit test reaches it.

export type Notice = { kind: "alert" | "greeting"; text: string };

/** The notice on show after the data changed: an alert one takes the new text, or goes with the alert. */
export function followNotice(shown: Notice | null, alert: string | undefined): Notice | null {
  if (shown?.kind !== "alert") return shown;
  return alert ? { kind: "alert", text: alert } : null;
}

/** The open bubble's answer after the data changed: if it was the alert, it follows the alert. */
export function followAnswer(answer: string | null, previousAlert: string | undefined, alert: string | undefined): string | null {
  if (previousAlert === undefined || answer !== previousAlert) return answer;
  return alert ?? null;
}
