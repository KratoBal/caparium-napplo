// The two data migrations of task caparium-hibak-1, measured the way the test system meets them: a database
// where the seed already made the synthetic master data and the coral feed type existed, then the migrations run.
// - 20261020080000_no_coral_feed_type: the coral feeds move to "Apró és folyékony takarmány", the type goes.
// - 20261020080100_synthetic_master_data_off: the synthetic feeds inactive, the synthetic animals released.
// On its own database next to the test database (created and dropped here as the owner), because the shared one's
// synthetic data is what every other integration test feeds and measures with.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rebuildAnimal } from "@/lib/animals";
import { INITIAL_ANIMALS } from "@/lib/initial-data";

const statements = (file: string) =>
  readFileSync(`prisma/migrations/${file}/migration.sql`, "utf8")
    .split(/;\s*\n\s*\n/)
    .map((s) => s.replace(/^--.*$/gm, "").trim())
    .filter(Boolean);
const NO_CORAL = statements("20261020080000_no_coral_feed_type");
const SYNTHETIC_OFF = statements("20261020080100_synthetic_master_data_off");
const SYNTHETIC_FEEDS = ["Teszt kagyló", "Teszt hal", "Teszt tintahal", "Teszt plankton", "Teszt koralltáp"];
const SYNTHETIC_ANIMALS = ["Teszt Egy", "Teszt Kettő", "Teszt Három", "Teszt Négy"];
const SYSTEM = "00000000-0000-0000-0000-000000000001";

const owner = new URL(process.env.OWNER_DATABASE_URL!);
const name = `${owner.pathname.slice(1)}_kezdolista`;
const target = new URL(owner.toString());
target.pathname = `/${name}`;
const admin = new URL(owner.toString());
admin.pathname = "/postgres";
// only ever beside a database named for testing (env.ts takes an outside OWNER_DATABASE_URL unchecked)
const besideTestDatabase = owner.pathname.slice(1).endsWith("_test");

// the test system's start: a seed password and the synthetic switch on (which also brings the starting animals)
const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: target.toString(), SEED_TEST_PASSWORD: "kezdolista-proba-jelszo", CAPARIUM_SEED_SZINTETIKUS: "1" };
delete (env as Record<string, string | undefined>).CI;

let db: PrismaClient;
const run = async (sql: string[]) => {
  for (const s of sql) await db.$executeRawUnsafe(s);
};
const feedByName = (n: string) => db.feed.findFirst({ where: { names: { some: { name: n } } }, include: { type: true } });
const animalByName = (n: string) =>
  db.animal.findFirstOrThrow({ where: { names: { some: { name: n } } }, include: { placements: true, memberships: true, events: true } });
const auditCount = () => db.auditEntry.count({ where: { userId: SYSTEM } });

beforeAll(async () => {
  if (!besideTestDatabase) throw new Error(`this test needs a *_test owner database (got "${owner.pathname.slice(1)}")`);
  const server = new PrismaClient({ datasourceUrl: admin.toString() });
  try {
    await server.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await server.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await server.$disconnect();
  }
  // the order of a deploy on a fresh database: the migrations (they find nothing), the basic data, the seed
  execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "pipe", env });
  execFileSync("npx", ["tsx", "prisma/base-data.ts"], { stdio: "pipe", env });
  execFileSync("npx", ["tsx", "prisma/seed.ts"], { stdio: "pipe", env });
  db = new PrismaClient({ datasourceUrl: target.toString() });
}, 240_000);

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

describe("a fresh database (CI and e2e unchanged)", () => {
  it("the real lists and the synthetic data side by side, the synthetic animals placed, no coral type", async () => {
    expect(await db.feedType.findUnique({ where: { code: "KORALL" } })).toBeNull();
    for (const n of SYNTHETIC_FEEDS.slice(0, 4)) expect((await feedByName(n))?.active, n).toBe(true);
    for (const n of SYNTHETIC_ANIMALS) expect((await animalByName(n)).placements.filter((p) => !p.validTo), n).toHaveLength(1);
    // "Litopenaeus vannamei" is on both lists: made once
    expect(await db.feedName.count({ where: { name: "Litopenaeus vannamei" } })).toBe(1);
    expect(await db.animal.count()).toBe(INITIAL_ANIMALS.length + SYNTHETIC_ANIMALS.length);
  });
});

describe("the test system as it stood: a coral feed type with a feed", () => {
  beforeAll(async () => {
    const g = await db.unit.findUniqueOrThrow({ where: { symbol: "g" } });
    const korall = await db.feedType.create({ data: { code: "KORALL", name: "Koralltáp", sortOrder: 6, emoji: "🪸" } });
    await db.feed.create({
      data: { typeId: korall.id, allowedDimensions: ["MASS"], defaultUnitId: g.id, sortOrder: 99, names: { create: { name: "Teszt koralltáp", validFrom: new Date() } } },
    });
  });

  it("the coral feed moves to the small and liquid feeds with a System audit row, and the type is gone", async () => {
    const before = await auditCount();
    await run(NO_CORAL);
    expect((await feedByName("Teszt koralltáp"))?.type.code).toBe("APRO");
    expect(await db.feedType.findUnique({ where: { code: "KORALL" } })).toBeNull();
    const audit = await db.auditEntry.findMany({ where: { userId: SYSTEM, entityType: "Feed", action: "MASTER_CHANGE" } });
    expect(audit.map((a) => a.changes)).toEqual([{ type: { before: "KORALL", after: "APRO" } }]);
    expect(await auditCount()).toBe(before + 1);
  });

  it("the synthetic master data steps aside: feeds inactive, animals released now, group inactive, the real ones untouched", async () => {
    const realBefore = await animalByName("Nokedli");
    const before = await auditCount();
    const t0 = Date.now();
    await run(SYNTHETIC_OFF);

    for (const n of SYNTHETIC_FEEDS) expect((await feedByName(n))?.active, n).toBe(false);
    expect((await feedByName("Litopenaeus vannamei"))?.active).toBe(true);
    expect((await feedByName("Artemia"))?.active).toBe(true);

    for (const n of SYNTHETIC_ANIMALS) {
      const a = await animalByName(n);
      const release = a.events.filter((e) => e.type === "RELEASE");
      expect(release, n).toHaveLength(1);
      expect(release[0]!.occurredAt.getTime()).toBeGreaterThanOrEqual(t0 - 60_000);
      expect(a.placements.every((p) => p.validTo?.getTime() === release[0]!.occurredAt.getTime()), n).toBe(true);
      expect(a.memberships.every((m) => m.validTo !== null), n).toBe(true);
      // what the app's own derivation builds from the events is exactly what the migration left
      const rows = (x: typeof a) => ({
        p: x.placements.map((p) => [p.poolId, p.validFrom.getTime(), p.validTo?.getTime() ?? null, p.eventId]),
        m: x.memberships.map((m) => [m.groupId, m.validFrom.getTime(), m.validTo?.getTime() ?? null, m.eventId]),
      });
      await db.$transaction((tx) => rebuildAnimal(tx, a.id));
      expect(rows(await animalByName(n)), n).toEqual(rows(a));
    }
    const group = await db.animalGroupName.findFirstOrThrow({ where: { name: "Teszt csoport" }, include: { group: true } });
    expect(group.group.active).toBe(false);
    expect(await animalByName("Nokedli")).toEqual(realBefore);
    // 4 synthetic feeds + the coral one, 4 releases
    expect(await auditCount()).toBe(before + 5 + 4);
  });

  it("a second run changes nothing, and the next start (basic data and seed) does not bring them back", async () => {
    const before = await auditCount();
    const events = await db.lifecycleEvent.count();
    await run(NO_CORAL);
    await run(SYNTHETIC_OFF);
    execFileSync("npx", ["tsx", "prisma/base-data.ts"], { stdio: "pipe", env });
    execFileSync("npx", ["tsx", "prisma/seed.ts"], { stdio: "pipe", env });
    expect(await auditCount()).toBe(before);
    expect(await db.lifecycleEvent.count()).toBe(events);
    expect(await db.feedType.findUnique({ where: { code: "KORALL" } })).toBeNull();
    for (const n of SYNTHETIC_FEEDS) expect((await feedByName(n))?.active, n).toBe(false);
    for (const n of SYNTHETIC_ANIMALS) expect((await animalByName(n)).placements.filter((p) => !p.validTo), n).toHaveLength(0);
  }, 120_000);
});
