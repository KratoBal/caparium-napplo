// The proposals, UNDER the sheets (barracuda on #259): my English for keys Lili's sheets have no English for yet, each with its source,
// one file a round. The import writes one only where no sheet row is filled, and reports the ones a sheet has filled since, to be deleted.
// A decision of Lili's that must win over a sheet is no proposal: it goes in overrides.ts.
import { NAPLO_PROPOSALS } from "./javaslat-naplo";
import { SERVER_PROPOSALS } from "./javaslat-szerver";

export const PROPOSALS: Readonly<Record<string, { en: string; source: string }>> = {
  ...SERVER_PROPOSALS,
  ...NAPLO_PROPOSALS,
};
