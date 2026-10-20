// The starting animals by an admin's click (acrobot 33380): on a database where the start loaded none (no switch, no
// synthetic seed arrival: the stage as it is), the status line says 0 of 25 and why; an aquarist is refused; the
// click loads them into their pools and groups, audited; a second click and the next start make nothing twice.
// On its own database next to the test database (created and dropped here as the owner): the shared one already
// has the list from its seed.
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { INITIAL_ANIMALS } from "@/lib/initial-data";
import { initialAnimalsStatus, loadInitialAnimalsByAdmin } from "@/lib/initial-animals";

const owner = new URL(process.env.OWNER_DATABASE_URL!);
const name = `${owner.pathname.slice(1)}_gomb`;
const target = new URL(owner.toString());
target.pathname = `/${name}`;
const admin = new URL(owner.toString());
admin.pathname = "/postgres";
const besideTestDatabase = owner.pathname.slice(1).endsWith("_test");

// the stage's start: no seed password, no switch, not CI
const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: target.toString() };
for (const key of ["SEED_TEST_PASSWORD", "CAPARIUM_SEED_SZINTETIKUS", "CI"]) delete (env as Record<string, string | undefined>)[key];

const ADMIN = { id: "00000000-0000-0000-0000-000000000001", role: "ADMIN" as const };
const AQUARIST = { id: "00000000-0000-0000-0000-000000000001", role: "AQUARIST" as const };
let db: PrismaClient;

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
  execFileSync("npx", ["tsx", "prisma/base-data.ts"], { stdio: "pipe", env });
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

describe("the starting animals by an admin's click", () => {
  it("where the start loaded none: 0 of the list, and the mark is false", async () => {
    expect(await initialAnimalsStatus(db)).toMatchObject({ total: INITIAL_ANIMALS.length, loaded: 0, markOn: false });
  });

  it("an aquarist is refused, nothing changes", async () => {
    const e = await loadInitialAnimalsByAdmin(AQUARIST, { requestId: "gomb-proba-aquarist", arrivalDay: "2026-10-20" }, db).catch((err: unknown) => err);
    expect((e as AppError).code).toBe("ADMIN_ROLE_ONLY");
    expect(await db.animal.count()).toBe(0);
  });

  it("the arrival day is the admin's: required, a real day, not in the future (acrobot 33395)", async () => {
    const now = new Date("2026-10-20T10:00:00.000Z");
    const code = (arrivalDay: string) =>
      loadInitialAnimalsByAdmin(ADMIN, { requestId: `gomb-proba-nap-${arrivalDay}`, arrivalDay }, db, now).then(
        () => null,
        (err: unknown) => (err as AppError).code,
      );
    expect(await code("")).toBe("ARRIVAL_DAY");
    expect(await code("2026-02-30")).toBe("ARRIVAL_DAY");
    expect(await code("2026-10-21")).toBe("FUTURE_DAY");
    expect(await db.animal.count()).toBe(0);
  });

  it("the click loads the list into its pools and groups, with one audit row; a repeat and the next start make nothing twice", async () => {
    const r = await loadInitialAnimalsByAdmin(ADMIN, { requestId: "gomb-proba-1", arrivalDay: "2026-10-20" }, db, new Date("2026-10-20T10:00:00.000Z"));
    expect(r).toMatchObject({ replayed: false, created: INITIAL_ANIMALS.length, loaded: INITIAL_ANIMALS.length });
    const seaflap = await db.animal.findFirstOrThrow({
      where: { names: { some: { name: "SeaFlap" } } },
      include: { placements: { include: { pool: true } }, memberships: { include: { group: { include: { names: true } } } } },
    });
    expect([seaflap.placements[0]!.pool.code, seaflap.memberships[0]!.group.names[0]!.name]).toEqual(["KARANTEN", "Ráják"]);
    // the arrival is the start of the admin's day, Budapest time (not the made-up 2026-01-01)
    expect(seaflap.placements[0]!.validFrom.toISOString()).toBe("2026-10-19T22:00:00.000Z");
    const audit = await db.auditEntry.findMany({ where: { entityType: "InitialAnimalList" } });
    expect(audit.map((a) => a.changes)).toEqual([{ loaded: { before: 0, after: INITIAL_ANIMALS.length }, arrivalDay: { before: null, after: "2026-10-20" } }]);

    expect(await loadInitialAnimalsByAdmin(ADMIN, { requestId: "gomb-proba-1", arrivalDay: "2026-10-20" }, db)).toMatchObject({ replayed: true, created: 0 });
    expect(await loadInitialAnimalsByAdmin(ADMIN, { requestId: "gomb-proba-2", arrivalDay: "2026-10-20" }, db)).toMatchObject({ replayed: false, created: 0 });
    execFileSync("npx", ["tsx", "prisma/base-data.ts"], { stdio: "pipe", env });
    expect(await db.animal.count()).toBe(INITIAL_ANIMALS.length);
  }, 60_000);
});
