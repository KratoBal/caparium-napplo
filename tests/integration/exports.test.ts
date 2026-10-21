// Exports (feladat-4 E, F; VIZ-11, VIZ-16..VIZ-21; adatmodell 15. terület, R-9, T-14, T-20).
// Days in March 2026: no other test file writes there.
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { buildWaterWorkbook, EXTRA_HEADER, TEMPLATE_HEADER } from "@/lib/exports/excel";
import { createZimsExport, divergence, setSubmissionState } from "@/lib/exports/zims";
import { createMeasurement, invalidateMeasurement, updateMeasurement } from "@/lib/measurements";
import { fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => {
  f = await fixtures();
});

async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e, `expected ${code}`).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
  return e as AppError;
}

const DAY = "2026-03-10"; // winter time: UTC+1
const at = (t: string) => new Date(`${DAY}T${t}:00+01:00`);

function measure(pool: string, param: string, value: string, time: string, group = "NAPI_NAGY", actor = f?.aq1) {
  return createMeasurement(
    actor,
    { requestId: rid(), groupId: f.group(group), poolId: f.pool(pool), parameterId: f.param(param), value, measuredAtLocal: `${DAY}T${time}` },
    at(time),
  );
}

describe("ZIMS CSV (VIZ-16..VIZ-19)", () => {
  let ph: string;
  let sal: string;
  let runId: string;

  it("one file per system, the sample's header, CRLF, quoted date, every row filled", async () => {
    ph = (await measure("NAGY", "PH", "8,12", "08:06")).measurement.id;
    sal = (await measure("NAGY", "SAL", "35", "08:07")).measurement.id;
    // ORP's unit is "millivolt" in ZIMS, as the sample file writes it (the zoo's answer, 2026-10-21), not "mV"
    await measure("NAGY", "ORP", "320", "08:08");
    await measure("KIS", "PH", "7,88", "08:09");
    const r = await createZimsExport(f.aq1, { requestId: rid(), from: DAY, to: DAY, poolIds: null, purpose: "SUBMISSION" });
    runId = r.runId;
    const files = await prisma.exportFile.findMany({ where: { exportRunId: runId }, orderBy: { fileName: "asc" } });
    expect(files.map((x) => x.fileName)).toEqual([`ZIMS-Kismedence-${DAY}.csv`, `ZIMS-Nagymedence-${DAY}.csv`]);
    expect(files[1].content).toBe(
      "Date,Time,Measurement,MeasurementValue,UnitofMeasure,MeasuredBy\r\n" +
        '"Mar 10, 2026",08:06,pH,8.12,pH,Test Aquarist One\r\n' +
        '"Mar 10, 2026",08:07,Salinity,35.0,parts per thousand,Test Aquarist One\r\n' +
        '"Mar 10, 2026",08:08,ORP,320,millivolt,Test Aquarist One\r\n',
    );
    expect(files[1].rowCount).toBe(3);
    expect(await prisma.exportItem.count({ where: { exportRunId: runId } })).toBe(4);
    expect(await prisma.auditEntry.count({ where: { entityId: runId, action: "EXPORT" } })).toBe(1);
  });

  it("exported is not submitted: only an admin marks the run as submitted", async () => {
    expect(await divergence(DAY, DAY)).toEqual([]);
    await expectCode(setSubmissionState(f.aq1, runId, { requestId: rid(), state: "SUBMITTED" }), "ADMIN_ONLY");
    await setSubmissionState(f.admin, runId, { requestId: rid(), state: "SUBMITTED" });
    expect((await prisma.exportRun.findUniqueOrThrow({ where: { id: runId } })).submissionState).toBe("SUBMITTED");
    await expectCode(setSubmissionState(f.admin, runId, { requestId: rid(), state: "REJECTED", reason: "késő" }), "ALREADY_DECIDED");
    expect(await divergence(DAY, DAY)).toEqual([]);
  });

  it("after the submission: a changed value, an invalidation and a late measurement are all reported (R-9)", async () => {
    const now = at("09:00");
    await updateMeasurement(f.aq1, ph, { requestId: rid(), expectedVersion: 1, value: "8,15" }, now);
    await invalidateMeasurement(f.aq1, sal, { requestId: rid(), expectedVersion: 1, reason: "rossz műszer" }, now);
    const late = (await measure("NAGY", "TEMP", "24,6", "08:30")).measurement.id;
    const d = await divergence(DAY, DAY);
    expect(d.map((x) => [x.measurementId, x.kind]).sort()).toEqual(
      [
        [ph, "MODIFIED"],
        [sal, "INVALIDATED"],
        [late, "NOT_SUBMITTED"],
      ].sort(),
    );
  });

  it("a correction of a ZIMS name is reported too, although no measurement changed (K3)", async () => {
    const zn = await prisma.zimsParameterName.findFirstOrThrow({ where: { parameterId: f.param("PH") } });
    await prisma.zimsParameterName.update({ where: { id: zn.id }, data: { zimsName: "pH value" } });
    try {
      const d = await divergence(DAY, DAY);
      const kis = d.filter((x) => x.poolName === "Kismedence");
      expect(kis.map((x) => x.kind)).toEqual(["MODIFIED"]);
    } finally {
      await prisma.zimsParameterName.update({ where: { id: zn.id }, data: { zimsName: "pH" } });
    }
  });

  it("a missing ZIMS name of the person stops the export with the reason; nothing is written (T-14)", async () => {
    const u = await prisma.user.create({ data: { loginId: `zims-nelkul-${Date.now()}`, fullName: "ZIMS Nélküli", role: "AQUARIST" } });
    await createMeasurement(
      { id: u.id, role: "AQUARIST" },
      { requestId: rid(), groupId: f.group("NAPI_KIS"), poolId: f.pool("KORALLOS"), parameterId: f.param("PH"), value: "8.1", measuredAtLocal: "2026-03-11T08:00" },
      new Date("2026-03-11T08:00:00+01:00"),
    );
    const runs = await prisma.exportRun.count();
    const e = await expectCode(
      createZimsExport(f.aq1, { requestId: rid(), from: "2026-03-11", to: "2026-03-11", poolIds: null, purpose: "TRIAL" }),
      "MAPPING_MISSING",
    );
    expect(JSON.stringify(e.details)).toContain("nincs ZIMS-neve");
    expect(await prisma.exportRun.count()).toBe(runs);
  });

  /*
    A HIBA EGYSZER, NÉV SZERINT, LINKKEL (acrobot 34387, a lili-eset: 136 mérés ugyanazzal a mondattal). MI PIROSÍT:
    ha mérésenként ismétlődik; ha nem nevezi meg a dolgozót; ha nincs mellette, hol pótolható.
  */
  it("a person's missing ZIMS name is one problem with the person's name, the count and the settings link", async () => {
    const u = await prisma.user.create({ data: { loginId: `zims-ketszer-${Date.now()}`, fullName: "Kétszer Mérő", role: "AQUARIST" } });
    // two cells (one value per cell and day), the same person
    for (const [param, value] of [["PH", "8.1"], ["SAL", "35"]] as const)
      await createMeasurement(
        { id: u.id, role: "AQUARIST" },
        { requestId: rid(), groupId: f.group("NAPI_NAGY"), poolId: f.pool("NAGY"), parameterId: f.param(param), value, measuredAtLocal: "2026-03-12T08:00" },
        new Date("2026-03-12T08:00:00+01:00"),
      );
    const e = await expectCode(
      createZimsExport(f.aq1, { requestId: rid(), from: "2026-03-12", to: "2026-03-12", poolIds: null, purpose: "TRIAL" }),
      "MAPPING_MISSING",
    );
    const problems = (e.details as { problems: { problem: string; count: number; link?: string }[] }).problems;
    const mine = problems.filter((p) => p.problem.includes(u.loginId));
    expect(mine.map((p) => [p.problem, p.count, p.link])).toEqual([
      [`Kétszer Mérő (${u.loginId}): nincs ZIMS-neve a mérés idejére`, 2, "/beallitasok#felhasznalok"],
    ]);
  });
});

describe("Excel (VIZ-11)", () => {
  it("a real workbook: the summary and one sheet per system, the template header plus dilution and RO/SW", async () => {
    const { buffer, rows } = await buildWaterWorkbook({ from: DAY, to: DAY, poolIds: null });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Vízmérés teljes", "Kismedence", "Nagymedence"]);
    const summary = wb.getWorksheet("Vízmérés teljes")!;
    expect((summary.getRow(1).values as unknown[]).slice(1)).toEqual([...TEMPLATE_HEADER, ...EXTRA_HEADER]);
    expect(summary.rowCount - 1).toBe(rows);
    // the invalidated salinity is not in the export; the corrected pH is
    const values = summary.getSheetValues().slice(2) as unknown[][];
    expect(values.some((v) => v[4] === "Sűrűség")).toBe(false);
    const kis = wb.getWorksheet("Kismedence")!;
    const r = kis.getRow(2);
    expect(r.getCell(1).value).toBe("2026.03.10");
    expect(r.getCell(2).value).toBe("08:09");
    expect(r.getCell(5).value).toBe(7.88);
    expect(r.getCell(5).font?.color?.argb).toBe("FFDF5B5B");
    expect(r.getCell(7).value).toBe("AE");
  });
});
