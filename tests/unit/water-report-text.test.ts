// The water report's words (Lili 2026-10-26, Caparium channel msg 1564350735267921991, point 1): the PDF title, the
// file name and the mail subject are one text, and the letter is signed by the user who sends it.
import { describe, expect, it } from "vitest";
import { waterReportFileName, waterReportMailText, waterReportTitle } from "@/lib/water-report-text";

describe("water report words", () => {
  it("the title reads the day dotted, the file name keeps the ISO day", () => {
    expect(waterReportTitle("2026-10-26")).toBe("Cápasuli vízmérés - 2026.10.26.");
    expect(waterReportFileName("2026-10-26")).toBe("Cápasuli vízmérés - 2026-10-26.pdf");
  });

  it("the letter greets, says what it carries and is signed by the sender", () => {
    expect(waterReportMailText("Teszt Akvarista")).toBe("Sziasztok!\n\nKüldöm a heti vízmérések eredményeit.\n\nÜdv,\nTeszt Akvarista");
  });

  it("a name with stray spaces or a line break stays one tidy line; no name leaves the signature word alone", () => {
    expect(waterReportMailText("  Kis \n Béla ").endsWith("Üdv,\nKis Béla")).toBe(true);
    expect(waterReportMailText("")).toBe("Sziasztok!\n\nKüldöm a heti vízmérések eredményeit.\n\nÜdv,");
  });
});
