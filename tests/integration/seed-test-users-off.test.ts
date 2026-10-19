// The migration that deactivates the three seed test accounts (task caparium-tesztfiok-inaktivalas), measured the
// way the test system meets it: a database where the seed already made the accounts, and the migration runs after.
// On its own database next to the test database (created and dropped here as the owner), because the shared one's
// test accounts are what every other integration test logs in with.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATION = readFileSync("prisma/migrations/20261019200000_seed_test_users_off/migration.sql", "utf8");
const SEED_LOGINS = ["teszt.admin", "teszt.akvarista1", "teszt.akvarista2"];
const SYSTEM = "00000000-0000-0000-0000-000000000001";

const owner = new URL(process.env.OWNER_DATABASE_URL!);
const name = `${owner.pathname.slice(1)}_tesztfiok`;
const target = new URL(owner.toString());
target.pathname = `/${name}`;
const admin = new URL(owner.toString());
admin.pathname = "/postgres";
// only ever beside a database named for testing (env.ts takes an outside OWNER_DATABASE_URL unchecked)
const besideTestDatabase = owner.pathname.slice(1).endsWith("_test");

const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: target.toString(), SEED_TEST_PASSWORD: "tesztfiok-proba-jelszo" };
for (const key of ["CAPARIUM_SEED_SZINTETIKUS", "CI"]) delete (env as Record<string, string | undefined>)[key];

let db: PrismaClient;
let realId: string;

const seedUsers = () => db.user.findMany({ where: { loginId: { in: SEED_LOGINS } }, orderBy: { loginId: "asc" } });
const auditRows = () => db.auditEntry.count({ where: { userId: SYSTEM, entityType: "User", action: "MASTER_CHANGE" } });

beforeAll(async () => {
  if (!besideTestDatabase) throw new Error(`this test needs a *_test owner database (got "${owner.pathname.slice(1)}")`);
  const server = new PrismaClient({ datasourceUrl: admin.toString() });
  try {
    await server.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await server.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await server.$disconnect();
  }
  // the order of a deploy on a fresh database: the migrations first (this one finds nobody), then the seed
  execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "pipe", env });
  execFileSync("npx", ["tsx", "prisma/seed.ts"], { stdio: "pipe", env });
  db = new PrismaClient({ datasourceUrl: target.toString() });
  // a real user with a session, and a session for each test account, as the test system has them
  const real = await db.user.create({ data: { fullName: "Valódi Felhasználó", loginId: "valodi.felhasznalo", role: "ADMIN", passwordHash: "x" } });
  realId = real.id;
  const users = await seedUsers();
  for (const u of [...users, real]) {
    await db.session.create({ data: { id: `s-${u.loginId}`, userId: u.id, expiresAt: new Date(Date.now() + 3600_000) } });
  }
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

describe("the seed test accounts, deactivated by a migration", () => {
  it("a fresh database's migrations find nobody: the seed after them makes the accounts active (CI and e2e unchanged)", async () => {
    const users = await seedUsers();
    expect(users.map((u) => [u.loginId, u.active])).toEqual(SEED_LOGINS.map((l) => [l, true]));
    expect(await auditRows()).toBe(0);
  });

  it("run where the accounts exist: inactive, deactivatedAt set, no session, one System audit row each; the real user untouched", async () => {
    await db.$executeRawUnsafe(MIGRATION);
    const users = await seedUsers();
    expect(users.every((u) => !u.active && u.deactivatedAt !== null)).toBe(true);
    expect(await db.session.count({ where: { userId: { in: users.map((u) => u.id) } } })).toBe(0);
    const audit = await db.auditEntry.findMany({ where: { userId: SYSTEM, entityType: "User", action: "MASTER_CHANGE" } });
    expect(audit.map((a) => a.entityId).sort()).toEqual(users.map((u) => u.id).sort());
    expect(audit[0]!.changes).toEqual({ active: { before: true, after: false } });
    const real = await db.user.findUniqueOrThrow({ where: { id: realId } });
    expect([real.active, real.deactivatedAt]).toEqual([true, null]);
    expect(await db.session.count({ where: { userId: realId } })).toBe(1);
  });

  it("a second run adds no audit row, and the seed at the next start does not bring them back", async () => {
    await db.$executeRawUnsafe(MIGRATION);
    expect(await auditRows()).toBe(3);
    execFileSync("npx", ["tsx", "prisma/seed.ts"], { stdio: "pipe", env });
    expect((await seedUsers()).every((u) => !u.active)).toBe(true);
  }, 60_000);
});
