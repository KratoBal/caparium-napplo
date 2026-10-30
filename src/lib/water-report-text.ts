// The words of the water report that more than one place must agree on: the PDF's main title and the mail subject are
// one text, and the attachment's file name is the same words with the ISO day (Lili 2026-10-30: the dates read dotted, a
// file name keeps the sortable ISO shape and has no room for the closing dot before ".pdf") (Lili 2026-10-26, Caparium channel msg 1564350735267921991, Balázs "Mehet"
// 1564352369205186581). No database here, so a unit test can hold them.
import { formatDay } from "./time";

/** "Cápasuli vízmérés - 2026.10.26.": the PDF title and the mail subject. */
export const waterReportTitle = (day: string) => `Cápasuli vízmérés - ${formatDay(day)}`;

/** "Cápasuli vízmérés - 2026-10-26.pdf": the attachment's file name, the day in the ISO shape. */
export const waterReportFileName = (day: string) => `Cápasuli vízmérés - ${day}.pdf`;

/** The letter's body, signed with the name of the user who pressed the button. */
export const waterReportMailText = (senderName: string) =>
  `Sziasztok!\n\nKüldöm a heti vízmérések eredményeit.\n\nÜdv,\n${senderName.replace(/\s+/g, " ").trim()}`.trimEnd();
