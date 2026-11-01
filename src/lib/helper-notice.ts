// What the helper already shows follows the page's data (barracuda on #109). A save refreshes the page
// (router.refresh), the alert's text changes (a pool measured, a level moved) or the alert goes (the last
// pool measured), but its key stays, so it does not speak again: what is already shown must not stay as it
// was, saying a measurement is missing after it was recorded. Pure, so a unit test reaches it.

import { dayToDate } from "./time";

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

/**
 * Who greets after the login (Lili 2026-11-01 12:24 UTC, acrobot 39592: "eddig minden nap az Antennarius jött"): one of the
 * six greeting pictures, both figures' udv-1..3, by the business day, so the greeter changes every day and stays the same all
 * day. Before this the page's own figure greeted (a water user's is always Antennarius) and only its picture was drawn at
 * random. The order alternates the figures, so two days in a row never bring the same one. Only the greeting: after it the
 * page's own helper is back, with its questions.
 */
export const GREETERS = [
  { slug: "antennarius", name: "Antennarius" },
  { slug: "zebracapa", name: "Zebracápa" },
] as const;
export const GREETING_PICTURES = 3;
export type Greeter = { slug: (typeof GREETERS)[number]["slug"]; name: string; picture: number };

export function greetingFigure(day: string): Greeter {
  const n = Math.round(dayToDate(day).getTime() / 86_400_000);
  const total = GREETERS.length * GREETING_PICTURES;
  const i = ((n % total) + total) % total;
  return { ...GREETERS[i % GREETERS.length], picture: 1 + Math.floor(i / GREETERS.length) };
}
