// The basic data step (task caparium-alapadat, a go-live condition): on an EMPTY database, without a
// password, it loads the units, parameters, pools, groups, ZIMS names, export profile, feed types and
// the "Egyéb" feed, and nothing a test environment only gets (test users, placeholder reference ranges,
// synthetic data). A second run changes nothing. Runs on its own database next to the test database,
// created and dropped here as the owner, because the shared one is already seeded.
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FEED_TYPES, GROUPS, PARAMETERS, POOLS, UNITS } from "@/lib/base-data";

const owner = new URL(process.env.OWNER_DATABASE_URL!);
const name = `${owner.pathname.slice(1)}_alapadat`;
const target = new URL(owner.toString());
target.pathname = `/${name}`;
const admin = new URL(owner.toString());
admin.pathname = "/postgres";

// the step's own environment: no password, no synthetic switch, not CI
const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: target.toString() };
for (const name of ["SEED_TEST_PASSWORD", "CAPARIUM_SEED_SZINTETIKUS", "CI"]) delete (env as Record<string, string | undefined>)[name];

let db: PrismaClient;

async function counts() {
  const [units, parameters, ranges, pools, groups, feedTypes, feeds, users, species, chemicals, profiles] = await Promise.all([
    db.unit.count(),
    db.parameter.count(),
    db.referenceRange.count(),
    db.pool.count(),
    db.measurementGroup.count(),
    db.feedType.count(),
    db.feed.count(),
    db.user.count(),
    db.species.count(),
    db.chemical.count(),
    db.zimsExportProfile.count(),
  ]);
  return { units, parameters, ranges, pools, groups, feedTypes, feeds, users, species, chemicals, profiles };
}

beforeAll(async () => {
  const server = new PrismaClient({ datasourceUrl: admin.toString() });
  try {
    await server.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await server.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await server.$disconnect();
  }
  execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "pipe", env });
  execFileSync("npx", ["tsx", "prisma/base-data.ts"], { stdio: "pipe", env });
  db = new PrismaClient({ datasourceUrl: target.toString() });
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
  const server = new PrismaClient({ datasourceUrl: admin.toString() });
  try {
    await server.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await server.$disconnect();
  }
});

describe("the basic data, without a password", () => {
  it("an empty database gets the basic data and nothing a test environment only gets", async () => {
    expect(await counts()).toEqual({
      units: UNITS.length,
      parameters: PARAMETERS.length,
      ranges: 0, // placeholder test values: the test seed's, the admin sets the real ones
      pools: POOLS.length,
      groups: GROUPS.length,
      feedTypes: FEED_TYPES.length,
      feeds: 1, // "Egyéb"
      users: 1, // the System user of the init migration, no test user
      species: 0,
      chemicals: 0,
      profiles: 1,
    });
    expect((await db.feedName.findMany()).map((n) => n.name)).toEqual(["Egyéb"]);
    expect(await db.user.findMany({ select: { loginId: true } })).toEqual([{ loginId: "__system__" }]);
  });

  it("a second start changes nothing, and an admin's change stays", async () => {
    await db.feedType.update({ where: { code: "HAL" }, data: { name: "Halak (átnevezve)", emoji: null } });
    const before = await counts();
    execFileSync("npx", ["tsx", "prisma/base-data.ts"], { stdio: "pipe", env });
    expect(await counts()).toEqual(before);
    const hal = await db.feedType.findUniqueOrThrow({ where: { code: "HAL" } });
    expect(hal.name).toBe("Halak (átnevezve)");
    expect(hal.emoji, "a cleared icon does not come back at the next start").toBeNull();
    expect((await db.feedType.findUniqueOrThrow({ where: { code: "RAK" } })).emoji).toBe("🦐");
  }, 60_000);
});
