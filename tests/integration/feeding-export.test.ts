// The feeding and eating Excel exports (EGY-10, EGY-11, EGY-12, EVE-05..EVE-07, EVE-09, EVE-10, D-30),
// read back cell by cell. Days in April 2026: no other file writes feeding days there.
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { createLifecycleEvent } from "@/lib/animals";
import { prisma } from "@/lib/db";
import { setEatingStatus } from "@/lib/eating";
import { buildEatingWorkbook, buildFeedingWorkbook } from "@/lib/exports/feeding-excel";
import { finalizeList, saveFeedingItem, setSelection } from "@/lib/feeding";
import { feedingLog } from "@/lib/feeding-log";
import { recloseDay } from "@/lib/journal";
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
    expect([ws.getCell("D1").value, ws.getCell("D2").value, ws.getCell("A3").value, ws.getCell("B3").value, ws.getCell("C3").value]).toEqual([
      "Takarmány",
      "Mértékegység",
      "Dátum",
      "Állatfaj",
      "Név",
    ]);
    expect([fillOf(ws.getCell("A1")), fillOf(ws.getCell("D1")), fillOf(ws.getCell("D2")), fillOf(ws.getCell("D3"))]).toEqual(["FF595959", "FFA6CAEC", "FFDCEAF7", "FF262626"]);
    // the Litopenaeus: one name over two columns, db then g (the template's J1:K1)
    const lit = colOf(ws, 1, "Litopenaeus vannamei");
    expect([ws.getRow(2).getCell(lit).value, ws.getRow(2).getCell(lit + 1).value]).toEqual(["db", "g"]);
    expect(ws.getRow(1).getCell(lit + 1).isMerged).toBe(true);

    const egy = rowOf(ws, 3, "Teszt Egy");
    expect([val(egy.getCell(lit)), val(egy.getCell(lit + 1))]).toEqual([6, 42.5]);
    // Lili 2026-10-29 (package item 13): no "Egyéb 1..5" and no note columns; the other name has a column of its own
    const other1 = colOf(ws, 1, "tintahal-fej");
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

    expect(val(rowOf(ws, 3, "Teszt Három").getCell(colOf(ws, 1, "Teszt hal")))).toBe(1000); // 1 kg in grams
    // EGY-05: an animal not fed that day has its row, its cells empty and coloured; a fed row's gaps too
    const negy = rowOf(ws, 3, "Teszt Négy");
    expect([negy.getCell(lit).value, fillOf(negy.getCell(lit)), fillOf(negy.getCell(other1))]).toEqual([null, "FFF2F2F2", "FFF2F2F2"]);
    expect([fillOf(egy.getCell(colOf(ws, 1, "Teszt hal"))), fillOf(egy.getCell(lit))]).toEqual(["FFF2F2F2", null]);
    const group = rowOf(ws, 3, "Teszt csoport (csoport)");
    expect(val(group.getCell(colOf(ws, 1, "Teszt kagyló")))).toBe(300);
    // EGY-11: the SUM row is the last one
    const last = ws.getRow(ws.rowCount);
    expect(last.getCell(1).value).toBe("SUM/Takarmány");
    expect(val(last.getCell(lit))).toBe(6);
    expect(val(last.getCell(gSum))).toBe(62.5 + 1000 + 300);
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
    const cols = names.map((n) => colOf(ws, 1, n));
    // by name (hu), next to each other, after every feed of the other types (Egyéb is the last type)
    const sortedNames = [...names].sort((x, y) => x.localeCompare(y, "hu"));
    expect(sortedNames.map((n) => colOf(ws, 1, n))).toEqual([...cols].sort((x, y) => x - y));
    expect(Math.max(...cols) - Math.min(...cols)).toBe(names.length - 1);
    expect(Math.min(...cols)).toBeGreaterThan(colOf(ws, 1, "Teszt hal"));
    const egy = rowOf(ws, 3, "Teszt Egy");
    expect(cols.map((c) => val(egy.getCell(c)))).toEqual(names.map(() => 2));
    const gSum = [0, 1].map((k) => colOf(ws, 1, "SUM/Állat", k)).find((c) => ws.getRow(2).getCell(c).value === "g")!;
    expect(val(egy.getCell(gSum))).toBe(10 + 2 * names.length);
  });
});

// Lili's package, item 12 follow-up (acrobot 38155, nautilus 38181): the same other name in another case or with other spaces is ONE
// column in the Excel and ONE feed in the report's log; the form first met is the header.
describe("the other feeds' names, normalized", () => {
  it("'Spirulina', ' spirulina ' and 'SPIRULINA' are one column and one report feed, under the first form", async () => {
    const d = "2028-04-04";
    const now = at(d, "09:00");
    await setSelection(f.aq1, { requestId: rid(), day: d, animalIds: [a["Teszt Egy"], a["Teszt Három"]], selected: true }, now);
    const give = (animal: string, otherName: string, value: string, time: string) =>
      saveFeedingItem(f.aq1, { requestId: rid(), day: d, animalId: a[animal], feedId: feed["Egyéb"], otherName, quantities: [{ value, unitId: unit.g }] }, at(d, time));
    await give("Teszt Egy", "Spirulina", "2", "09:00");
    await give("Teszt Három", "spirulina", "3", "09:05");
    await give("Teszt Egy", "ALGA", "1", "09:10"); // another name, to show the difference
    const ws = await sheet((await buildFeedingWorkbook({ from: d, to: d })).buffer);
    const heads: string[] = [];
    ws.getRow(1).eachCell((c) => heads.push(String(c.value)));
    expect(heads.filter((h) => h.toLowerCase() === "spirulina")).toEqual(["Spirulina"]); // one column, the first form
    const col = colOf(ws, 1, "Spirulina");
    expect(val(rowOf(ws, 3, "Teszt Egy").getCell(col))).toBe(2);
    expect(val(rowOf(ws, 3, "Teszt Három").getCell(col))).toBe(3);
    // the report's feed: one, with the first form, summed
    const log = await feedingLog({ from: d, to: d, poolId: null, animalId: null });
    const feeds = [...new Set(log.entries.map((e) => e.feed))].filter((x) => x.toLowerCase().includes("spirulina"));
    expect(feeds).toEqual(["Egyéb: Spirulina"]);
    expect(log.entries.filter((e) => e.feed === "Egyéb: Spirulina").reduce((n, e) => n + e.value, 0)).toBe(5);
  });
});

describe("the export period", () => {
  it("at most a year, refused before any work (the eating sheet has a column per day)", async () => {
    for (const build of [buildFeedingWorkbook, buildEatingWorkbook]) {
      await expect(build({ from: "2000-01-01", to: "2099-12-31" })).rejects.toMatchObject({ code: "PERIOD_TOO_LONG" });
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
    expect(() => rowOf(ws, 2, "Április Régi")).toThrow();
    expect(comes).toBeTruthy();
    // EVE-05, EVE-09: the note row is the last, the medicine note under its day
    const note = ws.getRow(ws.rowCount);
    expect(note.getCell(1).value).toBe("Megjegyzés");
    expect(note.getCell("E").value).toBe("Teszt Kettő: fél tabletta");
  });

  // Lili 2026-10-26 (card f67b1a06, item 4): the export follows the admin's order of the animals
  it("the eating sheet lists the animals in the admin's order; with no order placed it is species, then name", async () => {
    const period = { from: "2026-04-07", to: "2026-04-09" };
    const namesOf = async () => {
      const ws = await sheet((await buildEatingWorkbook(period)).buffer);
      const out: string[] = [];
      ws.eachRow((r, n) => {
        const name = r.getCell(2).value;
        if (n > 2 && r.getCell(1).value !== "Megjegyzés" && typeof name === "string" && name) out.push(name);
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
