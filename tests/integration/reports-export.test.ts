// EGY-13 as Excel, and EVE-08 in the eating Excel. Days in November 2026.
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { buildEatingWorkbook, buildReportWorkbook, WEEK_FILLS } from "@/lib/exports/feeding-excel";
import { saveFeedingItem, setSelection } from "@/lib/feeding";
import { EXCEL_DATE_FORMAT } from "@/lib/time";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const a: Record<string, string> = {};
const feed: Record<string, string> = {};
const unit: Record<string, string> = {};
let groupId = "";
const at = (d: string, t: string) => new Date(`${d}T${t}:00+01:00`);

beforeAll(async () => {
  f = await fixtures();
  for (const n of await prisma.animalName.findMany()) a[n.name] = n.animalId;
  for (const n of await prisma.feedName.findMany()) feed[n.name] = n.feedId;
  for (const u of await prisma.unit.findMany()) unit[u.symbol] = u.id;
  groupId = (await prisma.animalGroupName.findFirstOrThrow({ where: { name: "Teszt csoport" } })).groupId;
  const d = "2026-11-02";
  const now = at(d, "09:00");
  await setSelection(f.aq1, { requestId: rid(), day: d, animalIds: [a["Teszt Egy"], a["Teszt Kettő"]], selected: true }, now);
  await saveFeedingItem(f.aq1, { requestId: rid(), day: d, animalId: a["Teszt Egy"], feedId: feed["Litopenaeus vannamei"], quantities: [{ value: "6", unitId: unit.db }, { value: "40", unitId: unit.g }] }, now);
  await saveFeedingItem(f.aq1, { requestId: rid(), day: d, groupId, feedId: feed["Teszt hal"], quantities: [{ value: "0,3", unitId: unit.kg }] }, now);
});

async function load(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

describe("the report Excel (EGY-13)", () => {
  it("by day and by recipient, per feed and base unit, with totals per unit", async () => {
    const wb = await load((await buildReportWorkbook({ from: "2026-11-02", to: "2026-11-03", poolId: null, animalId: null })).buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Napokra bontva", "Kinek"]);
    const day = wb.getWorksheet("Napokra bontva")!;
    const header = (day.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual(["Nap", "Litopenaeus vannamei (db)", "Litopenaeus vannamei (g)", "Teszt hal (g)", "Összesen (db)", "Összesen (g)"]);
    expect((day.getRow(2).values as unknown[]).slice(1)).toEqual(["2026.11.02.", 6, 40, 300, 6, 340]);
    expect(day.getRow(3).getCell(1).value).toBe("2026.11.03.");
    expect(day.getRow(4).getCell(1).value).toBe("Összesen");
    const who = wb.getWorksheet("Kinek")!;
    const labels: unknown[] = [];
    who.eachRow((r, n) => n > 1 && labels.push(r.getCell(1).value));
    expect(labels).toEqual(["Teszt csoport (csoport)", "Teszt Egy", "Összesen"]);
  });

  it("filtered by animal: its group's item comes, but apart, never in the animal's own total (R-8, review of #17)", async () => {
    const wb = await load((await buildReportWorkbook({ from: "2026-11-02", to: "2026-11-02", poolId: null, animalId: a["Teszt Kettő"] })).buffer);
    const who = wb.getWorksheet("Kinek")!;
    expect(who.getRow(2).getCell(1).value).toBe("Teszt csoport (csoport)");
    const day = wb.getWorksheet("Napokra bontva")!;
    expect((day.getRow(1).values as unknown[]).slice(1)).toEqual(["Nap", "Teszt hal [csoportos tétel] (g)", "Csoportos tételekben, a csoport teljes mennyisége (g)"]);
    expect((day.getRow(2).values as unknown[]).slice(1)).toEqual(["2026.11.02.", 300, 300]);
  });
});

describe("the eating Excel's weeks (EVE-08)", () => {
  it("the day headers alternate by calendar week", async () => {
    const wb = await load((await buildEatingWorkbook({ from: "2026-11-01", to: "2026-11-09" })).buffer);
    const r1 = wb.worksheets[0].getRow(1);
    const fillOf = (c: number) => {
      const x = r1.getCell(c).fill;
      return x && x.type === "pattern" ? x.fgColor?.argb : null;
    };
    // E1 = Sunday 11-01, F1 = Monday 11-02 (a new week), L1 = Sunday 11-08, M1 = Monday 11-09
    expect([fillOf(5), fillOf(6), fillOf(12), fillOf(13)]).toEqual([WEEK_FILLS[0], WEEK_FILLS[1], WEEK_FILLS[1], WEEK_FILLS[0]]);
  });
  it("the day's letter under each date (Lili 2026-10-29, package item 7)", async () => {
    const wb = await load((await buildEatingWorkbook({ from: "2026-11-01", to: "2026-11-09" })).buffer);
    const r2 = wb.worksheets[0].getRow(2);
    // E = Sunday 11-01 .. M = Monday 11-09; the first three cells keep their headers
    expect([5, 6, 7, 8, 9, 10, 11, 12, 13].map((c) => r2.getCell(c).value)).toEqual(["V", "H", "K", "Sze", "Cs", "P", "Szo", "V", "H"]);
    expect([1, 2, 3].map((c) => r2.getCell(c).value)).toEqual(["Állatfaj", "Név", "Csoport"]);
  });
  it("the day headers read the full dotted date, as a real date cell (Lili 2026-10-30)", async () => {
    const wb = await load((await buildEatingWorkbook({ from: "2026-11-01", to: "2026-11-02" })).buffer);
    const r1 = wb.worksheets[0].getRow(1);
    expect([5, 6].map((c) => r1.getCell(c).numFmt)).toEqual([EXCEL_DATE_FORMAT, EXCEL_DATE_FORMAT]);
    expect([5, 6].map((c) => (r1.getCell(c).value as Date).toISOString().slice(0, 10))).toEqual(["2026-11-01", "2026-11-02"]);
  });
});
