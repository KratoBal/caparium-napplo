// The test seed on a USED database (stage, 2026-10-30, acrobot 38512): the container restarted for an hour on a seed
// error. A name correction overwrites the name row (src/lib/animals.ts), so the seed, looking its animals up by name,
// made them again, and the unique `seed-arrival-1` stopped it, after the species and the group were written. On its
// own database next to the test database, because the shared one's animals are what the other tests use by name.
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const owner = new URL(process.env.OWNER_DATABASE_URL!);
const name = `${owner.pathname.slice(1)}_seedujra`;
const target = new URL(owner.toString());
target.pathname = `/${name}`;
const admin = new URL(owner.toString());
admin.pathname = "/postgres";
const besideTestDatabase = owner.pathname.slice(1).endsWith("_test");

// the stage's shape: the seed with the synthetic data on
const env: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: target.toString(),
  SEED_TEST_PASSWORD: "seed-ujra-proba-jelszo",
  CAPARIUM_SEED_SZINTETIKUS: "1",
};
delete (env as Record<string, string | undefined>).CI;

let db: PrismaClient;
const seed = () => execFileSync("npx", ["tsx", "prisma/seed.ts"], { stdio: "pipe", env });
const counts = async () => ({
  species: await db.species.count({ where: { scientificName: { startsWith: "Teszt faj" } } }),
  groups: await db.animalGroupName.count({ where: { name: "Teszt csoport" } }),
  animals: await db.animal.count(),
});

beforeAll(async () => {
  if (!besideTestDatabase) throw new Error(`this test needs a *_test owner database (got "${owner.pathname.slice(1)}")`);
  const server = new PrismaClient({ datasourceUrl: admin.toString() });
  try {
    await server.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await server.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await server.$disconnect();
  }
  execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "pipe", env });
  seed();
  db = new PrismaClient({ datasourceUrl: target.toString() });
}, 180_000);

afterAll(async () => {
  await db?.$disconnect();
  if (!besideTestDatabase) return;
  const server = new PrismaClient({ datasourceUrl: admin.toString() });
  try {
    await server.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await server.$disconnect();
  }
});

describe("the test seed on a used database", () => {
  it("made the synthetic animals once (the control: the first run really created them)", async () => {
    const c = await counts();
    expect(c.species).toBe(3);
    expect(c.groups).toBe(1);
    expect(c.animals).toBeGreaterThanOrEqual(4);
  });

  it("runs again without error after a name correction took 'Teszt Egy' away, and adds nothing", async () => {
    const before = await counts();
    // what a correction does (src/lib/animals.ts): the current name row itself is rewritten
    const row = await db.animalName.findFirstOrThrow({ where: { name: "Teszt Egy" } });
    await db.animalName.update({ where: { id: row.id }, data: { name: "Lili javította" } });
    expect(await db.animalName.count({ where: { name: "Teszt Egy" } })).toBe(0);

    expect(() => seed()).not.toThrow();
    expect(await counts()).toEqual(before);
  }, 120_000);
});
