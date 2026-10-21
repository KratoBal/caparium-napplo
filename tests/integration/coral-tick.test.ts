// The coral feed on the feeding sheet is a tick (6fe63c9b item 7): an item without a quantity, for a feed with
// feed.sheetTick only; the list, the log and the feeding Excel say "adva". Days in August 2026 (feeding days: no other
// file writes there).
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { buildFeedingWorkbook } from "@/lib/exports/feeding-excel";
import { feedingDayView, saveFeedingItem, setSelection } from "@/lib/feeding";
import { feedingLog } from "@/lib/feeding-log";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
const a: Record<string, string> = {};
const feed: Record<string, string> = {};
const at = (d: string, t: string) => new Date(`${d}T${t}:00+02:00`);
const D = "2026-08-17";

beforeAll(async () => {
  f = await fixtures();
  for (const n of await prisma.animalName.findMany()) a[n.name] = n.animalId;
  for (const n of await prisma.feedName.findMany()) feed[n.name] = n.feedId;
  await setSelection(f.aq1, { requestId: rid(), day: D, animalIds: [a["Teszt Egy"]], selected: true }, at(D, "08:00"));
});

async function code(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(AppError);
  return (e as AppError).code;
}

describe("the coral feed tick (6fe63c9b item 7)", () => {
  it("the basic data marks the two coral feeds, and only them", async () => {
    const ticked = await prisma.feed.findMany({ where: { sheetTick: true }, include: { names: true } });
    expect(ticked.map((x) => x.names[0]!.name).sort()).toEqual(["AF Power elixir", "RE+ Coral nutrition AB+"]);
  });

  it("an item without a quantity: refused for an ordinary feed, saved for a coral feed", async () => {
    const now = at(D, "09:00");
    const save = (feedId: string) => saveFeedingItem(f.aq1, { requestId: rid(), day: D, animalId: a["Teszt Egy"], feedId, quantities: [] }, now);
    expect(await code(save(feed["Mysis"]))).toBe("QUANTITY_REQUIRED");
    await save(feed["AF Power elixir"]);
    const item = (await feedingDayView(D)).items.find((i) => i.feedId === feed["AF Power elixir"]);
    expect(item?.quantities).toEqual([]);
  });

  it("the log and the feeding Excel say adva", async () => {
    const log = await feedingLog({ from: D, to: D, poolId: null, animalId: a["Teszt Egy"] });
    expect(log.rows.find((r) => r.feed === "AF Power elixir")?.quantities).toBe("adva");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildFeedingWorkbook({ from: D, to: D })).buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    let col = 0;
    ws.getRow(1).eachCell((c, n) => {
      if (c.value === "AF Power elixir") col = n;
    });
    expect(col).toBeGreaterThan(0);
    let cell: unknown = null;
    ws.eachRow((r) => {
      if (r.getCell(3).value === "Teszt Egy") cell = r.getCell(col).value;
    });
    expect(cell).toBe("adva");
  });
});
