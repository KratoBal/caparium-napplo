// Test-environment seed. SYNTHETIC data only: no real person, no zoo record. It first loads the
// basic data (src/lib/base-data.ts, which every start loads without a password), then adds what only a
// test environment gets: the test users, the reference ranges as PLACEHOLDER TEST VALUES (not the
// customer's references; the admin sets the real ones), and the synthetic master data behind its
// switch. Idempotent: running it twice changes nothing.

import { PrismaClient } from "@prisma/client";
import { rebuildAnimal } from "../src/lib/animals";
import { hashPassword } from "../src/lib/auth";
import { BASE_FEEDS, loadBaseData, PARAMETERS, SINCE } from "../src/lib/base-data";
import { syntheticWanted } from "../src/lib/seed-switch";

const prisma = new PrismaClient();
const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";

// The synthetic test feeds (feladat-4, 7. pont): no real animal, name or zoo record. Litopenaeus
// vannamei is the data model's own example of a feed counted in pieces AND grams (DN-16); the basic data's
// starting list has it too, so by name it is made once. The test system's synthetic feeds are inactive
// since migration 20261020080100_synthetic_feeds_off (caparium-hibak-1): the real list replaced them there.
const FEEDS = [
  { type: "KAGYLO", name: "Teszt kagyló", dims: ["MASS"], unit: "g" },
  { type: "RAK", name: "Litopenaeus vannamei", dims: ["MASS", "COUNT"], unit: "g" },
  { type: "HAL", name: "Teszt hal", dims: ["MASS"], unit: "g" },
  { type: "LABASFEJU", name: "Teszt tintahal", dims: ["MASS"], unit: "g" },
  { type: "APRO", name: "Teszt plankton", dims: ["VOLUME"], unit: "ml" },
] as const;
const CHEMICALS = [
  { name: "Teszt só", unit: "kg" },
  { name: "Teszt kalcium", unit: "l" },
] as const;
const SPECIES = ["Teszt faj A", "Teszt faj B", "Teszt faj C"];
const ANIMALS = [
  { name: "Teszt Egy", species: 0, sex: "FEMALE", pool: "NAGY", group: "Teszt csoport" },
  { name: "Teszt Kettő", species: 0, sex: "MALE", pool: "NAGY", group: "Teszt csoport" },
  { name: "Teszt Három", species: 1, sex: "UNKNOWN", pool: "NAGY", group: null },
  { name: "Teszt Négy", species: 2, sex: "FEMALE", pool: "RAGADOZOS", group: null },
] as const;

const USERS = [
  { loginId: "teszt.admin", fullName: "Teszt Admin", role: "ADMIN" as const, monogram: "TA", zims: "Test Admin" },
  { loginId: "teszt.akvarista1", fullName: "Teszt Akvarista Egy", role: "AQUARIST" as const, monogram: "AE", zims: "Test Aquarist One" },
  { loginId: "teszt.akvarista2", fullName: "Teszt Akvarista Kettő", role: "AQUARIST" as const, monogram: "AK", zims: "Test Aquarist Two" },
];

async function main() {
  const synthetic = syntheticWanted();
  const password = process.env.SEED_TEST_PASSWORD;
  if (!password || password.length < 10) {
    throw new Error("SEED_TEST_PASSWORD must be set (at least 10 characters); the seed never uses a built-in password.");
  }

  const { unitId, paramId, poolId } = await loadBaseData(prisma);

  // the placeholder reference ranges, only where a parameter has none (an admin's range stays)
  for (const p of PARAMETERS) {
    const parameterId = paramId.get(p.code)!;
    if (await prisma.referenceRange.findFirst({ where: { parameterId } })) continue;
    await prisma.referenceRange.create({
      data: { parameterId, min: p.ref[0], max: p.ref[1], unitId: unitId.get(p.unit)!, validFrom: SINCE, createdById: SYSTEM_USER_ID },
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

  // the synthetic test feeds, by name (the basic data put "Egyéb" first)
  if (synthetic) {
    const have = new Set((await prisma.feedName.findMany()).map((n) => n.name));
    let sortOrder = (await prisma.feed.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? BASE_FEEDS.length;
    for (const f of FEEDS) {
      if (have.has(f.name)) continue;
      const type = await prisma.feedType.findUniqueOrThrow({ where: { code: f.type } });
      await prisma.feed.create({
        data: {
          typeId: type.id,
          allowedDimensions: [...f.dims],
          defaultUnitId: unitId.get(f.unit)!,
          sortOrder: (sortOrder += 1),
          names: { create: { name: f.name, validFrom: SINCE } },
        },
      });
    }
  }
  // stage 3, dosing: synthetic chemicals, each with its stock unit (JAV-09); the real list comes later
  if (synthetic) {
    const have = new Set((await prisma.chemicalName.findMany()).map((n) => n.name));
    for (const c of CHEMICALS) {
      if (have.has(c.name)) continue;
      await prisma.chemical.create({ data: { stockUnitId: unitId.get(c.unit)!, names: { create: { name: c.name, validFrom: SINCE } } } });
    }
  }
  // by the first synthetic animal's name, not "no species yet": the basic data's starting list brings species
  if (synthetic && !(await prisma.animalName.findFirst({ where: { name: ANIMALS[0].name } }))) {
    const species: { id: string }[] = [];
    for (const name of SPECIES) species.push(await prisma.species.create({ data: { scientificName: name } }));
    const group = await prisma.animalGroup.create({ data: { names: { create: { name: "Teszt csoport", validFrom: SINCE } } } });
    for (const [i, a] of ANIMALS.entries()) {
      await prisma.$transaction(async (tx) => {
        const animal = await tx.animal.create({
          data: { speciesId: species[a.species].id, sex: a.sex, names: { create: { name: a.name, validFrom: SINCE } } },
        });
        await tx.lifecycleEvent.create({
          data: {
            animalId: animal.id,
            type: "ARRIVAL",
            occurredAt: SINCE,
            businessDay: new Date("2026-01-01T00:00:00.000Z"),
            toPoolId: poolId.get(a.pool)!,
            toGroupId: a.group ? group.id : null,
            requestId: `seed-arrival-${i + 1}`,
            createdById: SYSTEM_USER_ID,
            updatedById: SYSTEM_USER_ID,
          },
        });
        await rebuildAnimal(tx, animal.id);
      });
    }
  }

  console.log(`seed ok: ${USERS.length} users, ${PARAMETERS.length} reference ranges at most, synthetic master data ${synthetic ? "on" : "off"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
