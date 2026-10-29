// The words of the monthly ZIMS package's mail. Plain, replaceable text: Lili gives the final wording later
// (acrobot msg 38074), so it lives here alone, with no database, and a unit test holds the shape.

const MONTH_NAMES = ["január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember", "október", "november", "december"];

/** "2026. október" for the month starting on `from` (YYYY-MM-DD). */
export const zimsMonthLabel = (from: string) => `${from.slice(0, 4)}. ${MONTH_NAMES[Number(from.slice(5, 7)) - 1]}`;

export const zimsPackageSubject = (from: string) => `Cápasuli ZIMS-csomag - ${zimsMonthLabel(from)}`;

export const zimsPackageText = (from: string, fileNames: string[]) =>
  `Sziasztok!\n\nA(z) ${zimsMonthLabel(from)} havi ZIMS-csomagja mellékelve, medencénként egy CSV-fájl:\n${fileNames.map((n) => `- ${n}`).join("\n")}\n\n` +
  "A csomag előnézet: a ZIMS-be beadottnak a Naplóban az adminisztrátor jelöli.";

/** The month got no package: a warning, because in this zoo the water is logged every day. */
export const zimsWarningSubject = (from: string) => `FIGYELMEZTETÉS: nincs ZIMS-csomag - ${zimsMonthLabel(from)}`;

export const zimsWarningText = (from: string, why: string) =>
  `Sziasztok!\n\nA(z) ${zimsMonthLabel(from)} hónapra nem készült ZIMS-csomag: ${why}\n\n` +
  "Naponta naplózunk, ezért ez hibának számít. Az Export oldalon látszik a részlet.";
