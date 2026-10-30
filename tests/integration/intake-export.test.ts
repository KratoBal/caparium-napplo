// The Takarmányhűtő report as PDF and Excel (Lili 2026-10-30, acrobot 38557/38558). Days in September 2026 (a month no other
// integration test uses); the feed is made here, because the stock is global per feed.
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { buildIntakeWorkbook, RETURNED_ARGB } from "@/lib/exports/intake-excel";
import { intakeReport } from "@/lib/exports/intake-report";
import { buildIntakePdf, RETURNED_INK } from "@/lib/exports/intake-pdf";
import { saveIntakeItem } from "@/lib/feed-intake";
import { createFeed } from "@/lib/feeds";
import { saveWithdrawalItem } from "@/lib/withdrawal";
import { readPdfColors } from "../support/pdf-colors";
import { readPdfLines } from "../support/pdf-readback";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const unit: Record<string, string> = {};
const at = (d: string, t: string) => new Date(`${d}T${t}:00+02:00`);
let feedId = "";
const FEED = "Hűtő-export teszt";

beforeAll(async () => {
  f = await fixtures();
  for (const u of await prisma.unit.findMany()) unit[u.symbol] = u.id;
  const type = await prisma.feedType.findUniqueOrThrow({ where: { code: "RAK" } });
  feedId = (await createFeed(f.admin, { requestId: rid(), typeId: type.id, name: FEED, dimensions: ["MASS"], defaultUnitId: unit.g }, new Date("2026-09-01T08:00:00Z"))).id;
  const receive = (d: string, body: Record<string, unknown>) =>
    saveIntakeItem(f.aq1, { requestId: rid(), day: d, feedId, ...body } as Parameters<typeof saveIntakeItem>[1], at(d, "08:00"));
  const take = (d: string, value: string) =>
    saveWithdrawalItem(f.aq1, { requestId: rid(), day: d, feedId, quantities: [{ value, unitId: unit.g }] } as Parameters<typeof saveWithdrawalItem>[1], at(d, "09:00"));
  await receive("2026-09-02", { quantities: [{ value: "3", unitId: unit.kg }], note: "nyitó készlet" });
  await receive("2026-09-03", { quantities: [{ value: "10", unitId: unit.kg }], returned: true, note: "nem megfelelő" });
  await take("2026-09-04", "400");
  await take("2026-09-12", "700");
});

const mine = <T extends { feed: string }>(rows: T[]) => rows.filter((r) => r.feed === FEED);

describe("the report's data", () => {
  it("the intake with the returned delivery marked, the withdrawals added up per feed, the closing stock at the end of the period", async () => {
    const r = await intakeReport({ from: "2026-09-01", to: "2026-09-30" }, at("2026-09-30", "12:00"));
    expect(mine(r.intake).map((i) => [i.day, i.quantity, i.unit, i.note, i.returned])).toEqual([
      ["2026-09-02", "3", "kg", "nyitó készlet", false],
      ["2026-09-03", "10", "kg", "nem megfelelő", true],
    ]);
    // 400 g + 700 g = 1100 g, shown as the pages show it: kg from 1000 g
    expect(mine(r.taken)).toEqual([{ feed: FEED, unit: "kg", quantity: "1,10" }]);
    // 3 kg received (the returned 10 kg is not stock) minus 1,1 kg
    expect(mine(r.closing)).toEqual([{ feed: FEED, unit: "kg", level: "1,90", negative: false, low: false }]);
  });

  it("the closing stock is the stock at the end of the period's last day: a later withdrawal is not yet in it; a period without the intake has none", async () => {
    const early = await intakeReport({ from: "2026-09-01", to: "2026-09-10" }, at("2026-09-30", "12:00"));
    // 3 kg minus 400 g = 2600 g, shown as the pages show it: kg from 1000 g
    expect(mine(early.closing)).toEqual([{ feed: FEED, unit: "kg", level: "2,60", negative: false, low: false }]);
    expect(mine(early.taken)).toEqual([{ feed: FEED, unit: "g", quantity: "400" }]);
    const before = await intakeReport({ from: "2026-08-20", to: "2026-09-01" }, at("2026-09-30", "12:00"));
    expect(mine(before.closing)).toEqual([]);
    expect(mine(before.intake)).toEqual([]);
  });

  it("a backwards or a longer than a year period is refused", async () => {
    await expect(intakeReport({ from: "2026-09-10", to: "2026-09-01" })).rejects.toMatchObject({ code: "BAD_PERIOD" });
    await expect(intakeReport({ from: "2025-01-01", to: "2026-09-01" })).rejects.toMatchObject({ code: "PERIOD_TOO_LONG" });
  });
});

describe("the closing stock's mark is read at the period's end, not today (barracuda on #143)", () => {
  it("a period that closed more than 30 days ago still says \"fogyóban\" for a stock that was running out then", async () => {
    const type = await prisma.feedType.findUniqueOrThrow({ where: { code: "RAK" } });
    const id = (await createFeed(f.admin, { requestId: rid(), typeId: type.id, name: "Hűtő-export fogyóban", dimensions: ["MASS"], defaultUnitId: unit.g }, new Date("2026-09-01T08:00:00Z"))).id;
    await saveIntakeItem(f.aq1, { requestId: rid(), day: "2026-09-05", feedId: id, quantities: [{ value: "1", unitId: unit.kg }] }, at("2026-09-05", "08:00"));
    await saveWithdrawalItem(f.aq1, { requestId: rid(), day: "2026-09-10", feedId: id, quantities: [{ value: "950", unitId: unit.g }] }, at("2026-09-10", "09:00"));
    // 950 g taken in the 30 days before the 20th, 50 g left: about 1,6 days. "Today" is 40 days after the period's end.
    const r = await intakeReport({ from: "2026-09-01", to: "2026-09-20" }, at("2026-10-30", "12:00"));
    expect(r.closing.filter((c) => c.feed === "Hűtő-export fogyóban")).toEqual([{ feed: "Hűtő-export fogyóban", unit: "g", level: "50", negative: false, low: true }]);
    // a period that ends in the future is read as of now: the mark is today's
    const later = await intakeReport({ from: "2026-09-01", to: "2026-12-31" }, at("2026-10-30", "12:00"));
    expect(later.closing.find((c) => c.feed === "Hűtő-export fogyóban")?.level).toBe("50");
  });
});

describe("the Excel", () => {
  it("three sheets, the numbers are numbers, the returned delivery's row is red, the others are not", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildIntakeWorkbook({ from: "2026-09-01", to: "2026-09-30" })).buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Bevételek", "Kivételek", "Záró készlet"]);
    const a = wb.getWorksheet("Bevételek")!;
    // the document's title in A1 (Lili 2026-10-30), the header on row 3, the data under it
    expect(a.getRow(1).getCell(1).value).toBe("Cápasuli takarmányegyenleg: 2026.09.01. – 2026.09.30.");
    expect([1, 2, 3, 4, 5, 6, 7].map((c) => a.getRow(3).getCell(c).value)).toEqual(["Dátum", "Takarmány típusa", "Takarmány", "Mennyiség", "Mértékegység", "Megjegyzés", "Visszaküldve"]);
    expect(wb.title).toBe("Cápasuli takarmányegyenleg: 2026.09.01. – 2026.09.30.");
    expect(a.getRow(4).getCell(1).numFmt).toBe('yyyy"."mm"."dd"."');
    const rows: ExcelJS.Row[] = [];
    a.eachRow((row, n) => n > 3 && row.getCell(3).value === FEED && rows.push(row));
    expect(rows.map((r) => [r.getCell(4).value, r.getCell(5).value, r.getCell(7).value])).toEqual([[3, "kg", ""], [10, "kg", "igen"]]);
    expect(rows[0].getCell(3).font?.color?.argb).not.toBe(RETURNED_ARGB);
    expect(rows[1].getCell(3).font?.color?.argb).toBe(RETURNED_ARGB);
    const taken = wb.getWorksheet("Kivételek")!;
    let tk: unknown[] = [];
    taken.eachRow((row, n) => n > 3 && row.getCell(1).value === FEED && (tk = [row.getCell(2).value, row.getCell(3).value]));
    expect(tk).toEqual([1.1, "kg"]);
    const closing = wb.getWorksheet("Záró készlet")!;
    let cl: unknown[] = [];
    closing.eachRow((row, n) => n > 3 && row.getCell(1).value === FEED && (cl = [row.getCell(2).value, row.getCell(3).value]));
    expect(cl).toEqual([1.9, "kg"]);
  });
});

describe("the PDF", () => {
  it("the title and the three sections read back with their accents, the returned row in red and nothing else red", async () => {
    const { buffer } = await buildIntakePdf({ from: "2026-09-01", to: "2026-09-30" });
    const lines = await readPdfLines(new Uint8Array(buffer));
    expect(lines[0]).toBe("Cápasuli takarmányegyenleg: 2026.09.01. – 2026.09.30.");
    for (const s of ["Bevételek", "Kivételek takarmányonként", "Záró készlet (2026.09.30. végén)"]) expect(lines.some((l) => l.includes(s)), s).toBe(true);
    const mineLines = lines.filter((l) => l.includes(FEED));
    expect(mineLines.some((l) => l.includes("nyitó készlet"))).toBe(true);
    expect(mineLines.some((l) => l.includes("nem megfelelő") && l.includes("igen"))).toBe(true);
    // the colors: the returned row's text is red, the row of the received delivery is not
    const colors = await readPdfColors(new Uint8Array(buffer));
    const red = colors.texts.filter((t) => t.color === RETURNED_INK).map((t) => t.text);
    expect(red.some((t) => t.includes("nem megfelelő"))).toBe(true);
    expect(red.some((t) => t.includes("nyitó készlet"))).toBe(false);
  });
});
