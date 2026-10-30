import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { csvField, fileName, monthlyFileName, rowHash, zimsRow, type ZimsRow } from "@/lib/exports/zims";

// Lili 2026-10-30 14:26 UTC (acrobot 38841, task caparium-datum-ponttal): the dates of the application are dotted (2026.10.30.) everywhere a
// person reads one, but "maradjon meg, tudja a ZIMS formátumot konvertálni, ne legyen bibije": the ZIMS export's output stays, to the letter, what it
// was. The expected text below is the ZIMS file as the code produced it BEFORE the dotted dates; the ZIMS branch does not use the shared formatter.
const TZ = "Europe/Budapest";
const at = (iso: string) => new Date(iso);
const names = (zimsName: string) => [{ zimsName, validFrom: at("2026-01-01T00:00:00Z"), validTo: null }];

const map = {
  unitNames: [{ unitId: "u-ppt", parameterId: null, zimsUnit: "ppt", validFrom: at("2026-01-01T00:00:00Z"), validTo: null }, { unitId: "u-ph", parameterId: "p-ph", zimsUnit: "pH", validFrom: at("2026-01-01T00:00:00Z"), validTo: null }],
  userZims: new Map([["user-1", [{ zimsName: "Teszt Admin", validFrom: at("2026-01-01T00:00:00Z"), validTo: null }]]]),
};
const m = (id: string, measuredAt: string, parameterId: string, code: string, zimsName: string, decimals: number, unitId: string, symbol: string, value: string) =>
  ({ id, measuredAt: at(measuredAt), parameterId, unitId, responsibleUserId: "user-1", value, unit: { symbol }, parameter: { code, decimals, zimsNames: names(zimsName) } }) as never;

const measurements = [
  m("m1", "2026-10-06T15:08:00Z", "p-sal", "SAL", "Salinity", 1, "u-ppt", "ppt", "35.04"),
  m("m2", "2026-10-15T21:30:00Z", "p-ph", "PH", "pH", 2, "u-ph", "pH", "8.125"),
  m("m3", "2026-10-15T22:30:00Z", "p-ph", "PH", "pH", 2, "u-ph", "pH", "8"),
  m("m4", "2026-01-06T16:08:00Z", "p-sal", "SAL", "Salinity", 1, "u-ppt", "ppt", "34.9"),
];

describe("the ZIMS file, to the letter", () => {
  const rows = measurements.map((x) => zimsRow(x, map as never, TZ)) as ZimsRow[];
  const csv = ["Date,Time,Measurement,Value,Unit,Measured by", ...rows.map((r) => r.map((f) => csvField(f, ",")).join(","))].join("\r\n") + "\r\n";

  it("the rows are what they were: English month, unpadded day, comma, year; 24-hour time; the local day", () => {
    expect(rows).toEqual([
      ["Oct 6, 2026", "17:08", "Salinity", "35.0", "ppt", "Teszt Admin"],
      ["Oct 15, 2026", "23:30", "pH", "8.13", "pH", "Teszt Admin"],
      ["Oct 16, 2026", "00:30", "pH", "8.00", "pH", "Teszt Admin"],
      ["Jan 6, 2026", "17:08", "Salinity", "34.9", "ppt", "Teszt Admin"],
    ]);
  });

  it("the file's text and its hash are what they were, and no date of it has a dotted or hyphenated form", () => {
    expect(csv).toBe(
      'Date,Time,Measurement,Value,Unit,Measured by\r\n"Oct 6, 2026",17:08,Salinity,35.0,ppt,Teszt Admin\r\n"Oct 15, 2026",23:30,pH,8.13,pH,Teszt Admin\r\n"Oct 16, 2026",00:30,pH,8.00,pH,Teszt Admin\r\n"Jan 6, 2026",17:08,Salinity,34.9,ppt,Teszt Admin\r\n',
    );
    expect(createHash("sha256").update(csv, "utf8").digest("hex")).toBe("8f6ef82453f51ad70710c962757473cffb33b0a41ce2bfe7594522cd17d99c91");
    expect(csv).not.toMatch(/\d{4}\.\d{2}\.\d{2}\./);
    expect(csv).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("the row hashes (they identify the written row in the export items) and the file names are unchanged", () => {
    expect(rowHash(rows[0])).toBe("d037723c9e5941eecb68dacb0ff750b5d54af6c862a281b5787741c4f4369113");
    expect(fileName("Nagymedence", "2026-10-01", "2026-10-31")).toBe("ZIMS-Nagymedence-2026-10-01_2026-10-31.csv");
    expect(monthlyFileName("Nagymedence", "2026-10-01")).toBe("2026_Nagymedence_10_ZIMSimport.csv");
  });
});

describe("the ZIMS branch does not use the shared dotted formatter", () => {
  const lib = (f: string) => readFileSync(join(__dirname, "..", "..", "src", "lib", f), "utf-8");
  const shared = /\b(formatDay|formatPeriod|formatDateTime|EXCEL_DATE_FORMAT|huDay|huPeriod)\b/;

  it("zims.ts names none of the shared date formatters, and does not import intake-report-text", () => {
    expect(lib("exports/zims.ts")).not.toMatch(shared);
  });
});
