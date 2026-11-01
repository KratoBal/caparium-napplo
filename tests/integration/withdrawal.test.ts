// Feed withdrawal (adatmodell 12.; KIV-01..KIV-05, TAK-06, T-10, R-11). Days in July 2026: no other
// file writes withdrawal or feeding days there.
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import JSZip from "jszip";
import { buildWithdrawalWorkbook, DAY_BAND, TOTAL_FILL, WITHDRAWAL_SUMMARY_SHEET } from "@/lib/exports/feeding-excel";
import { saveFeedingItem, setSelection } from "@/lib/feeding";
import { recloseDay, reopenDay, runJournalJob } from "@/lib/journal";
import { closeWithdrawalDay, invalidateWithdrawalItem, saveWithdrawalItem, takenVersusGiven, withdrawalDayView } from "@/lib/withdrawal";
import { dayToDate, EXCEL_DATE_FORMAT } from "@/lib/time";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const a: Record<string, string> = {};
const feed: Record<string, string> = {};
const unit: Record<string, string> = {};
const at = (d: string, t: string) => new Date(`${d}T${t}:00+02:00`);

beforeAll(async () => {
  f = await fixtures();
  for (const n of await prisma.animalName.findMany()) a[n.name] = n.animalId;
  for (const n of await prisma.feedName.findMany()) feed[n.name] = n.feedId;
  for (const u of await prisma.unit.findMany()) unit[u.symbol] = u.id;
});

async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e, `expected ${code}`).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
}

const take = (d: string, body: Record<string, unknown>, actor = f?.aq1, t = "08:00") =>
  saveWithdrawalItem(actor, { requestId: rid(), day: d, ...body } as Parameters<typeof saveWithdrawalItem>[1], at(d, t));

describe("withdrawal items (KIV-01, KIV-02, T-08, T-10)", () => {
  it("per dimension, the use day defaults to the next day, the day's total in base units; one item per feed and day", async () => {
    const d = "2026-07-06";
    const r = (await take(d, { feedId: feed["Litopenaeus vannamei"], quantities: [{ value: "6", unitId: unit.db }, { value: "1", unitId: unit.kg }] })) as { itemId: string };
    const view = await withdrawalDayView(d);
    expect(view.items[0]).toMatchObject({ useDay: "2026-07-07", quantities: [{ value: "6", unit: "db" }, { value: "1", unit: "kg" }] });
    expect(view.totals).toEqual({ db: 6, g: 1000 });
    await expectCode(take(d, { feedId: feed["Litopenaeus vannamei"], quantities: [{ value: "1", unitId: unit.db }] }, f.aq2), "CELL_TAKEN");
    await expectCode(take(d, { feedId: feed["Teszt hal"], useDay: "2026-07-05", quantities: [{ value: "1", unitId: unit.g }] }), "USE_DAY");
    await take(d, { itemId: r.itemId, expectedVersion: 1, feedId: feed["Litopenaeus vannamei"], quantities: [{ value: "8", unitId: unit.db }] });
    expect((await withdrawalDayView(d)).totals).toEqual({ db: 8 });
    await expectCode(invalidateWithdrawalItem(f.aq2, r.itemId, { requestId: rid(), expectedVersion: 2, reason: "nem az enyém" }, at(d, "09:00")), "NOT_OWN");
  });

  // Lili 2026-10-27 15:43 UTC: on one day a withdrawal for that day's feeding, then another for the next day's. The cell is
  // (day, feed, other name, USE DAY): two use days are two items; the same use day twice is still one cell (T-02).
  it("the same feed twice on a day, for two use days; the same use day twice is still taken", async () => {
    const d = "2026-07-24";
    await take(d, { feedId: feed["Teszt hal"], useDay: d, quantities: [{ value: "100", unitId: unit.g }] });
    await take(d, { feedId: feed["Teszt hal"], quantities: [{ value: "150", unitId: unit.g }] });
    const view = await withdrawalDayView(d);
    expect(view.items.map((i) => [i.useDay, i.quantities[0]?.value])).toEqual([[d, "100"], ["2026-07-25", "150"]]);
    expect(view.totals).toEqual({ g: 250 });
    await expectCode(take(d, { feedId: feed["Teszt hal"], useDay: d, quantities: [{ value: "1", unitId: unit.g }] }, f.aq2), "CELL_TAKEN");
    // an other feed by the same name, for both use days; it is still one name of the day's five (KIV-04)
    await take(d, { feedId: feed["Egyéb"], otherName: "tintahal", useDay: d, quantities: [{ value: "10", unitId: unit.g }] });
    await take(d, { feedId: feed["Egyéb"], otherName: "Tintahal", quantities: [{ value: "20", unitId: unit.g }] });
    await expectCode(take(d, { feedId: feed["Egyéb"], otherName: "TINTAHAL", useDay: d, quantities: [{ value: "5", unitId: unit.g }] }), "CELL_TAKEN");
    // changing the first item onto the second one's use day meets the taken cell
    const first = (await withdrawalDayView(d)).items.find((i) => i.feed === "Teszt hal" && i.useDay === d)!;
    await expectCode(
      take(d, { itemId: first.id, expectedVersion: first.version, feedId: feed["Teszt hal"], useDay: "2026-07-25", quantities: [{ value: "100", unitId: unit.g }] }),
      "CELL_TAKEN",
    );
  });

  it("at most 5 different other feeds a day (KIV-04)", async () => {
    const d = "2026-07-08";
    for (let i = 1; i <= 5; i++) await take(d, { feedId: feed["Egyéb"], otherName: `egyéb-${i}`, quantities: [{ value: "10", unitId: unit.g }] });
    await expectCode(take(d, { feedId: feed["Egyéb"], otherName: "egyéb-6", quantities: [{ value: "10", unitId: unit.g }] }), "TOO_MANY_OTHER");
    await expectCode(take(d, { feedId: feed["Egyéb"], otherName: "egyéb-1", quantities: [{ value: "5", unitId: unit.g }] }), "CELL_TAKEN");
    // one name whatever its case (review note on #13)
    await expectCode(take(d, { feedId: feed["Egyéb"], otherName: "EGYÉB-1", quantities: [{ value: "5", unitId: unit.g }] }), "CELL_TAKEN");
  });
});

describe("the day's lock (KIV-03)", () => {
  it("an aquarist closes today's input; then only an admin, with a reason, changes it; midnight closes a forgotten day", async () => {
    const d = "2026-07-09";
    await take(d, { feedId: feed["Teszt hal"], quantities: [{ value: "100", unitId: unit.g }] });
    await expectCode(closeWithdrawalDay(f.aq1, { requestId: rid(), day: "2026-07-08" }, at(d, "10:00")), "NOT_TODAY");
    await expectCode(closeWithdrawalDay(f.admin, { requestId: rid(), day: "2026-07-12" }, at(d, "10:00")), "FUTURE_DAY");
    await closeWithdrawalDay(f.aq1, { requestId: rid(), day: d }, at(d, "10:00"));
    await expectCode(take(d, { feedId: feed["Teszt kagyló"], quantities: [{ value: "1", unitId: unit.g }] }, f.aq1, "10:05"), "DAY_CLOSED");
    await reopenDay(f.admin, { requestId: rid(), kind: "WITHDRAWAL", day: d, reason: "pótlás" });
    await take(d, { feedId: feed["Teszt kagyló"], reason: "pótlás", quantities: [{ value: "1", unitId: unit.g }] }, f.admin, "11:00");
    await recloseDay(f.admin, { requestId: rid(), kind: "WITHDRAWAL", day: d }, at(d, "11:05"));
    // a day nobody closed: the journal job closes it after midnight
    const left = "2026-07-10";
    await take(left, { feedId: feed["Teszt hal"], quantities: [{ value: "50", unitId: unit.g }] }, f.aq1, "09:00");
    await runJournalJob(at("2026-07-11", "00:05"));
    const j = await prisma.journalDay.findFirstOrThrow({ where: { kind: "WITHDRAWAL", businessDay: dayToDate(left) } });
    expect([j.state, j.closeMode]).toEqual(["CLOSED", "AUTOMATIC"]);
  });
});

describe("taken against given (TAK-06, R-11)", () => {
  it("per feed and base unit, by use day and feeding day; an other feed stands on its own row", async () => {
    const d = "2026-07-13";
    const use = "2026-07-14";
    await take(d, { feedId: feed["Teszt hal"], quantities: [{ value: "0,5", unitId: unit.kg }] });
    await take(d, { feedId: feed["Egyéb"], otherName: "tintahal-fej", quantities: [{ value: "50", unitId: unit.g }] });
    await setSelection(f.aq1, { requestId: rid(), day: use, animalIds: [a["Teszt Egy"]], selected: true }, at(use, "08:00"));
    await saveFeedingItem(f.aq1, { requestId: rid(), day: use, animalId: a["Teszt Egy"], feedId: feed["Teszt hal"], quantities: [{ value: "400", unitId: unit.g }] }, at(use, "09:00"));
    await saveFeedingItem(f.aq1, { requestId: rid(), day: use, animalId: a["Teszt Egy"], feedId: feed["Egyéb"], otherName: "kagylóhéj", quantities: [{ value: "20", unitId: unit.g }] }, at(use, "09:05"));
    const rows = await takenVersusGiven(use, use);
    expect(rows.map((r) => [r.feed, r.unit, r.taken, r.given, r.paired])).toEqual([
      ["Teszt hal", "g", 500, 400, true],
      ["Egyéb: kagylóhéj", "g", 0, 20, false],
      ["Egyéb: tintahal-fej", "g", 50, 0, false],
    ]);
  });
});

describe("the withdrawal Excel (KIV-05)", () => {
  it("the template's header, one row per item and dimension, the other feed by its name, the use day apart", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildWithdrawalWorkbook({ from: "2026-07-06", to: "2026-07-06" })).buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.name).toBe("Munka1");
    expect([1, 2, 3, 4, 5, 6].map((c) => ws.getRow(1).getCell(c).value)).toEqual(["Dátum", "Takarmány típusa", "Takarmány", "Mennyiség", "Mértékegység", "Felhasználás napja"]);
    const fill = ws.getRow(1).getCell(1).fill;
    expect(fill && fill.type === "pattern" ? fill.fgColor?.argb : null).toBe("FFA6CAEC");
    // the edited Litopenaeus item: 8 db only (the kg quantity went with the edit)
    expect([2, 3, 4, 5].map((c) => ws.getRow(2).getCell(c).value)).toEqual(["Rákok", "Litopenaeus vannamei", 8, "db"]);
    expect((ws.getRow(2).getCell(6).value as Date).toISOString().slice(0, 10)).toBe("2026-07-07");
    // both date columns show the dotted date (Lili 2026-10-30)
    expect([ws.getRow(2).getCell(1).numFmt, ws.getRow(2).getCell(6).numFmt]).toEqual([EXCEL_DATE_FORMAT, EXCEL_DATE_FORMAT]);
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load((await buildWithdrawalWorkbook({ from: "2026-07-13", to: "2026-07-13" })).buffer as unknown as ArrayBuffer);
    const names: unknown[] = [];
    wb2.worksheets[0].eachRow((r, n) => n > 1 && names.push(r.getCell(3).value));
    expect(names).toContain("tintahal-fej");
  });
});

// Lili 2026-11-01 (point 4): the rows change colour day by day; a second sheet sums each week per feed (g, kg, pieces apart) with the
// week's pie of the grams. Days in December 2028: no other file writes withdrawals there.
describe("the withdrawal Excel's days and weeks (point 4)", () => {
  it("bands every other day; sums each week per feed with its total; one pie per week reading the week's cells", async () => {
    await take("2028-12-04", { feedId: feed["Teszt hal"], quantities: [{ value: "200", unitId: unit.g }] });
    await take("2028-12-04", { feedId: feed["Egyéb"], otherName: "kagylóhéj", quantities: [{ value: "0,1", unitId: unit.kg }] });
    await take("2028-12-05", { feedId: feed["Teszt hal"], quantities: [{ value: "0,3", unitId: unit.kg }] }, f?.aq1, "09:00");
    await take("2028-12-05", { feedId: feed["Litopenaeus vannamei"], quantities: [{ value: "5", unitId: unit.db }] });
    await take("2028-12-11", { feedId: feed["Teszt hal"], quantities: [{ value: "50", unitId: unit.g }] });
    const { buffer } = await buildWithdrawalWorkbook({ from: "2028-12-04", to: "2028-12-11" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const fillOf = (c: ExcelJS.Cell) => (c.fill && c.fill.type === "pattern" ? (c.fill.fgColor?.argb ?? null) : null);
    const val = (c: ExcelJS.Cell) => (c.value && typeof c.value === "object" && "result" in c.value ? c.value.result : c.value);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Munka1", WITHDRAWAL_SUMMARY_SHEET]);

    const log = wb.worksheets[0];
    const band: Record<string, Set<string | null>> = {};
    log.eachRow((r, n) => {
      if (n === 1) return;
      const d = (r.getCell(1).value as Date).toISOString().slice(0, 10);
      (band[d] ??= new Set()).add(fillOf(r.getCell(3)));
    });
    expect(band).toEqual({ "2028-12-04": new Set([null]), "2028-12-05": new Set([DAY_BAND]), "2028-12-11": new Set([null]) });

    const sum = wb.worksheets[1];
    const row = (n: number) => [1, 2, 3, 4].map((c) => val(sum.getRow(n).getCell(c)));
    expect(sum.getRow(1).getCell(1).value).toBe("Hét: 2028.12.04.–2028.12.10.");
    expect(row(2)).toEqual(["Takarmány", "Mennyiség (g)", "Mennyiség (kg)", "Darab (db)"]);
    expect([row(3), row(4), row(5), row(6)]).toEqual([
      ["kagylóhéj", 100, 0.1, null],
      ["Litopenaeus vannamei", 0, 0, 5],
      ["Teszt hal", 500, 0.5, null],
      ["Összesen", 600, 0.6, 5],
    ]);
    expect((sum.getRow(6).getCell(2).value as { formula: string }).formula).toBe("SUM(B3:B5)");
    expect(fillOf(sum.getRow(6).getCell(1))).toBe(TOTAL_FILL);
    // the next week, its block under the first one's pie
    let second = 0;
    sum.eachRow((r, n) => {
      if (String(r.getCell(1).value).startsWith("Hét: 2028.12.11.")) second = n;
    });
    expect(second).toBeGreaterThanOrEqual(18);
    expect(sum.getRow(second).getCell(1).value).toBe("Hét: 2028.12.11.–2028.12.11.");
    expect([row(second + 2), row(second + 3)]).toEqual([
      ["Teszt hal", 50, 0.05, null],
      ["Összesen", 50, 0.05, 0],
    ]);

    // the pies: one chart part a week, on the summary sheet's drawing, reading that week's name and gram cells
    const zip = await JSZip.loadAsync(buffer);
    const charts = Object.keys(zip.files).filter((n) => /^xl\/charts\/chart\d+\.xml$/.test(n)).sort();
    expect(charts).toEqual(["xl/charts/chart1.xml", "xl/charts/chart2.xml"]);
    const c1 = await zip.file(charts[0])!.async("string");
    expect(c1).toContain("<c:pieChart>");
    expect(c1).toContain("<c:f>'Heti összesítő'!$A$3:$A$5</c:f>");
    expect(c1).toContain("<c:f>'Heti összesítő'!$B$3:$B$5</c:f>");
    expect(c1).toContain("<a:t>Hét: 2028.12.04.–2028.12.10.</a:t>");
    const c2 = await zip.file(charts[1])!.async("string");
    expect(c2).toContain(`$A$${second + 2}:$A$${second + 2}</c:f>`);
    expect(await zip.file("xl/worksheets/sheet2.xml")!.async("string")).toMatch(/<drawing r:id="rIdPieDrawing"\/><\/worksheet>|<drawing r:id="rIdPieDrawing"\/></);
    expect(await zip.file("xl/worksheets/_rels/sheet2.xml.rels")!.async("string")).toContain('Target="../drawings/drawing1.xml"');
    const types = await zip.file("[Content_Types].xml")!.async("string");
    expect(types).toContain('PartName="/xl/charts/chart2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"');
    expect(types).toContain('PartName="/xl/drawings/drawing1.xml"');
    // the log sheet has no drawing
    expect(await zip.file("xl/worksheets/sheet1.xml")!.async("string")).not.toContain("<drawing");
  });
});
