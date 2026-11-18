// The Hungarian left in the English view on Lili's screenshots of 2026-11-18 (msg 1572600569607094394 and 1572601210362658827,
// acrobot 55913 and 55919; exchange/caparium-lili-forditas-keresek-2026-11-18.md). Mine, for keys her sheets have no English for, in
// the words the sheets already use ("Tank", "fasting day", "assistant"). Her measure: with these the English view is enough for the
// students, and no further round comes until she asks. Under the sheets, through PROPOSALS (proposals.ts).
const SOURCE = "Lili 2026-11-18 13:13-13:15 UTC screenshots (acrobot 55913): Hungarian left in the English view, proposed by nautilus";

export const LILI_PROPOSALS: Readonly<Record<string, { en: string; source: string }>> = {
  Nyitott: { en: "Open", source: SOURCE },
  semmi: { en: "nothing", source: SOURCE },
  "Készlet: {amount} {unit}": { en: "Stock: {amount} {unit}", source: SOURCE },
  "adminisztrátor": { en: "administrator", source: SOURCE },
  akvarista: { en: "aquarist", source: SOURCE },
  "Napi mérés ma: {done} / {total} medence, mind mérve.": { en: "Daily WQ today: {done} / {total} tanks, all measured.", source: SOURCE },
  "Napi mérés ma: {done} / {total} medence, {left} még vár.": { en: "Daily WQ today: {done} / {total} tanks, {left} still to go.", source: SOURCE },
  "Ki eszik ma ({n} állat)": { en: "Who eats today ({n} animals)", source: SOURCE },
  "Koplalónapos állatok ({n}): nincsenek a napi listán, a lista lezárásakor automatikusan koplalónapot kapnak; csak a kivételt kell rögzíteni (például vitamin vagy gyógyszer)":
    {
      en: "Animals on a fasting day ({n}): not on the daily list, they get a fasting day automatically when the list is closed; only an exception needs recording (for example vitamin or medicine)",
      source: SOURCE,
    },
};
