// The words of the water report that more than one place must agree on: the PDF's main title, the attachment's file
// name and the mail subject are one text (Lili 2026-10-26, Caparium channel msg 1564350735267921991, Balázs "Mehet"
// 1564352369205186581). No database here, so a unit test can hold them.

/** "Cápasuli vízmérés - 2026-10-26": the PDF title, the file name (plus ".pdf") and the mail subject. */
export const waterReportTitle = (day: string) => `Cápasuli vízmérés - ${day}`;

/** The letter's body, signed with the name of the user who pressed the button. */
export const waterReportMailText = (senderName: string) =>
  `Sziasztok!\n\nKüldöm a heti vízmérések eredményeit.\n\nÜdv,\n${senderName.replace(/\s+/g, " ").trim()}`.trimEnd();
