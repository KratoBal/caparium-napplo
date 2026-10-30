// What the helper already shows follows the page's data (barracuda on #109). A save refreshes the page
// (router.refresh), the alert's text changes (a pool measured, a level moved) or the alert goes (the last
// pool measured), but its key stays, so it does not speak again: what is already shown must not stay as it
// was, saying a measurement is missing after it was recorded. Pure, so a unit test reaches it.

/** `reminder`: "Ne felejtsd el menteni!" (card 0d617f0c), announced by the form, not by the page's data */
export type Notice = { kind: "alert" | "greeting" | "reminder"; text: string };

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

/**
 * The name the figure greets with (Lili 2026-10-29, acrobot 38178): the login name (Lili, Vivi, Niki), its first letter
 * capital as people write a name (login names are stored in lower case); the full name where there is none.
 */
export function greetingName(user: { loginId?: string | null; fullName: string }): string {
  const login = (user.loginId ?? "").trim();
  return login ? login.charAt(0).toLocaleUpperCase("hu") + login.slice(1) : user.fullName.trim();
}
