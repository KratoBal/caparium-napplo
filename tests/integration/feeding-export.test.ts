// The feeding and eating Excel exports (EGY-10, EGY-11, EGY-12, EVE-05..EVE-07, EVE-09, EVE-10, D-30),
// read back cell by cell. Days in April 2026: no other file writes feeding days there.
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { createLifecycleEvent } from "@/lib/animals";
import { prisma, SYSTEM_USER_ID } from "@/lib/db";
import { setEatingStatus } from "@/lib/eating";
import { buildEatingWorkbook, buildFeedingWorkbook, buildWithdrawalWorkbook, DAY_BAND, DAY_ROW_FILLS, TOTAL_FILL } from "@/lib/exports/feeding-excel";
import { finalizeList, saveFeedingItem, setFeedingMode, setSelection } from "@/lib/feeding";
import { feedingLog } from "@/lib/feeding-log";
import { otherLabel } from "@/lib/other-name";
import { recloseDay, runJournalJob } from "@/lib/journal";
import { EXCEL_DATE_FORMAT } from "@/lib/time";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const a: Record<string, string> = {};
const feed: Record<string, string> = {};
const unit: Record<string, string> = {};
let groupId = "";
let speciesId = "";

const at = (d: string, t: string) => new Date(`${d}T${t}:00+02:00`);

beforeAll(async () => {
  f = await fixtures();
  for (const n of await prisma.animalName.findMany()) a[n.name] = n.animalId;
  for (const n of await prisma.feedName.findMany()) feed[n.name] = n.feedId;
  for (const u of await prisma.unit.findMany()) unit[u.symbol] = u.id;
  groupId = (await prisma.animalGroupName.findFirstOrThrow({ where: { name: "Teszt csoport" } })).groupId;
  speciesId = (await prisma.species.findFirstOrThrow({ where: { scientificName: "Teszt faj A" } })).id;
});

async function sheet(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb.worksheets[0];
}
const fillOf = (c: ExcelJS.Cell) => (c.fill && c.fill.type === "pattern" ? (c.fill.fgColor?.argb ?? null) : null);
const val = (c: ExcelJS.Cell) => (c.value && typeof c.value === "object" && "result" in c.value ? c.value.result : c.value);
function colOf(ws: ExcelJS.Worksheet, row: number, text: string, nth = 0): number {
  const hits: number[] = [];
  ws.getRow(row).eachCell((c, n) => {
    if (c.value === text) hits.push(n);
  });
  if (hits[nth] === undefined) throw new Error(`no "${text}" in row ${row}`);
  return hits[nth];
}
function rowOf(ws: ExcelJS.Worksheet, col: number, text: string): ExcelJS.Row {
  let found: ExcelJS.Row | undefined;
  ws.eachRow((r) => {
    if (r.getCell(col).value === text) found = r;
  });
  if (!found) throw new Error(`no row with "${text}"`);
  return found;
}

describe("the feeding Excel (EGY-10, D-30)", () => {
  it("one row per day and recipient; pieces and grams never in one SUM; Egyéb with its name; SUM row last", async () => {
    const d = "2026-04-06";
    const now = at(d, "09:00");
    await setSelection(f.aq1, { requestId: rid(), day: d, animalIds: [a["Teszt Egy"], a["Teszt Kettő"], a["Teszt Három"]], selected: true }, now);
    const item = (body: Record<string, unknown>) => saveFeedingItem(f.aq1, { requestId: rid(), day: d, ...body } as Parameters<typeof saveFeedingItem>[1], now);
    await item({ animalId: a["Teszt Egy"], feedId: feed["Litopenaeus vannamei"], quantities: [{ value: "6", unitId: unit.db }, { value: "42,5", unitId: unit.g }] });
    await item({ animalId: a["Teszt Egy"], feedId: feed["Egyéb"], otherName: "tintahal-fej", quantities: [{ value: "20", unitId: unit.g }] });
    await item({ animalId: a["Teszt Három"], feedId: feed["Teszt hal"], quantities: [{ value: "1", unitId: unit.kg }] });
    await item({ groupId, feedId: feed["Teszt kagyló"], quantities: [{ value: "300", unitId: unit.g }] });

    const { buffer, rows } = await buildFeedingWorkbook({ from: d, to: d });
    expect(rows).toBeGreaterThan(3); // the three recipients plus every other animal alive that day (EGY-05)
    const ws = await sheet(buffer);
    // Lili 2026-11-01 (point 2): the day's name ("Nap") after the date
    expect([ws.getCell("E1").value, ws.getCell("E2").value, ws.getCell("A3").value, ws.getCell("B3").value, ws.getCell("C3").value, ws.getCell("D3").value]).toEqual([
      "Takarmány",
      "Mértékegység",
      "Dátum",
      "Nap",
      "Állatfaj",
      "Név",
    ]);
    expect([fillOf(ws.getCell("A1")), fillOf(ws.getCell("E1")), fillOf(ws.getCell("E2")), fillOf(ws.getCell("E3"))]).toEqual(["FF595959", "FFA6CAEC", "FFDCEAF7", "FF262626"]);
    // the Litopenaeus: one name over two columns, db then g (the template's J1:K1)
    const lit = colOf(ws, 1, "Litopenaeus vannamei");
    expect([ws.getRow(2).getCell(lit).value, ws.getRow(2).getCell(lit + 1).value]).toEqual(["db", "g"]);
    expect(ws.getRow(1).getCell(lit + 1).isMerged).toBe(true);

    const egy = rowOf(ws, 4, "Teszt Egy");
    expect([val(egy.getCell(lit)), val(egy.getCell(lit + 1))]).toEqual([6, 42.5]);
    // the date column is a real date cell shown as 2026.10.30. (Lili 2026-10-30), not ISO text
    expect([egy.getCell(1).numFmt, egy.getCell(1).value instanceof Date]).toEqual([EXCEL_DATE_FORMAT, true]);
    expect(egy.getCell(2).value).toBe("hétfő"); // 2026-04-06
    // Lili 2026-10-29 (package item 13): no "Egyéb 1..5" and no note columns; the other name has a column of its own
    const other1 = colOf(ws, 1, "Tintahal-fej"); // the fixed shown form: a capital first letter
    expect(val(egy.getCell(other1))).toBe(20);
    const heads = ws.getRow(1).values as unknown[];
    expect(heads.filter((v) => typeof v === "string" && /^Egyéb \d/.test(v))).toEqual([]);
    // D-30: one SUM/Állat per unit; the grams of the row are 42.5 + 20, the pieces stay apart
    const sums = [colOf(ws, 1, "SUM/Állat", 0), colOf(ws, 1, "SUM/Állat", 1)];
    const byUnit = Object.fromEntries(sums.map((c) => [ws.getRow(2).getCell(c).value, val(egy.getCell(c))]));
    expect(byUnit).toMatchObject({ g: 62.5, db: 6 });
    const gSum = sums.find((c) => ws.getRow(2).getCell(c).value === "g")!;
    // the formula's cells one by one: a substring check took "AK42" for "K42" once the sheet ran to column AK
    // (more feeds from an earlier test file; vitest orders the files by their last duration)
    const gCells = (egy.getCell(gSum).value as { formula: string }).formula.replace(/^SUM\(|\)$/g, "").split(",");
    expect(gCells).not.toContain(`${ws.getColumn(lit).letter}${egy.number}`);
    expect(gCells).toContain(`${ws.getColumn(lit + 1).letter}${egy.number}`);

    expect(val(rowOf(ws, 4, "Teszt Három").getCell(colOf(ws, 1, "Teszt hal")))).toBe(1000); // 1 kg in grams
    // EGY-05: an animal not fed that day has its row, its cells empty and coloured; a fed row's gaps too
    const negy = rowOf(ws, 4, "Teszt Négy");
    expect([negy.getCell(lit).value, fillOf(negy.getCell(lit)), fillOf(negy.getCell(other1))]).toEqual([null, "FFF2F2F2", "FFF2F2F2"]);
    expect([fillOf(egy.getCell(colOf(ws, 1, "Teszt hal"))), fillOf(egy.getCell(lit))]).toEqual(["FFF2F2F2", null]);
    const group = rowOf(ws, 4, "Teszt csoport (csoport)");
    expect(val(group.getCell(colOf(ws, 1, "Teszt kagyló")))).toBe(300);
    // EGY-11: the SUM row is the last one
    const last = ws.getRow(ws.rowCount);
    expect(last.getCell(1).value).toBe("SUM/Takarmány");
    expect(val(last.getCell(lit))).toBe(6);
    expect(val(last.getCell(gSum))).toBe(62.5 + 1000 + 300);
    // point 2: the totals stand out, the SUM row across and the SUM/Állat columns down (their heads too)
    expect([fillOf(last.getCell(1)), fillOf(last.getCell(lit)), fillOf(last.getCell(gSum))]).toEqual([TOTAL_FILL, TOTAL_FILL, TOTAL_FILL]);
    expect([fillOf(egy.getCell(gSum)), fillOf(ws.getRow(1).getCell(gSum)), egy.getCell(gSum).font?.bold]).toEqual([TOTAL_FILL, TOTAL_FILL, true]);
    // one day: no band
    expect(fillOf(egy.getCell(4))).toBeNull();
  });

  it("the rows change colour day by day (point 2): every other day's rows in the pale band, an empty feed cell keeps its grey", async () => {
    const ws = await sheet((await buildFeedingWorkbook({ from: "2028-04-06", to: "2028-04-08" })).buffer);
    const byDay = new Map<string, ExcelJS.Row[]>();
    ws.eachRow((r, n) => {
      if (n < 4 || !(r.getCell(1).value instanceof Date)) return;
      const d = (r.getCell(1).value as Date).toISOString().slice(0, 10);
      byDay.set(d, [...(byDay.get(d) ?? []), r]);
    });
    // the control: every day has its rows (the animals alive, EGY-05)
    expect([...byDay.keys()]).toEqual(["2028-04-06", "2028-04-07", "2028-04-08"]);
    const names = (d: string) => byDay.get(d)!.map((r) => fillOf(r.getCell(4)));
    expect(new Set(names("2028-04-06"))).toEqual(new Set([null]));
    expect(new Set(names("2028-04-07"))).toEqual(new Set([DAY_BAND]));
    expect(new Set(names("2028-04-08"))).toEqual(new Set([null]));
    expect(fillOf(byDay.get("2028-04-07")![0].getCell(6))).toBe("FFF2F2F2"); // an empty feed cell (EGY-05)
    expect(byDay.get("2028-04-07")![0].getCell(2).value).toBe("péntek");
  });
});

describe("the feeding Excel's other feeds (Lili 2026-10-29, package item 13)", () => {
  it("every other name its own column, by name, in the Egyéb type's place; more than five a row is no error; SUM counts them", async () => {
    const d = "2028-04-03";
    const now = at(d, "09:00");
    await setSelection(f.aq1, { requestId: rid(), day: d, animalIds: [a["Teszt Egy"]], selected: true }, now);
    const names = ["zsálya", "alga", "békalencse", "csiga", "dafnia", "ecetmuslica"];
    for (const otherName of names) {
      await saveFeedingItem(f.aq1, { requestId: rid(), day: d, animalId: a["Teszt Egy"], feedId: feed["Egyéb"], otherName, quantities: [{ value: "2", unitId: unit.g }] }, now);
    }
    await saveFeedingItem(f.aq1, { requestId: rid(), day: d, animalId: a["Teszt Egy"], feedId: feed["Teszt hal"], quantities: [{ value: "10", unitId: unit.g }] }, now);
    const ws = await sheet((await buildFeedingWorkbook({ from: d, to: d })).buffer);
    const labels = names.map((n) => otherLabel(n)); // the headers show the fixed form (capital first letter)
    const cols = labels.map((n) => colOf(ws, 1, n));
    // by name (hu), next to each other, after every feed of the other types (Egyéb is the last type)
    const sortedNames = [...labels].sort((x, y) => x.localeCompare(y, "hu"));
    expect(sortedNames.map((n) => colOf(ws, 1, n))).toEqual([...cols].sort((x, y) => x - y));
    expect(Math.max(...cols) - Math.min(...cols)).toBe(names.length - 1);
    expect(Math.min(...cols)).toBeGreaterThan(colOf(ws, 1, "Teszt hal"));
    const egy = rowOf(ws, 4, "Teszt Egy");
    expect(cols.map((c) => val(egy.getCell(c)))).toEqual(names.map(() => 2));
    const gSum = [0, 1].map((k) => colOf(ws, 1, "SUM/Állat", k)).find((c) => ws.getRow(2).getCell(c).value === "g")!;
    expect(val(egy.getCell(gSum))).toBe(10 + 2 * names.length);
  });
});

// Lili's package, item 12 follow-up (acrobot 38155, nautilus 38181): the same other name in another case or with other spaces is ONE
// column in the Excel and ONE feed in the report's log; the form first met is the header.
describe("the other feeds' names, normalized", () => {
  it("'Spirulina', ' spirulina ' and 'SPIRULINA' are one column and one report feed, under the one fixed form (capital first letter)", async () => {
    const d = "2028-04-04";
    const now = at(d, "09:00");
    await setSelection(f.aq1, { requestId: rid(), day: d, animalIds: [a["Teszt Egy"], a["Teszt Három"]], selected: true }, now);
    const give = (animal: string, otherName: string, value: string, time: string) =>
      saveFeedingItem(f.aq1, { requestId: rid(), day: d, animalId: a[animal], feedId: feed["Egyéb"], otherName, quantities: [{ value, unitId: unit.g }] }, at(d, time));
    await give("Teszt Egy", "Spirulina", "2", "09:00");
    await give("Teszt Három", "spirulina", "3", "09:05");
    await give("Teszt Egy", "ALGA", "1", "09:10"); // another name, to show the difference: shown "Alga", not "ALGA"
    const ws = await sheet((await buildFeedingWorkbook({ from: d, to: d })).buffer);
    const heads: string[] = [];
    ws.getRow(1).eachCell((c) => heads.push(String(c.value)));
    expect(heads.filter((h) => h.toLowerCase() === "spirulina")).toEqual(["Spirulina"]); // one column, the fixed form
    expect(heads).toContain("Alga"); // not as typed ("ALGA"): the form does not depend on what was met first
    const col = colOf(ws, 1, "Spirulina");
    expect(val(rowOf(ws, 4, "Teszt Egy").getCell(col))).toBe(2);
    expect(val(rowOf(ws, 4, "Teszt Három").getCell(col))).toBe(3);
    // the report's feed: one, with the first form, summed
    const log = await feedingLog({ from: d, to: d, poolId: null, animalId: null });
    const feeds = [...new Set(log.entries.map((e) => e.feed))].filter((x) => x.toLowerCase().includes("spirulina"));
    expect(feeds).toEqual(["Egyéb: Spirulina"]);
    expect(log.entries.filter((e) => e.feed === "Egyéb: Spirulina").reduce((n, e) => n + e.value, 0)).toBe(5);
  });
});

/*
  THE EXPORT PERIOD (C12 of the old-date survey, 2026-11-02). WHAT TURNS RED: the feed journal still stops at a year (the
  history since 2018-12-07 would take eight requests); the eating pattern or the withdrawal summary takes more than a year
  (a column per day, a pie per week); a century is built before it is refused.
*/
describe("the export period", () => {
  it("a century is refused before any work, by all three", async () => {
    for (const build of [buildFeedingWorkbook, buildEatingWorkbook, buildWithdrawalWorkbook]) {
      await expect(build({ from: "2000-01-01", to: "2099-12-31" })).rejects.toMatchObject({ code: "PERIOD_TOO_LONG" });
    }
  });

  it("the feed journal takes the history since 2018-12-07 in one go; the eating pattern and the withdrawal a year", async () => {
    const history = { from: "2018-12-07", to: "2026-12-31" };
    expect((await buildFeedingWorkbook(history)).buffer.length).toBeGreaterThan(0);
    await expect(buildFeedingWorkbook({ from: "2016-01-01", to: "2026-12-31" })).rejects.toMatchObject({
      code: "PERIOD_TOO_LONG",
      message: "Legfeljebb tíz év kérhető le egyszerre.",
    });
    for (const build of [buildEatingWorkbook, buildWithdrawalWorkbook]) {
      // 367 days with both ends: one over the year limit (2025-01-01 .. 2026-01-01 is 366 and is taken)
      await expect(build({ from: "2025-01-01", to: "2026-01-02" })).rejects.toMatchObject({
        code: "PERIOD_TOO_LONG",
        message: "Legfeljebb egy év kérhető le egyszerre.",
      });
      expect((await build({ from: "2025-01-01", to: "2025-12-31" })).buffer.length).toBeGreaterThan(0);
    }
  });
});

describe("the eating Excel (EVE-07)", () => {
  it("species, name, group; days across; colour per state, V and Gy; the medicine note under its day; the dead struck through", async () => {
    const arrive = async (name: string, when: string) =>
      (
        await createLifecycleEvent(
          f.admin,
          { requestId: rid(), type: "ARRIVAL", newAnimal: { speciesId, name, sex: "MALE" }, toPoolId: f.pool("NAGY"), occurredAtLocal: when, reason: "teszt" },
          at(when.slice(0, 10), "23:00"),
        )
      ).animalId;
    const gone = await arrive("Április Régi", "2026-03-20T09:00");
    await createLifecycleEvent(f.admin, { requestId: rid(), type: "DEATH", animalId: gone, occurredAtLocal: "2026-03-25T09:00", reason: "teszt" }, at("2026-03-25", "10:00"));
    const dies = await arrive("Április Kettő", "2026-04-01T09:00");
    const comes = await arrive("Április Egy", "2026-04-08T09:00");

    const d = "2026-04-07";
    const now = at(d, "09:00");
    await setSelection(f.aq1, { requestId: rid(), day: d, animalIds: [a["Teszt Egy"], a["Teszt Kettő"]], selected: true }, now);
    await setEatingStatus(f.aq1, { requestId: rid(), day: d, animalId: a["Teszt Egy"], state: "EATEN", vitamin: true }, now);
    await setEatingStatus(f.aq1, { requestId: rid(), day: d, animalId: a["Teszt Kettő"], state: "PARTIAL", medicine: true, medicineNote: "fél tabletta" }, now);
    await finalizeList(f.aq1, { requestId: rid(), day: d }, now);
    await recloseDay(f.admin, { requestId: rid(), kind: "FEEDING", day: d }, at(d, "20:00"));
    await createLifecycleEvent(f.admin, { requestId: rid(), type: "DEATH", animalId: dies, occurredAtLocal: "2026-04-08T10:00", reason: "teszt" }, at("2026-04-08", "11:00"));
    // 04-08 stays open, its list not finalized: Teszt Egy is on it, without an eating status
    await setSelection(f.aq1, { requestId: rid(), day: "2026-04-08", animalIds: [a["Teszt Egy"]], selected: true }, at("2026-04-08", "09:00"));

    const ws = await sheet((await buildEatingWorkbook({ from: d, to: "2026-04-09" })).buffer);
    expect([ws.getCell("D1").value, ws.getCell("A2").value, ws.getCell("B2").value, ws.getCell("C2").value]).toEqual(["Dátum", "Állatfaj", "Név", "Csoport"]);
    expect((ws.getCell("E1").value as Date).toISOString().slice(0, 10)).toBe(d);
    expect((ws.getCell("G1").value as Date).toISOString().slice(0, 10)).toBe("2026-04-09");

    const egy = rowOf(ws, 2, "Teszt Egy");
    expect([egy.getCell(3).value, fillOf(egy.getCell("E")), egy.getCell("E").value]).toEqual(["Teszt csoport", "FF00B050", "V"]);
    const ketto = rowOf(ws, 2, "Teszt Kettő");
    expect([fillOf(ketto.getCell("E")), ketto.getCell("E").value]).toEqual(["FFFFFF00", "Gy"]);
    expect(fillOf(rowOf(ws, 2, "Teszt Három").getCell("E"))).toBe("FFBDD7EE"); // the automatic fasting day
    // EVE-10: listed while alive in the period; dark after the death and struck through; not yet here: grey
    const dead = rowOf(ws, 2, "Április Kettő");
    expect(dead.getCell(2).font?.strike).toBe(true);
    // Lili 2026-10-21, DN-03: a day the animal lived, without data and not on the list, is a fasting day, also the
    // day of its death or arrival and a day not closed yet; an animal ON the list without a status stays empty
    expect([fillOf(dead.getCell("F")), fillOf(dead.getCell("G"))]).toEqual(["FFBDD7EE", "FF262626"]);
    expect([fillOf(rowOf(ws, 2, "Április Egy").getCell("E")), fillOf(rowOf(ws, 2, "Április Egy").getCell("F"))]).toEqual(["FFD9D9D9", "FFBDD7EE"]);
    expect([fillOf(egy.getCell("F")), fillOf(ketto.getCell("F"))]).toEqual([null, "FFBDD7EE"]);
    // Lili 2026-11-01 (point 3): the day-letter row under the dates in the week's paler colour; every animal row bordered,
    // a dashed line between the day columns
    expect([fillOf(ws.getCell("E2")), fillOf(ws.getCell("G2"))]).toEqual([DAY_ROW_FILLS[0], DAY_ROW_FILLS[0]]);
    expect(egy.getCell("E").border).toMatchObject({ top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "dashed" } });
    expect(egy.getCell("F").border).toMatchObject({ left: { style: "dashed" }, right: { style: "dashed" } });
    expect([egy.getCell("G").border?.right?.style, egy.getCell(1).border?.left?.style, egy.getCell(4).border?.right?.style]).toEqual(["thin", "thin", "thin"]);
    expect(() => rowOf(ws, 2, "Április Régi")).toThrow();
    expect(comes).toBeTruthy();
    // EVE-05, EVE-09: the note row under the animals, the medicine note under its day; f0552bd4: the "Etetés" row under it,
    // the last. 04-07 was closed with no choice, so it got K at the close (Lili 2026-11-11 10:40); the open 04-08 is empty
    const note = ws.getRow(ws.rowCount - 1);
    expect(note.getCell(1).value).toBe("Megjegyzés");
    expect(note.getCell("E").value).toBe("Teszt Kettő: fél tabletta");
    const mode = ws.getRow(ws.rowCount);
    expect([mode.getCell(1).value, mode.getCell("E").value, mode.getCell("F").value]).toEqual(["Etetés", "K", null]);
  });

  /*
    f0552bd4 (Lili 2026-11-11 08:47-08:50 UTC): ONE feeding mode a day, M (merüléses), F (felszíni) or K (neither), in the
    "Etetés" row under the note row. WHAT TURNS THIS RED: the row missing or above the note row; a wrong letter; a day without
    a choice printed as K (a guess); the choice not written by the day's rules, or not audited; an unchanged choice audited.
  */
  it("the Etetés row: M, F or K under its day, empty without a choice; set by the day's rules and audited", async () => {
    const days = ["2026-04-14", "2026-04-15", "2026-04-16", "2026-04-17"];
    const [m, fs, k] = days;
    await setFeedingMode(f.aq1, { requestId: rid(), day: m, mode: "DIVING" }, at(m, "09:00"));
    await setFeedingMode(f.aq1, { requestId: rid(), day: fs, mode: "SURFACE" }, at(fs, "09:00"));
    await setFeedingMode(f.aq1, { requestId: rid(), day: k, mode: "SURFACE" }, at(k, "09:00"));
    // a change of mind the same day: the last one stands, both audited
    const changed = await setFeedingMode(f.aq1, { requestId: rid(), day: k, mode: "NONE" }, at(k, "10:00"));
    expect(changed).toEqual({ changed: true });
    // the same choice again: no change, no audit
    expect(await setFeedingMode(f.aq1, { requestId: rid(), day: k, mode: "NONE" }, at(k, "10:05"))).toEqual({ changed: false });
    const fd = await prisma.feedingDay.findUniqueOrThrow({ where: { businessDay: new Date(`${k}T00:00:00Z`) } });
    const audits = await prisma.auditEntry.findMany({ where: { entityType: "FeedingDay", entityId: fd.id }, orderBy: { at: "asc" } });
    expect(audits.map((x) => (x.changes as { feedingMode?: unknown }).feedingMode).filter(Boolean)).toEqual([
      { before: null, after: "SURFACE" },
      { before: "SURFACE", after: "NONE" },
    ]);
    // an aquarist may not set a past day (the list's rules)
    await expect(setFeedingMode(f.aq1, { requestId: rid(), day: m, mode: "NONE" }, at(fs, "09:00"))).rejects.toMatchObject({ status: 403 });

    const ws = await sheet((await buildEatingWorkbook({ from: m, to: days[3] })).buffer);
    const note = ws.getRow(ws.rowCount - 1);
    const row = ws.getRow(ws.rowCount);
    expect(note.getCell(1).value).toBe("Megjegyzés");
    expect([row.getCell(1).value, row.getCell("E").value, row.getCell("F").value, row.getCell("G").value, row.getCell("H").value]).toEqual([
      "Etetés",
      "M",
      "F",
      "K",
      null,
    ]);
  });

  /*
    Lili 2026-11-11 10:40 UTC (acrobot 46861): a day whose feeding mode is empty gets K when it is closed, by the automatic
    close or by an admin; K stays a choice. WHAT TURNS THIS RED: a chosen mode overwritten at the close; an empty day left
    empty after its close; the K written without an audit row or under another author; a day closed BEFORE the rule
    back-filled by a later run of the job. The days are in 2018: the job closes every open day before its "today", and no
    other spec of this file has one there.
  */
  it("an empty feeding mode becomes K at the close (automatic and by hand), a chosen one stays, an earlier closed day is not back-filled", async () => {
    const [d0, d1, d2, d3, d4] = ["2018-03-01", "2018-03-02", "2018-03-03", "2018-03-04", "2018-03-05"];
    const modeOf = async (d: string) =>
      (await prisma.feedingDay.findUniqueOrThrow({ where: { businessDay: new Date(`${d}T00:00:00Z`) } })).feedingMode;

    // d0: a day closed before the rule existed (its lock set closed directly), its mode empty
    await runJournalJob(at(d0, "09:00"));
    await prisma.journalDay.updateMany({ where: { kind: "FEEDING", businessDay: new Date(`${d0}T00:00:00Z`) }, data: { state: "CLOSED" } });

    await runJournalJob(at(d1, "09:00"));
    await runJournalJob(at(d2, "09:00")); // closes d1, empty
    await setFeedingMode(f.aq1, { requestId: rid(), day: d2, mode: "SURFACE" }, at(d2, "10:00"));
    await runJournalJob(at(d3, "09:00")); // closes d2, chosen
    expect([await modeOf(d0), await modeOf(d1), await modeOf(d2)]).toEqual([null, "NONE", "SURFACE"]);

    const fd1 = await prisma.feedingDay.findUniqueOrThrow({ where: { businessDay: new Date(`${d1}T00:00:00Z`) } });
    const auto = await prisma.auditEntry.findMany({ where: { entityType: "FeedingDay", entityId: fd1.id } });
    expect(auto.map((x) => [x.userId, (x.changes as { feedingMode?: unknown }).feedingMode])).toEqual([
      [SYSTEM_USER_ID, { before: null, after: "NONE" }],
    ]);

    // an admin's close of an open day with no choice: K, audited as the admin
    const closeBy = rid();
    await recloseDay(f.admin, { requestId: closeBy, kind: "FEEDING", day: d3 }, at(d3, "20:00"));
    expect(await modeOf(d3)).toBe("NONE");
    const fd3 = await prisma.feedingDay.findUniqueOrThrow({ where: { businessDay: new Date(`${d3}T00:00:00Z`) } });
    const byHand = await prisma.auditEntry.findMany({ where: { entityType: "FeedingDay", entityId: fd3.id } });
    expect(byHand.map((x) => [x.userId, x.requestId])).toEqual([[f.admin.id, closeBy]]);

    // a later run: the day closed before the rule stays empty
    await runJournalJob(at(d4, "09:00"));
    expect(await modeOf(d0)).toBe(null);
  });

  // Lili 2026-10-26 (card f67b1a06, item 4): the export follows the admin's order of the animals
  it("the eating sheet lists the animals in the admin's order; with no order placed it is species, then name", async () => {
    const period = { from: "2026-04-07", to: "2026-04-09" };
    const namesOf = async () => {
      const ws = await sheet((await buildEatingWorkbook(period)).buffer);
      const out: string[] = [];
      ws.eachRow((r, n) => {
        const name = r.getCell(2).value;
        // the two closing rows (the note row, and the feeding mode row of f0552bd4) are not animals
        if (n > 2 && !["Megjegyzés", "Etetés"].includes(String(r.getCell(1).value)) && typeof name === "string" && name) out.push(name);
      });
      return out;
    };
    const before = await namesOf();
    expect(before.length).toBeGreaterThanOrEqual(3);
    try {
      const reversed = [...before].reverse();
      for (const [i, name] of reversed.entries()) {
        const animalId = (await prisma.animalName.findFirstOrThrow({ where: { name } })).animalId;
        await prisma.animal.update({ where: { id: animalId }, data: { sortOrder: i } });
      }
      expect(await namesOf()).toEqual(reversed);
    } finally {
      await prisma.animal.updateMany({ data: { sortOrder: null } });
    }
    expect(await namesOf()).toEqual(before);
  });
});
