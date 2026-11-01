// Lili 2026-11-01, points 5 and 8: the chemical dosing log and the Kimutatások as PDFs made on the server, read back. Days in
// January 2029, used by no other test.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { invalidateDosing, saveDosing } from "@/lib/dosing";
import { buildDosingPdf } from "@/lib/exports/dosing-pdf";
import { buildReportPdf } from "@/lib/exports/report-pdf";
import { saveFeedingItem, setSelection } from "@/lib/feeding";
import { readPdfLines } from "../support/pdf-readback";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const a: Record<string, string> = {};
const feed: Record<string, string> = {};
const chem: Record<string, string> = {};
const unit: Record<string, string> = {};
let groupId = "";
const at = (d: string, t: string) => new Date(`${d}T${t}:00+01:00`);

beforeAll(async () => {
  f = await fixtures();
  for (const n of await prisma.animalName.findMany()) a[n.name] = n.animalId;
  for (const n of await prisma.feedName.findMany()) feed[n.name] = n.feedId;
  for (const n of await prisma.chemicalName.findMany()) chem[n.name] = n.chemicalId;
  for (const u of await prisma.unit.findMany()) unit[u.symbol] = u.id;
  groupId = (await prisma.animalGroupName.findFirstOrThrow({ where: { name: "Teszt csoport" } })).groupId;
});

const dose = (d: string, t: string, q: string) =>
  saveDosing(f.aq1, { requestId: rid(), performedAtLocal: `${d}T${t}`, poolId: f.pool("SOZO"), chemicalId: chem["Teszt só"], quantity: q, unitId: unit.g }, at(d, t));

describe("the dosing log PDF (point 5)", () => {
  it("the title and the period, the valid dosings in time order, the total per chemical; an invalidated one is only counted", async () => {
    await dose("2029-01-08", "09:00", "500");
    await dose("2029-01-09", "10:15", "250");
    const wrong = (await dose("2029-01-09", "11:00", "999")) as { dosingId: string };
    await invalidateDosing(f.aq1, wrong.dosingId, { requestId: rid(), expectedVersion: 1, reason: "rossz szer" }, at("2029-01-09", "11:30"));
    const { buffer, rows } = await buildDosingPdf({ from: "2029-01-08", to: "2029-01-09", poolId: null, chemicalId: null });
    expect(rows).toBe(2);
    const lines = await readPdfLines(new Uint8Array(buffer));
    expect(lines[0]).toBe("Cápasuli vegyszeradagolás: 2029.01.08. – 2029.01.09.");
    expect(lines.some((l) => l === "Időszak: 2029.01.08. – 2029.01.09.; 1 érvénytelenített tétel nem szerepel.")).toBe(true);
    const i500 = lines.findIndex((l) => l.startsWith("2029.01.08. 09:00") && l.includes("Sózó") && l.includes("Teszt só") && l.includes("500 g"));
    const i250 = lines.findIndex((l) => l.startsWith("2029.01.09. 10:15") && l.includes("250 g"));
    expect(i500).toBeGreaterThan(0);
    expect(i250).toBeGreaterThan(i500);
    expect(lines.some((l) => l.includes("999"))).toBe(false);
    expect(lines).toContain("Összesen szerenként");
    expect(lines).toContain("Teszt só 750 g");
  });
});

describe("the Kimutatások PDF (point 8)", () => {
  it("landscape, the two breakdowns, a separate table per feed group, the totals", async () => {
    const d = "2029-01-10";
    const now = at(d, "09:00");
    await setSelection(f.aq1, { requestId: rid(), day: d, animalIds: [a["Teszt Egy"]], selected: true }, now);
    await saveFeedingItem(f.aq1, { requestId: rid(), day: d, animalId: a["Teszt Egy"], feedId: feed["Litopenaeus vannamei"], quantities: [{ value: "6", unitId: unit.db }, { value: "40", unitId: unit.g }] }, now);
    await saveFeedingItem(f.aq1, { requestId: rid(), day: d, groupId, feedId: feed["Teszt hal"], quantities: [{ value: "0,3", unitId: unit.kg }] }, now);
    const { buffer } = await buildReportPdf({ from: d, to: d, poolId: null, animalId: null });
    const pdf = await getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, useSystemFonts: false }).promise;
    const view = (await pdf.getPage(1)).getViewport({ scale: 1 });
    expect(view.width).toBeGreaterThan(view.height); // landscape
    const lines = await readPdfLines(new Uint8Array(buffer));
    expect(lines[0]).toBe("Cápasuli kimutatás: 2029.01.10.");
    for (const s of ["Napokra bontva", "Kinek", "Összesítés"]) expect(lines, s).toContain(s);
    // one dot after the period's date, never two; no box for a feed type's icon
    expect(lines.some((l) => l.includes(".."))).toBe(false);
    expect(lines.some((l) => l.includes("\u0000"))).toBe(false);
    const types = await prisma.feed.findMany({ where: { id: { in: [feed["Litopenaeus vannamei"], feed["Teszt hal"]] } }, include: { type: true } });
    const typeOf = (id: string) => types.find((t) => t.id === id)!.type.name;
    // a table per feed group: the two feeds' types are two groups, each its own heading and header row, twice (by day, by recipient)
    expect(typeOf(feed["Litopenaeus vannamei"])).not.toBe(typeOf(feed["Teszt hal"]));
    for (const id of [feed["Litopenaeus vannamei"], feed["Teszt hal"]]) expect(lines.filter((l) => l === typeOf(id)).length, typeOf(id)).toBe(2);
    const litHead = lines.filter((l) => l.startsWith("Nap ") && l.includes("Litopenaeus vannamei (db)"));
    expect(litHead).toHaveLength(1);
    expect(litHead[0]).not.toContain("Teszt hal");
    expect(lines.some((l) => l.startsWith("Nap ") && l.includes("Teszt hal (g)") && !l.includes("Litopenaeus"))).toBe(true);
    expect(lines.some((l) => l.startsWith("2029.01.10.") && l.includes("6") && l.includes("40"))).toBe(true);
    // the whole period, grams in kg from 1000 g: 40 g + 300 g = 340 g; 6 pieces
    expect(lines.some((l) => l.startsWith("Összesen") && l.includes("340"))).toBe(true);
  });

  it("a period without feeding says so", async () => {
    const lines = await readPdfLines(new Uint8Array((await buildReportPdf({ from: "2029-01-20", to: "2029-01-20", poolId: null, animalId: null })).buffer));
    expect(lines).toContain("Az időszakban nem volt etetés.");
  });
});
