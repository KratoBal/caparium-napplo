// Test-environment seed. SYNTHETIC data only: no real person, no zoo record.
// Pool and parameter names are the starting values of the data model (DN-01, DN-02);
// the reference ranges are PLACEHOLDER TEST VALUES, not the customer's references
// (the admin sets the real ones). Idempotent: running it twice changes nothing.

import { PrismaClient, type Dimension } from "@prisma/client";
import { hashPassword } from "../src/lib/auth";

const prisma = new PrismaClient();
const SINCE = new Date("2025-12-31T23:00:00.000Z"); // 2026-01-01 00:00 Europe/Budapest
const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";

const UNITS: { symbol: string; dimension: Dimension; factor: string | null; base: boolean }[] = [
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

const PARAMETERS = [
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

const POOLS = [
  { code: "NAGY", name: "Nagymedence" },
  { code: "KIS", name: "Kismedence" },
  { code: "KARANTEN", name: "Karantén" },
  { code: "KORALLOS", name: "Korallos" },
  { code: "INKUBATOR", name: "Inkubátor" },
  { code: "RAGADOZOS", name: "Ragadozós" },
  { code: "KIS_SOZO", name: "Kis sózó" },
  { code: "SOZO", name: "Sózó" },
];

const GROUPS = [
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

const USERS = [
  { loginId: "teszt.admin", fullName: "Teszt Admin", role: "ADMIN" as const, monogram: "TA", zims: "Test Admin" },
  { loginId: "teszt.akvarista1", fullName: "Teszt Akvarista Egy", role: "AQUARIST" as const, monogram: "AE", zims: "Test Aquarist One" },
  { loginId: "teszt.akvarista2", fullName: "Teszt Akvarista Kettő", role: "AQUARIST" as const, monogram: "AK", zims: "Test Aquarist Two" },
];

async function main() {
  const password = process.env.SEED_TEST_PASSWORD;
  if (!password || password.length < 10) {
    throw new Error("SEED_TEST_PASSWORD must be set (at least 10 characters); the seed never uses a built-in password.");
  }

  const unitId = new Map<string, string>();
  for (const u of UNITS) {
    const row = await prisma.unit.upsert({
      where: { symbol: u.symbol },
      update: {},
      create: { symbol: u.symbol, dimension: u.dimension, factorToBase: u.factor, isBase: u.base },
    });
    unitId.set(u.symbol, row.id);
  }

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
          referenceRanges: {
            create: { min: p.ref[0], max: p.ref[1], unitId: unitId.get(p.unit)!, validFrom: SINCE, createdById: SYSTEM_USER_ID },
          },
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

  for (const u of USERS) {
    if (await prisma.user.findUnique({ where: { loginId: u.loginId } })) continue;
    await prisma.user.create({
      data: {
        loginId: u.loginId,
        fullName: u.fullName,
        role: u.role,
        passwordHash: await hashPassword(password),
        monograms: { create: { monogram: u.monogram, validFrom: SINCE } },
        zimsNames: { create: { zimsName: u.zims, validFrom: SINCE } },
      },
    });
  }

  console.log(`seed ok: ${UNITS.length} units, ${PARAMETERS.length} parameters, ${POOLS.length} pools, ${GROUPS.length} groups, ${USERS.length} users`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
