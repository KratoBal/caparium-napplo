import { describe, expect, it } from "vitest";
import { intakePdfFrom, intakeTitle, RETURNED_INK } from "@/lib/exports/intake-pdf";
import type { IntakeReport } from "@/lib/exports/intake-report";
import { readPdfColors } from "../support/pdf-colors";
import { readPdfLines } from "../support/pdf-readback";

// Lili 2026-10-30 (Takarmányhűtő): the printable report; a delivery sent back in red. Built from a sample, so it runs without a database.
const sample: IntakeReport = {
  from: "2026-10-01",
  to: "2026-10-30",
  intake: [
    { day: "2026-10-12", type: "Rákok", feed: "Pecten jacobaeus", quantity: "5", unit: "kg", note: "nyitó készlet", returned: false },
    { day: "2026-10-14", type: "Rákok", feed: "Loligo sp.", quantity: "10", unit: "kg", note: "nem megfelelő", returned: true },
  ],
  taken: [{ feed: "Pecten jacobaeus", unit: "kg", quantity: "1,10" }],
  closing: [{ feed: "Pecten jacobaeus", unit: "kg", level: "3,90", negative: false, low: false }],
};

describe("the Cápasuli takarmányegyenleg PDF", () => {
  it("reads back with its accents and its three sections, titled and dated as Lili asked", async () => {
    const lines = await readPdfLines(new Uint8Array(await intakePdfFrom(sample)));
    expect(lines[0]).toBe("Cápasuli takarmányegyenleg: 2026.10.01. – 2026.10.30.");
    // one dot after a date, never two (the period line read "október 30..")
    expect(lines.some((l) => l.startsWith("Időszak: 2026.10.01. – 2026.10.30. A visszaküldött"))).toBe(true);
    expect(lines.some((l) => /\.\./.test(l))).toBe(false);
    // no hyphenated date anywhere in the document
    expect(lines.some((l) => /\d{4}-\d{2}-\d{2}/.test(l))).toBe(false);
    for (const s of ["Bevételek", "Kivételek takarmányonként", "Záró készlet (2026.10.30. végén)"]) expect(lines.some((l) => l.includes(s)), s).toBe(true);
    expect(lines.some((l) => l.includes("2026.10.12.") && l.includes("Pecten jacobaeus") && l.includes("5 kg") && l.includes("nyitó készlet"))).toBe(true);
    expect(lines.some((l) => l.includes("2026.10.14.") && l.includes("Loligo sp.") && l.includes("10 kg") && l.includes("igen"))).toBe(true);
    expect(lines.some((l) => l.includes("Pecten jacobaeus") && l.includes("1,10 kg"))).toBe(true);
    expect(lines.some((l) => l.includes("Pecten jacobaeus") && l.includes("3,90 kg"))).toBe(true);
  });

  it("the header labels stay whole and the rows do not run into each other: a long type or note makes the row taller", async () => {
    const long: IntakeReport = {
      ...sample,
      intake: [
        { day: "2026-10-30", type: "Tengeri halak és más hosszú típusnév", feed: "Scomber scombrus", quantity: "30", unit: "kg", note: "hosszú megjegyzés, ami biztosan több sorba törik a keskeny oszlopban", returned: false },
        { day: "2026-10-29", type: "Kagylók", feed: "Pecten jacobaeus", quantity: "5", unit: "kg", note: "", returned: false },
      ],
    };
    const lines = await readPdfLines(new Uint8Array(await intakePdfFrom(long)));
    // the header row holds every label in one line, "Visszaküldve" not broken ("Visszaküldv" / "e")
    expect(lines.some((l) => l.includes("Dátum") && l.includes("Mennyiség") && l.includes("Visszaküldve"))).toBe(true);
    // the second row's date is on its own line: nothing of the first row's wrapped cells shares its height
    const second = lines.find((l) => l.includes("2026.10.29."))!;
    expect(second).toBeDefined();
    expect(second).toBe("2026.10.29. Kagylók Pecten jacobaeus 5 kg");
    // the wrapped cells of the first row stand on lines of their own, above the second row
    const iFirst = lines.findIndex((l) => l.includes("2026.10.30."));
    const iSecond = lines.indexOf(second);
    expect(iSecond - iFirst).toBeGreaterThanOrEqual(2);
    expect(lines.slice(iFirst, iSecond).join(" ")).toContain("biztosan");
    // and the band of the next section is below the last row
    expect(lines.findIndex((l) => l.includes("Kivételek takarmányonként"))).toBeGreaterThan(iSecond);
  });

  it("only the returned delivery's texts are red", async () => {
    const colors = await readPdfColors(new Uint8Array(await intakePdfFrom(sample)));
    const red = colors.texts.filter((t) => t.color === RETURNED_INK).map((t) => t.text);
    expect(red.length).toBeGreaterThan(0);
    expect(red.some((t) => t.includes("Loligo"))).toBe(true);
    expect(red.some((t) => t.includes("Pecten"))).toBe(false);
    expect(red.some((t) => t.includes("nyitó"))).toBe(false);
  });

  it("with nothing in the period it says so in each section instead of printing an empty table", async () => {
    const lines = await readPdfLines(new Uint8Array(await intakePdfFrom({ from: "2026-10-01", to: "2026-10-01", intake: [], taken: [], closing: [] })));
    expect(lines[0]).toBe("Cápasuli takarmányegyenleg: 2026.10.01.");
    for (const s of ["Az időszakban nem érkezett takarmány.", "Az időszakban nem volt kivétel.", "Nincs követett készlet."]) expect(lines.some((l) => l.includes(s)), s).toBe(true);
    expect(intakeTitle({ from: "2026-10-01", to: "2026-10-02" })).toBe("Cápasuli takarmányegyenleg: 2026.10.01. – 2026.10.02.");
  });
});
