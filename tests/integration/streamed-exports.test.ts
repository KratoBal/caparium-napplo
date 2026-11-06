// The two ten-year row exports go out as a stream (task caparium-streamelo-excel, after #198): the feeding log and the
// Takarmányhűtő Excel are written row by row into the answer (src/lib/exports/xlsx-stream.ts). WHAT TURNS RED: the route answers
// with something that is not the whole file; a refusal (a period over ten years) comes as a broken download instead of a status;
// the export's record no longer says how many rows the file has.
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as feedingRoute } from "@/app/api/exports/feeding/route";
import { prisma } from "@/lib/db";
import { fixtures } from "./fixtures";
import { TEST_PASSWORD } from "./global-setup";

const BASE = "http://napplo.test";
beforeAll(async () => {
  await fixtures();
});

async function cookie(): Promise<string> {
  const res = await loginRoute(
    new Request(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { origin: BASE, host: "napplo.test", "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": `10.98.0.${Math.floor(Math.random() * 250)}` },
      body: new URLSearchParams({ loginId: "teszt.admin", password: TEST_PASSWORD }).toString(),
    }),
  );
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}
const post = (c: string, fields: Record<string, string>) =>
  feedingRoute(
    new Request(`${BASE}/api/exports/feeding`, {
      method: "POST",
      headers: { origin: BASE, host: "napplo.test", "content-type": "application/x-www-form-urlencoded", cookie: c },
      body: new URLSearchParams(fields).toString(),
    }),
  );
async function book(res: Response) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await res.arrayBuffer()) as ArrayBuffer);
  return wb;
}
const lastRun = () => prisma.auditEntry.findFirstOrThrow({ where: { entityType: "ExportRun" }, orderBy: { id: "desc" } });

describe("the streamed exports' route", () => {
  it("the feeding log: the whole file, its name, and the export's record with the rows of the file", async () => {
    const c = await cookie();
    // a week with no feeding: every animal alive has its empty row (EGY-05), and the SUM row closes the sheet
    const res = await post(c, { kind: "etetes", from: "2032-02-02", to: "2032-02-08" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="capasuli_takarmanynaplo_2032-02-02_2032-02-08\.xlsx"$/);
    const ws = (await book(res)).getWorksheet("Egyedi takarmánynapló")!;
    const rows = ((await lastRun()).changes as { export: { after: { kind: string; rows: number } } }).export.after;
    expect(rows.kind).toBe("EXCEL_FEEDING");
    expect(rows.rows).toBeGreaterThan(0);
    // three header rows, the data, the SUM row
    expect(ws.rowCount).toBe(3 + rows.rows + 1);
    expect(ws.getRow(ws.rowCount).getCell(1).value).toBe("SUM/Takarmány");
    expect(ws.views[0]).toMatchObject({ state: "frozen", xSplit: 4, ySplit: 3 });
  });

  it("the Takarmányhűtő Excel: both sheets", async () => {
    const c = await cookie();
    const res = await post(c, { kind: "huto", format: "xlsx", from: "2032-02-02", to: "2032-02-08" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/\.xlsx"$/);
    const wb = await book(res);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Bevételek", "Egyenleg"]);
    expect(wb.getWorksheet("Bevételek")!.getRow(3).getCell(1).value).toBe("Dátum");
    expect(((await lastRun()).changes as { export: { after: { kind: string } } }).export.after.kind).toBe("EXCEL_INTAKE");
  });

  it("over ten years: a 422 with the sentence, before any file, and no export recorded", async () => {
    const c = await cookie();
    const before = (await lastRun()).id;
    for (const fields of <Record<string, string>[]>[
      { kind: "etetes", from: "2016-01-01", to: "2026-12-31" },
      { kind: "huto", format: "xlsx", from: "2016-01-01", to: "2026-12-31" },
    ]) {
      const res = await post(c, fields);
      expect(res.status).toBe(422);
      expect(await res.text()).toBe("Legfeljebb tíz év kérhető le egyszerre.");
    }
    expect((await lastRun()).id).toBe(before);
  });
});
