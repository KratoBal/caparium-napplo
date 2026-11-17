// THE FREEZER EXPORTS TAKE THE TRANSLATOR (t-20261117-caparium-angol-fagyaszto). The intake Excel and the report title are built from a report
// object, so a unit test reaches them without a database: with a translator every label, the sheet names and the marks come through it, and
// without one the file is the Hungarian one it always was (the integration tests and the callers that pass nothing read it). The PDF's
// streams are compressed, so its words are checked by the guard and by the title only.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { intakeWorkbook } from "@/lib/exports/intake-excel";
import { intakeTitle } from "@/lib/exports/intake-pdf";
import type { IntakeReport } from "@/lib/exports/intake-report";
import { workbookBuffer } from "@/lib/exports/xlsx-stream";

const REPORT: IntakeReport = {
  from: "2026-10-01",
  to: "2026-10-30",
  intake: [{ day: "2026-10-02", type: "Fagyasztott", feed: "Mysis", quantity: "2,5", unit: "kg", note: "kézi megjegyzés", returned: true }],
  balance: [{ feed: "Mysis", lines: [{ unit: "kg", opening: "1", received: "2,5", taken: "0,5", beforeStock: "0,2", closing: "-3", negative: true, low: false }] }],
};

// a translator that marks every text it is given, so a text that skips it shows plain
const EN = (text: string, vars?: Record<string, string | number>) => `EN ${text.replace(/\{(\w+)\}/g, (w, n: string) => (vars && n in vars ? String(vars[n]) : w))}`;

async function load(tr?: Parameters<typeof intakeWorkbook>[1]) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await workbookBuffer(intakeWorkbook(REPORT, tr))).buffer as unknown as ArrayBuffer);
  return wb;
}
const row = (ws: ExcelJS.Worksheet, n: number) => (ws.getRow(n).values as unknown[]).slice(1).map((v) => (v instanceof Date ? "date" : String(v ?? "")));

describe("the intake Excel and its title with a translator", () => {
  it("the sheet names, the header rows, the mark and the balance labels all come through the translator; the user data does not", async () => {
    const wb = await load(EN);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["EN Bevételek", "EN Egyenleg"]);
    const intake = wb.getWorksheet("EN Bevételek")!;
    expect(row(intake, 3)).toEqual(["EN Dátum", "EN Takarmány típusa", "EN Takarmány", "EN Mennyiség", "EN Mértékegység", "EN Megjegyzés", "EN Visszaküldve"]);
    // data row: the type, the feed and the note are the user's own, the returned mark is the system's
    expect(row(intake, 4)).toEqual(["date", "Fagyasztott", "Mysis", "2.5", "kg", "kézi megjegyzés", "EN igen"]);
    const balance = wb.getWorksheet("EN Egyenleg")!;
    expect(row(balance, 4)).toEqual(["EN Mértékegység", "EN Nyitó", "EN Bevétel", "EN Kivétel", "EN Készlet előtti kivétel", "EN Záró", "EN Jelzés"]);
    expect(row(balance, 5).at(-1)).toBe("EN negatív készlet");
    expect(String(balance.getRow(1).getCell(1).value)).toBe("EN Cápasuli takarmányegyenleg: 2026.10.01. – 2026.10.30.");
  });

  it("the title of the document is built with the translator, and the Hungarian title is what the callers without one get", () => {
    expect(intakeTitle(REPORT, EN)).toBe("EN Cápasuli takarmányegyenleg: 2026.10.01. – 2026.10.30.");
    expect(intakeTitle(REPORT)).toBe("Cápasuli takarmányegyenleg: 2026.10.01. – 2026.10.30.");
  });

  it("without a translator the Excel is the Hungarian one", async () => {
    const wb = await load();
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Bevételek", "Egyenleg"]);
    expect(row(wb.getWorksheet("Bevételek")!, 3)[0]).toBe("Dátum");
    expect(row(wb.getWorksheet("Bevételek")!, 4).at(-1)).toBe("igen");
  });
});
