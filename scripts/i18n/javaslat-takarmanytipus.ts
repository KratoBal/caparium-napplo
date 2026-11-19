// The seeded feed types' English (t-20261119-caparium-forditas-takarmanytipus, acrobot 57188): mine, the five names not in Lili's first sheet
// ("Egyéb" is in it), each to be checked by her. Under the sheets, through PROPOSALS (proposals.ts): a later sheet row with her English
// wins, and the import names this line as replaced, to be deleted.
const SOURCE = "JAVASLAT (nautilus, 2026-11-19, acrobot 57188): the seeded feed types' names, not in Lili's first sheet, on the list for her to check";

export const TAKARMANYTIPUS_PROPOSALS: Readonly<Record<string, { en: string; source: string }>> = {
  "Apró és folyékony takarmány": { en: "Small and liquid feed", source: SOURCE },
  "Kagylók": { en: "Bivalves", source: SOURCE },
  "Lábasfejűek": { en: "Cephalopods", source: SOURCE },
  "Rákok": { en: "Crustaceans", source: SOURCE },
  "Tengeri halak": { en: "Marine fish", source: SOURCE },
};
