// The Takarmányhűtő report as PDF and Excel (Lili 2026-10-30, acrobot 38557/38558). Days in September 2026 (a month no other
// integration test uses); the feed is made here, because the stock is global per feed.
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { buildIntakeWorkbook, RETURNED_ARGB } from "@/lib/exports/intake-excel";
import { intakeReport } from "@/lib/exports/intake-report";
import { buildIntakePdf, RETURNED_INK } from "@/lib/exports/intake-pdf";
import { feedStock, saveIntakeItem } from "@/lib/feed-intake";
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
    // the balance (point 7): opens at 0, 3 kg in (the returned 10 kg is not stock), 400 g + 700 g out, 1,9 kg closing; one unit for the line
    expect(mine(r.balance)).toEqual([{ feed: FEED, lines: [{ unit: "kg", opening: "0,00", received: "3,00", taken: "1,10", beforeStock: null, closing: "1,90", negative: false, low: false }] }]);
  });

  it("the closing stock is the stock at the end of the period's last day: a later withdrawal is not yet in it; a period without the intake has none", async () => {
    const early = await intakeReport({ from: "2026-09-01", to: "2026-09-10" }, at("2026-09-30", "12:00"));
    // 3 kg minus 400 g = 2600 g, shown as the pages show it: kg from 1000 g
    expect(mine(early.balance)[0].lines.map((l) => [l.opening, l.received, l.taken, l.closing])).toEqual([["0,00", "3,00", "0,40", "2,60"]]);
    // the next period opens where this one closed: 2,6 kg, then 700 g out
    const late = await intakeReport({ from: "2026-09-11", to: "2026-09-30" }, at("2026-09-30", "12:00"));
    expect(mine(late.balance)[0].lines.map((l) => [l.unit, l.opening, l.received, l.taken, l.closing])).toEqual([["kg", "2,60", "0,00", "0,70", "1,90"]]);
    const before = await intakeReport({ from: "2026-08-20", to: "2026-09-01" }, at("2026-09-30", "12:00"));
    expect(mine(before.balance)).toEqual([]);
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
    expect(r.balance.find((t) => t.feed === "Hűtő-export fogyóban")?.lines).toEqual([{ unit: "g", opening: "0", received: "1000", taken: "950", beforeStock: null, closing: "50", negative: false, low: true }]);
    // a period that ends in the future is read as of now: the mark is today's
    const later = await intakeReport({ from: "2026-09-01", to: "2026-12-31" }, at("2026-10-30", "12:00"));
    expect(later.balance.find((t) => t.feed === "Hűtő-export fogyóban")?.lines[0].closing).toBe("50");
  });
});

describe("the Excel", () => {
  it("two sheets, the numbers are numbers, the returned delivery's row is red, the others are not; the balance a block a feed", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildIntakeWorkbook({ from: "2026-09-01", to: "2026-09-30" })).buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Bevételek", "Egyenleg"]);
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
    const bal = wb.getWorksheet("Egyenleg")!;
    let at = 0;
    bal.eachRow((row, n) => row.getCell(1).value === FEED && (at = n));
    expect(at).toBeGreaterThan(2);
    expect([1, 2, 3, 4, 5, 6].map((c) => bal.getRow(at + 1).getCell(c).value)).toEqual(["Mértékegység", "Nyitó", "Bevétel", "Kivétel", "Záró", "Jelzés"]);
    expect([1, 2, 3, 4, 5].map((c) => bal.getRow(at + 2).getCell(c).value)).toEqual(["kg", 0, 3, 1.1, 1.9]);
  });
});

describe("the PDF", () => {
  it("the title and the three sections read back with their accents, the returned row in red and nothing else red", async () => {
    const { buffer } = await buildIntakePdf({ from: "2026-09-01", to: "2026-09-30" });
    const lines = await readPdfLines(new Uint8Array(buffer));
    expect(lines[0]).toBe("Cápasuli takarmányegyenleg: 2026.09.01. – 2026.09.30.");
    for (const s of ["Bevételek", "Egyenleg takarmányonként (2026.09.01. – 2026.09.30.)", FEED]) expect(lines.some((l) => l.includes(s)), s).toBe(true);
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

// Lili 2026-11-01 (point 7), and the trap acrobot measured (39573): a feed with withdrawals but no intake has no stock
// (feedStock's tracked = false, its level minus the withdrawals); in the balance it opens at 0, and what was taken before its
// stock started stands in its own column, not in "Kivétel" and not in the closing.
describe("the balance's withdrawals before the stock started", () => {
  it("open at 0; the earlier withdrawals apart; from the first intake on, the stock counts; the closing is feedStock's level", async () => {
    const type = await prisma.feedType.findUniqueOrThrow({ where: { code: "RAK" } });
    const id = (await createFeed(f.admin, { requestId: rid(), typeId: type.id, name: "Hűtő-egyenleg előtte", dimensions: ["MASS"], defaultUnitId: unit.g }, new Date("2026-09-01T08:00:00Z"))).id;
    const take = (d: string, value: string) =>
      saveWithdrawalItem(f.aq1, { requestId: rid(), day: d, feedId: id, quantities: [{ value, unitId: unit.g }] } as Parameters<typeof saveWithdrawalItem>[1], at(d, "09:00"));
    await take("2026-09-06", "120"); // before any period below and before the stock: in no balance
    await take("2026-09-15", "80"); // in the period, before the stock
    await saveIntakeItem(f.aq1, { requestId: rid(), day: "2026-09-16", feedId: id, quantities: [{ value: "500", unitId: unit.g }] }, at("2026-09-16", "08:00"));
    await take("2026-09-17", "30"); // from the stock
    const line = async (from: string, to: string) =>
      (await intakeReport({ from, to }, at("2026-09-30", "12:00"))).balance.find((t) => t.feed === "Hűtő-egyenleg előtte")?.lines;
    expect(await line("2026-09-10", "2026-09-30")).toEqual([{ unit: "g", opening: "0", received: "500", taken: "30", beforeStock: "80", closing: "470", negative: false, low: false }]);
    // before the intake: nothing but withdrawals before a stock; the opening is 0, not -120
    expect(await line("2026-09-10", "2026-09-15")).toEqual([{ unit: "g", opening: "0", received: "0", taken: "0", beforeStock: "80", closing: "0", negative: false, low: false }]);
    // after it: the opening is the stock (500 - 30), the earlier withdrawals are no part of it
    expect(await line("2026-09-18", "2026-09-30")).toEqual([{ unit: "g", opening: "470", received: "0", taken: "0", beforeStock: null, closing: "470", negative: false, low: false }]);
    const stock = (await feedStock(at("2026-09-30", "12:00"), "2026-09-30")).find((r) => r.feedId === id)!;
    expect(stock.level).toBe(470);
  });
});
