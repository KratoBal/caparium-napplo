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

describe("the Takarmányhűtő PDF", () => {
  it("reads back with its accents (ű, ő) and its three sections", async () => {
    const lines = await readPdfLines(new Uint8Array(await intakePdfFrom(sample)));
    expect(lines[0]).toBe("Takarmányhűtő: 2026-10-01 – 2026-10-30");
    for (const s of ["Bevételek", "Kivételek takarmányonként", "Záró készlet (2026-10-30 végén)"]) expect(lines.some((l) => l.includes(s)), s).toBe(true);
    expect(lines.some((l) => l.includes("Pecten jacobaeus") && l.includes("5 kg") && l.includes("nyitó készlet"))).toBe(true);
    expect(lines.some((l) => l.includes("Loligo sp.") && l.includes("10 kg") && l.includes("igen"))).toBe(true);
    expect(lines.some((l) => l.includes("Pecten jacobaeus") && l.includes("1,10 kg"))).toBe(true);
    expect(lines.some((l) => l.includes("Pecten jacobaeus") && l.includes("3,90 kg"))).toBe(true);
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
    expect(lines[0]).toBe("Takarmányhűtő: 2026-10-01");
    for (const s of ["Az időszakban nem érkezett takarmány.", "Az időszakban nem volt kivétel.", "Nincs követett készlet."]) expect(lines.some((l) => l.includes(s)), s).toBe(true);
    expect(intakeTitle({ from: "2026-10-01", to: "2026-10-02" })).toBe("Takarmányhűtő: 2026-10-01 – 2026-10-02");
  });
});
