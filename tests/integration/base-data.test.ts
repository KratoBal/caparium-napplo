// The basic data step (task caparium-alapadat, a go-live condition): on an EMPTY database, without a
// password, it loads the units, parameters, pools, groups, ZIMS names, export profile, feed types, the
// "Egyéb" feed and the description's starting feed list, and nothing a test environment only gets (test users,
// placeholder reference ranges, synthetic data, the description's starting animals). With
// CAPARIUM_SEED_SZINTETIKUS=1 (the test system) the starting animals come too (caparium-hibak-1). A second run changes nothing. Runs on its own database next to the test database,
// created and dropped here as the owner, because the shared one is already seeded.
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FEED_TYPES, GROUPS, PARAMETERS, POOLS, UNITS } from "@/lib/base-data";
import { INITIAL_ANIMALS, INITIAL_FEEDS } from "@/lib/initial-data";

const owner = new URL(process.env.OWNER_DATABASE_URL!);
const name = `${owner.pathname.slice(1)}_alapadat`;
const target = new URL(owner.toString());
target.pathname = `/${name}`;
const admin = new URL(owner.toString());
admin.pathname = "/postgres";

// the step's own environment: no password, no synthetic switch, not CI
const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: target.toString() };
for (const name of ["SEED_TEST_PASSWORD", "CAPARIUM_SEED_SZINTETIKUS", "CI"]) delete (env as Record<string, string | undefined>)[name];

// the test drops and creates a database: only ever next to a database named for testing, whatever
// OWNER_DATABASE_URL says (env.ts takes an outside one unchecked; barracuda, #24 review). The
// afterAll runs even when the beforeAll throws, so it checks the same flag.
const besideTestDatabase = owner.pathname.slice(1).endsWith("_test");

let db: PrismaClient;

async function counts() {
  const [units, parameters, ranges, pools, groups, feedTypes, feeds, users, species, chemicals, profiles, animals, events, placements] = await Promise.all([
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
    db.animal.count(),
    db.lifecycleEvent.count(),
    db.placement.count(),
  ]);
  return { units, parameters, ranges, pools, groups, feedTypes, feeds, users, species, chemicals, profiles, animals, events, placements };
}

beforeAll(async () => {
  if (!besideTestDatabase) {
    throw new Error(`the basic data test needs a *_test owner database (got "${owner.pathname.slice(1)}")`);
  }
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
  if (!besideTestDatabase) return;
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
      feeds: 1 + INITIAL_FEEDS.length, // "Egyéb" and the description's list (no date: everywhere)
      users: 1, // the System user of the init migration, no test user
      species: 0,
      chemicals: 0,
      profiles: 1,
      animals: 0, // the starting animals only on the test system (a live system's admin records real arrivals)
      events: 0,
      placements: 0,
    });
    expect((await db.feedName.findMany({ orderBy: { feed: { sortOrder: "asc" } } })).map((n) => n.name)).toEqual([
      "Egyéb",
      ...INITIAL_FEEDS.map((f) => f.name),
    ]);
    expect(await db.feedType.findUnique({ where: { code: "KORALL" } }), "no separate coral feed type").toBeNull();
    expect(await db.user.findMany({ select: { loginId: true } })).toEqual([{ loginId: "__system__" }]);
  });

  it("the CI fallback or an unclear switch does not bring the starting animals", async () => {
    for (const extra of [{ CI: "true" }, { CAPARIUM_SEED_SZINTETIKUS: "0" }, { CAPARIUM_SEED_SZINTETIKUS: "igen" }]) {
      execFileSync("npx", ["tsx", "prisma/base-data.ts"], { stdio: "pipe", env: { ...env, ...extra } });
      expect(await db.animal.count(), JSON.stringify(extra)).toBe(0);
    }
  }, 120_000);

  it("the test system's mark in its data (the seed's synthetic arrival, the stage without the variable): the starting animals in their pools and groups from 2026-01-01", async () => {
    // what the stage holds from its seed: a synthetic animal arrived with the seed's request id (no placement
    // needed here: the mark is the event)
    const species = await db.species.create({ data: { scientificName: "Teszt faj A" } });
    const synthetic = await db.animal.create({ data: { speciesId: species.id, names: { create: { name: "Teszt Egy", validFrom: new Date("2025-12-31T23:00:00.000Z") } } } });
    const nagy = await db.pool.findUniqueOrThrow({ where: { code: "NAGY" } });
    await db.lifecycleEvent.create({
      data: {
        animalId: synthetic.id,
        type: "ARRIVAL",
        occurredAt: new Date("2025-12-31T23:00:00.000Z"),
        businessDay: new Date("2026-01-01T00:00:00.000Z"),
        toPoolId: nagy.id,
        requestId: "seed-arrival-1",
        createdById: "00000000-0000-0000-0000-000000000001",
        updatedById: "00000000-0000-0000-0000-000000000001",
      },
    });
    // the stage's case (acrobot 33344): an admin recorded an animal of their own under a list name before the list
    // loaded ("Margit", Capus capus). It is another animal: the list's Margit still comes.
    const capus = await db.species.create({ data: { scientificName: "Capus capus" } });
    await db.animal.create({ data: { speciesId: capus.id, sex: "FEMALE", names: { create: { name: "Margit", validFrom: new Date("2026-10-20T08:00:00.000Z") } } } });
    const before = await counts();
    execFileSync("npx", ["tsx", "prisma/base-data.ts"], { stdio: "pipe", env });
    const margits = await db.animal.findMany({ where: { names: { some: { name: "Margit" } } }, include: { species: true } });
    expect(margits.map((m) => m.species.scientificName).sort()).toEqual(["Capus capus", "Giglymostoma cirratum"]);
    expect(await counts()).toEqual({
      ...before,
      species: before.species + new Set(INITIAL_ANIMALS.map((a) => a.species)).size,
      animals: before.animals + INITIAL_ANIMALS.length,
      events: before.events + INITIAL_ANIMALS.length, // one arrival each
      placements: before.placements + INITIAL_ANIMALS.length,
    });
    const where = async (name: string) => {
      const animal = await db.animal.findFirstOrThrow({
        where: { names: { some: { name } } },
        include: {
          species: true,
          placements: { include: { pool: true } },
          memberships: { include: { group: { include: { names: true } } } },
        },
      });
      return {
        species: animal.species.scientificName,
        sex: animal.sex,
        pools: animal.placements.map((p) => [p.pool.code, p.validFrom.toISOString(), p.validTo]),
        groups: animal.memberships.map((m) => m.group.names[0]!.name),
      };
    };
    const from = "2025-12-31T23:00:00.000Z";
    expect(await where("Nokedli")).toEqual({ species: "Giglymostoma cirratum", sex: "MALE", pools: [["NAGY", from, null]], groups: [] });
    expect(await where("SeaFlap")).toEqual({ species: "Rhinoptera bonasus", sex: "MALE", pools: [["KARANTEN", from, null]], groups: ["Ráják"] });
    expect(await where("Hópehely")).toEqual({ species: "Echidna nebulosa", sex: "UNKNOWN", pools: [["RAGADOZOS", from, null]], groups: ["Murénák"] });
    expect(await where("Korallos – korallok")).toMatchObject({ pools: [["KORALLOS", from, null]], groups: [] });
    expect((await db.animalGroupName.findMany()).map((g) => g.name).sort()).toEqual(["Murénák", "RFD", "Ráják"]);
    const litopenaeus = await db.feed.findFirstOrThrow({ where: { names: { some: { name: "Litopenaeus vannamei" } } }, include: { type: true } });
    expect([litopenaeus.type.code, litopenaeus.allowedDimensions]).toEqual(["RAK", ["MASS", "COUNT"]]);
  }, 60_000);

  it("a second start changes nothing, and an admin's change stays", async () => {
    await db.feedType.update({ where: { code: "HAL" }, data: { name: "Halak (átnevezve)", emoji: null } });
    // an admin's rename keeps the old name in the history: the start does not make the animal again
    const tango = await db.animalName.findFirstOrThrow({ where: { name: "Tango" } });
    await db.animalName.update({ where: { id: tango.id }, data: { validTo: new Date("2026-03-01T00:00:00.000Z") } });
    await db.animalName.create({ data: { animalId: tango.animalId, name: "Tangó", validFrom: new Date("2026-03-01T00:00:00.000Z") } });
    const before = await counts();
    execFileSync("npx", ["tsx", "prisma/base-data.ts"], { stdio: "pipe", env });
    execFileSync("npx", ["tsx", "prisma/base-data.ts"], { stdio: "pipe", env: { ...env, CAPARIUM_SEED_SZINTETIKUS: "1" } });
    expect(await counts()).toEqual(before);
    const hal = await db.feedType.findUniqueOrThrow({ where: { code: "HAL" } });
    expect(hal.name).toBe("Halak (átnevezve)");
    expect(hal.emoji, "a cleared icon does not come back at the next start").toBeNull();
    expect((await db.feedType.findUniqueOrThrow({ where: { code: "RAK" } })).emoji).toBe("🦐");
  }, 120_000);

  // Lili 2026-10-29 (package item 14): the feed list's "Módosítás" renames as a CORRECTION, which overwrites the old
  // name; the start looked the list's feeds up by NAME and made Artemia, Mysis and Krill again on the stage. WHAT TURNS
  // THIS RED: a corrected list feed made again at the next start; a copy the old lookup made left in the list, or
  // deleted while something refers to it.
  const correct = async (from: string, to: string) => {
    const row = await db.feedName.findFirstOrThrow({ where: { name: from } });
    await db.feedName.update({ where: { id: row.id }, data: { name: to } });
    await db.auditEntry.create({
      data: { userId: "00000000-0000-0000-0000-000000000001", action: "MASTER_CORRECTION", entityType: "Feed", entityId: row.feedId, changes: { name: { before: from, after: to } } },
    });
    return row.feedId;
  };
  const start = () => execFileSync("npx", ["tsx", "prisma/base-data.ts"], { stdio: "pipe", env });
  const feedsNamed = (n: string) => db.feed.findMany({ where: { names: { some: { name: n } } } });

  it("a list feed corrected to another name is not made again at the next start", async () => {
    const artemia = await correct("Artemia", "Artemia táblás");
    const before = await db.feed.count();
    start();
    expect([await db.feed.count(), (await feedsNamed("Artemia")).length, (await feedsNamed("Artemia táblás")).map((x) => x.id)]).toEqual([before, 0, [artemia]]);
  }, 120_000);

  it("the copies the old name lookup made after a correction: the start marks the original and leaves the copies alone", async () => {
    // a database from before the marks: the old start already made the copies
    const mysis = await correct("Mysis", "Mysis táblás");
    const krill = await correct("Krill", "Krill táblás");
    await db.baseDataMark.deleteMany({ where: { key: { in: ["initial-feed:APRO:Mysis", "initial-feed:APRO:Krill"] } } });
    const type = await db.feedType.findUniqueOrThrow({ where: { code: "APRO" } });
    const g = await db.unit.findUniqueOrThrow({ where: { symbol: "g" } });
    const copy = async (n: string) => (await db.feed.create({ data: { typeId: type.id, allowedDimensions: ["MASS"], defaultUnitId: g.id, sortOrder: 999, names: { create: { name: n, validFrom: new Date() } } } })).id;
    const mysisCopy = await copy("Mysis");
    const krillCopy = await copy("Krill");
    // the removal is an admin's operation with a dry run (src/lib/feed-copies.ts), never the start's (barracuda, acrobot
    // on #121): the start marks the corrected originals, makes nothing, and does not touch the copies
    const feeds = await db.feed.count();
    start();
    const marks = await db.baseDataMark.findMany({ where: { key: { in: ["initial-feed:APRO:Mysis", "initial-feed:APRO:Krill"] } }, orderBy: { key: "asc" } });
    expect([
      await db.feed.count(),
      (await db.feed.findUniqueOrThrow({ where: { id: mysisCopy } })).active,
      (await db.feed.findUniqueOrThrow({ where: { id: krillCopy } })).active,
      marks.map((m) => m.entityId),
      await db.auditEntry.count({ where: { entityId: { in: [mysisCopy, krillCopy] } } }),
    ]).toEqual([feeds, true, true, [krill, mysis], 0]);
    // and a third start changes nothing more
    const settled = await db.feed.count();
    start();
    expect(await db.feed.count()).toBe(settled);
  }, 120_000);
});
