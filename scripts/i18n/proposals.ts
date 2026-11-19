// The proposals, UNDER the sheets (barracuda on #259): my English for keys Lili's sheets have no English for yet, each with its source,
// one file a round. The import writes one only where no sheet row is filled, and reports the ones a sheet has filled since, to be deleted.
// A decision of Lili's that must win over a sheet is no proposal: it goes in overrides.ts.
import { ALLATOK_PROPOSALS } from "./javaslat-allatok";
import { BEALLITASOK_PROPOSALS } from "./javaslat-beallitasok";
import { PROFIL_PROPOSALS } from "./javaslat-profil";
import { VIZMERES_HUTOK_PROPOSALS } from "./javaslat-vizmeres-hutok";
import { EXPORT_PROPOSALS } from "./javaslat-export";
import { LILI_PROPOSALS } from "./javaslat-lili";
import { NAPLO_PROPOSALS } from "./javaslat-naplo";
import { SERVER_PROPOSALS } from "./javaslat-szerver";

type Proposals = Readonly<Record<string, { en: string; source: string }>>;

/**
 * The rounds' files by name. A key stands in exactly one of them (barracuda on #260, tests/unit/i18n-import.test.ts): spread together,
 * the last file would silently win, and a correction made in one file could be undone by another.
 */
export const PROPOSAL_FILES: Readonly<Record<string, Proposals>> = {
  "javaslat-szerver.ts": SERVER_PROPOSALS,
  "javaslat-naplo.ts": NAPLO_PROPOSALS,
  "javaslat-export.ts": EXPORT_PROPOSALS,
  "javaslat-lili.ts": LILI_PROPOSALS,
  "javaslat-allatok.ts": ALLATOK_PROPOSALS,
  "javaslat-beallitasok.ts": BEALLITASOK_PROPOSALS,
  "javaslat-vizmeres-hutok.ts": VIZMERES_HUTOK_PROPOSALS,
  "javaslat-profil.ts": PROFIL_PROPOSALS,
};

export const PROPOSALS: Proposals = Object.assign({}, ...Object.values(PROPOSAL_FILES));
