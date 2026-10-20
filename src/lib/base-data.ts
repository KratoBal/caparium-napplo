// THE BASIC DATA (task caparium-alapadat, a go-live condition, acrobot 33140): units, water parameters,
// pools, measurement groups, the ZIMS names and export profile, the feed types and the "Egyéb" feed, and
// the description's starting lists of feeds and animals (src/lib/initial-data.ts, caparium-hibak-1).
// Loaded WITHOUT a password at every container start (scripts/start.sh -> dist/base-data.cjs), because
// a live system has no SEED_TEST_PASSWORD, and until 2026-10-19 all of this came only from the
// password seed: the stage showed an empty feed type list and "Invalid UUID" (Balázs, #23).
// The test users, the placeholder reference ranges and the synthetic data stay in prisma/seed.ts.
//
// Idempotent: a row is created only where it is missing, and an existing row is never changed (an
// admin's rename, icon or deactivation stays). Pool and parameter names are the starting values of
// the data model (DN-01, DN-02); the groups follow the NY-03 default.

import type { Dimension, PrismaClient } from "@prisma/client";
import { loadInitialAnimals, loadInitialFeeds } from "./initial-data";

export const SINCE = new Date("2025-12-31T23:00:00.000Z"); // 2026-01-01 00:00 Europe/Budapest

export const UNITS: { symbol: string; dimension: Dimension; factor: string | null; base: boolean }[] = [
  { symbol: "ppm", dimension: "CONCENTRATION", factor: "1", base: true },
  { symbol: "ppt", dimension: "CONCENTRATION", factor: "1000", base: false },
  { symbol: "°C", dimension: "TEMPERATURE", factor: "1", base: true },
  { symbol: "mV", dimension: "VOLTAGE", factor: "1", base: true },
  { symbol: "pH", dimension: "DIMENSIONLESS", factor: null, base: true },
  { symbol: "dKH", dimension: "HARDNESS", factor: "1", base: true },
  { symbol: "g", dimension: "MASS", factor: "1", base: true },
  { symbol: "kg", dimension: "MASS", factor: "1000", base: false },
  { symbol: "db", dimension: "COUNT", factor: "1", base: true },
  { symbol: "ml", dimension: "VOLUME", factor: "1", base: true },
  { symbol: "l", dimension: "VOLUME", factor: "1000", base: false },
];

export const PARAMETERS = [
  { code: "SAL", name: "Sűrűség", unit: "ppt", decimals: 1, plausible: ["0", "60"], ref: ["33", "36"] },
  { code: "PH", name: "pH", unit: "pH", decimals: 2, plausible: ["0", "14"], ref: ["8", "8.4"] },
  { code: "TEMP", name: "Hőmérséklet", unit: "°C", decimals: 1, plausible: ["0", "40"], ref: ["23", "26"] },
  { code: "ORP", name: "ORP", unit: "mV", decimals: 0, plausible: ["-500", "1000"], ref: ["250", "400"] },
  { code: "KH", name: "KH", unit: "dKH", decimals: 1, plausible: ["0", "30"], ref: ["7", "11"] },
  { code: "MG", name: "Mg", unit: "ppm", decimals: 0, plausible: ["0", "3000"], ref: ["1250", "1400"] },
  { code: "CA", name: "Ca", unit: "ppm", decimals: 0, plausible: ["0", "1000"], ref: ["380", "450"] },
  { code: "NO3", name: "NO3", unit: "ppm", decimals: 2, plausible: ["0", "200"], ref: [null, "10"] },
  { code: "PO4", name: "PO4", unit: "ppm", decimals: 2, plausible: ["0", "20"], ref: [null, "0.1"] },
] as const;

// ZIMS mapping, letter by letter from the customer's description (leírás II.4, tables "Elnevezések"
// and "Mértékegységek"; DN-05: not rewritten). The workers' ZIMS names are NOT here: real personal data.
export const ZIMS_PARAMETER_NAMES: Record<string, string> = {
  PH: "pH",
  SAL: "Salinity",
  TEMP: "Water temperature",
  PO4: "Phosphates",
  CA: "Calcium (Ca)",
  KH: "Total alkalinity",
  NO3: "Nitrate (NO₃⁻)",
  MG: "Magnesium (Mg₂⁺)",
  ORP: "ORP",
};
export const ZIMS_UNIT_NAMES: Record<string, string> = {
  pH: "pH",
  ppt: "parts per thousand",
  "°C": "degree Celsius",
  ppm: "parts per million",
  dKH: "dKH",
  mV: "mV",
};

export const POOLS = [
  { code: "NAGY", name: "Nagymedence" },
  { code: "KIS", name: "Kismedence" },
  { code: "KARANTEN", name: "Karantén" },
  { code: "KORALLOS", name: "Korallos" },
  { code: "INKUBATOR", name: "Inkubátor" },
  { code: "RAGADOZOS", name: "Ragadozós" },
  { code: "KIS_SOZO", name: "Kis sózó" },
  { code: "SOZO", name: "Sózó" },
];

export const GROUPS = [
  {
    code: "NAPI_NAGY",
    name: "Nagy medencék",
    frequency: "DAILY" as const,
    active: true,
    pools: ["NAGY", "KIS", "KARANTEN"],
    params: ["SAL", "PH", "TEMP", "ORP"],
  },
  {
    code: "NAPI_KIS",
    name: "Kismedencék",
    frequency: "DAILY" as const,
    active: true,
    pools: ["KORALLOS", "INKUBATOR", "RAGADOZOS"],
    params: ["SAL", "PH", "TEMP", "ORP"],
  },
  {
    code: "HETI",
    name: "Heti mérés",
    frequency: "WEEKLY" as const,
    active: true,
    pools: ["NAGY", "KIS", "KARANTEN", "KORALLOS", "INKUBATOR", "RAGADOZOS"],
    params: ["KH", "MG", "CA", "NO3", "PO4"],
  },
];

// The feed types are the data model's list (adatmodell 11.). No separate coral feed type: the coral feeds
// are small and liquid feeds (Balázs 2026-10-20, caparium-hibak-1; migration 20261020080000_no_coral_feed_type).
export const FEED_TYPES = [
  ["KAGYLO", "Kagylók"],
  ["RAK", "Rákok"],
  ["LABASFEJU", "Lábasfejűek"],
  ["HAL", "Tengeri halak"],
  ["APRO", "Apró és folyékony takarmány"],
  ["EGYEB", "Egyéb"],
] as const;
// "Egyéb" is not synthetic: the KIV-04 and EGY-12 paths need it everywhere.
export const BASE_FEEDS = [
  // EGY-12, KIV-04: the "Egyéb" feed takes its real name in each item
  { type: "EGYEB", name: "Egyéb", dims: ["MASS"], unit: "g" },
] as const;
export const FEED_TYPE_ICONS: Record<string, string> = { KAGYLO: "🐚", RAK: "🦐", HAL: "🐟", LABASFEJU: "🦑", APRO: "💧", EGYEB: "➕" };

export interface BaseDataIds {
  unitId: Map<string, string>;
  paramId: Map<string, string>;
  poolId: Map<string, string>;
}

export async function loadBaseData(prisma: PrismaClient): Promise<BaseDataIds> {
  const unitId = new Map<string, string>();
  for (const u of UNITS) {
    const row = await prisma.unit.upsert({
      where: { symbol: u.symbol },
      update: {},
      create: { symbol: u.symbol, dimension: u.dimension, factorToBase: u.factor, isBase: u.base },
    });
    unitId.set(u.symbol, row.id);
  }

  // without reference ranges: the seed's ranges are placeholder test values, the admin sets the real ones
  const paramId = new Map<string, string>();
  for (const [i, p] of PARAMETERS.entries()) {
    const existing = await prisma.parameter.findUnique({ where: { code: p.code } });
    const row =
      existing ??
      (await prisma.parameter.create({
        data: {
          code: p.code,
          unitId: unitId.get(p.unit)!,
          decimals: p.decimals,
          plausibleMin: p.plausible[0],
          plausibleMax: p.plausible[1],
          sortOrder: i + 1,
          names: { create: { displayName: p.name, validFrom: SINCE } },
        },
      }));
    paramId.set(p.code, row.id);
  }

  const poolId = new Map<string, string>();
  for (const p of POOLS) {
    const existing = await prisma.pool.findUnique({ where: { code: p.code } });
    const row =
      existing ??
      (await prisma.pool.create({ data: { code: p.code, names: { create: { displayName: p.name, validFrom: SINCE } } } }));
    poolId.set(p.code, row.id);
  }

  for (const [i, g] of GROUPS.entries()) {
    if (await prisma.measurementGroup.findUnique({ where: { code: g.code } })) continue;
    await prisma.measurementGroup.create({
      data: {
        code: g.code,
        name: g.name,
        frequency: g.frequency,
        sortOrder: i + 1,
        active: g.active,
        memberships: { create: g.pools.map((c, j) => ({ poolId: poolId.get(c)!, sortOrder: j + 1, validFrom: SINCE })) },
        parameters: { create: g.params.map((c, j) => ({ parameterId: paramId.get(c)!, sortOrder: j + 1, validFrom: SINCE })) },
      },
    });
  }

  for (const [code, zimsName] of Object.entries(ZIMS_PARAMETER_NAMES)) {
    const parameterId = paramId.get(code)!;
    if (await prisma.zimsParameterName.findFirst({ where: { parameterId } })) continue;
    await prisma.zimsParameterName.create({ data: { parameterId, zimsName, validFrom: SINCE } });
  }
  for (const [symbol, zimsUnit] of Object.entries(ZIMS_UNIT_NAMES)) {
    const id = unitId.get(symbol)!;
    if (await prisma.zimsUnitName.findFirst({ where: { unitId: id, parameterId: null } })) continue;
    await prisma.zimsUnitName.create({ data: { unitId: id, zimsUnit, validFrom: SINCE } });
  }
  // Export profile v1 (adatmodell 5. terület): the sample file's header and CRLF, "Sep 20, 2026",
  // 24-hour local time, every row filled (T-14). Not yet approved by a trial import (NY-01).
  if (!(await prisma.zimsExportProfile.findUnique({ where: { version: 1 } }))) {
    await prisma.zimsExportProfile.create({
      data: {
        version: 1,
        datePattern: "MMM d, yyyy",
        timePattern: "HH:mm",
        decimalSeparator: ".",
        fieldSeparator: ",",
        lineEnding: "\r\n",
        encoding: "utf-8",
        header: "Date,Time,Measurement,MeasurementValue,UnitofMeasure,MeasuredBy",
        allRowsFilled: true,
        timeZone: "Europe/Budapest",
        active: true,
        validFrom: SINCE,
      },
    });
  }

  for (const [i, [code, name]] of FEED_TYPES.entries()) {
    // DAT-03: the default icon only when the type is created. Not "where none is set": this runs at
    // every start, and an icon an admin cleared would come back after each restart.
    await prisma.feedType.upsert({ where: { code }, update: {}, create: { code, name, sortOrder: i + 1, emoji: FEED_TYPE_ICONS[code] } });
  }
  // by name, not only into an empty table: a feed added to the list later (the "Egyéb" of stage 2)
  // reaches a database seeded before it
  {
    const have = new Set((await prisma.feedName.findMany()).map((n) => n.name));
    for (const [i, f] of BASE_FEEDS.entries()) {
      if (have.has(f.name)) continue;
      const type = await prisma.feedType.findUniqueOrThrow({ where: { code: f.type } });
      await prisma.feed.create({
        data: {
          typeId: type.id,
          allowedDimensions: [...f.dims],
          defaultUnitId: unitId.get(f.unit)!,
          sortOrder: i + 1,
          names: { create: { name: f.name, validFrom: SINCE } },
        },
      });
    }
  }
  // the description's starting lists (leírás 18-19. o.; caparium-hibak-1)
  await loadInitialFeeds(prisma, unitId, SINCE);
  await loadInitialAnimals(prisma, poolId, SINCE);
  return { unitId, paramId, poolId };
}
