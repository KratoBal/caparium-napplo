// Lili 2026-11-01 (point 16): a pool's periods of use. The hard condition (acrobot, Caparium channel msg 1566458497246437448): for
// TODAY every list shows exactly what it showed before; that is the first describe. The measured days in January, February and April
// 2026 (the group's parameters start in 2026), each used by no other test for this pool.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createPool } from "@/lib/admin";
import { createLifecycleEvent } from "@/lib/animals";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createMeasurement } from "@/lib/measurements";
import { poolsOn, setPoolPeriods } from "@/lib/pool-periods";
import { getGrid } from "@/lib/queries";
import { addDays, businessDayOf, dateToDay } from "@/lib/time";
import { fixtures, ownerPrisma, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => {
  f = await fixtures();
});

async function code(p: Promise<unknown>): Promise<string> {
  const e = await p.then(() => null, (err: unknown) => err);
  expect(e).toBeInstanceOf(AppError);
  return (e as AppError).code;
}

const tag = () => rid().replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase();

/** A pool as the old code made it: the flag only, no period (what the migration found). */
async function barePool(name: string, active: boolean) {
  return prisma.pool.create({ data: { code: `BARE_${tag()}`, active, names: { create: { displayName: name, validFrom: new Date("2018-01-01T00:00:00Z") } } } });
}

async function runMigrationInsert() {
  const sql = readFileSync(join(process.cwd(), "prisma/migrations/20261101210000_pool_periods/migration.sql"), "utf8");
  const start = sql.indexOf('INSERT INTO "pool_period"');
  const insert = sql.slice(start, sql.indexOf("\n\n", start)).trim();
  expect(insert.endsWith(";")).toBe(true);
  await ownerPrisma.$executeRawUnsafe(insert);
}

describe("today's lists do not change (the hard condition)", () => {
  it("active pools open from 2018-12-07, inactive ones end the day before they were switched off (or yesterday): today the same pools", async () => {
    const on = await barePool(`Idoszak aktiv ${tag()}`, true);
    const off = await barePool(`Idoszak inaktiv ${tag()}`, false);
    const offAudited = await barePool(`Idoszak felujitas ${tag()}`, false);
    // switched off on 2026-10-29 10:00 Budapest, as Lili's small pool: its period ends 10-28
    await ownerPrisma.auditEntry.create({
      data: { userId: f.admin.id, action: "MASTER_CHANGE", entityType: "Pool", entityId: offAudited.id, changes: { active: { before: true, after: false } }, at: new Date("2026-10-29T09:00:00Z") },
    });
    await runMigrationInsert();
    const today = businessDayOf(new Date());
    const periods = new Map((await prisma.poolPeriod.findMany({ where: { poolId: { in: [on.id, off.id, offAudited.id] } } })).map((p) => [p.poolId, [dateToDay(p.firstDay), p.lastDay ? dateToDay(p.lastDay) : null]]));
    expect(periods.get(on.id)).toEqual(["2018-12-07", null]);
    expect(periods.get(off.id)).toEqual(["2018-12-07", addDays(today, -1)]);
    expect(periods.get(offAudited.id)).toEqual(["2018-12-07", "2026-10-28"]);
    // every pool no test switched (the seeded ones, the bare ones above): in use today exactly when its old flag was on. A pool
    // another test file switched on a day of its own is left out: its flag tells that test's day, not today.
    const inUse = await poolsOn(prisma, today);
    const touched = new Set((await prisma.auditEntry.findMany({ where: { entityType: "Pool", action: "MASTER_CHANGE" }, select: { entityId: true } })).map((e) => e.entityId));
    const flags = (await prisma.pool.findMany({ select: { id: true, active: true } })).filter((p) => !touched.has(p.id) || p.id === offAudited.id);
    expect(flags.length).toBeGreaterThan(5);
    for (const p of flags) expect(inUse.has(p.id), p.id).toBe(p.active);
    // the control: the switched-off pool was in use before (its period is not empty)
    expect((await poolsOn(prisma, "2026-10-28")).has(offAudited.id)).toBe(true);
    await runMigrationInsert();
    expect(await prisma.poolPeriod.count({ where: { poolId: { in: [on.id, off.id, offAudited.id] } } })).toBe(3);
  });
});

describe("a day's lists follow the periods", () => {
  it("the grid, a measurement and an animal's arrival take the pool on its days; a renovation's gap refuses them; the pool stays one", async () => {
    const t = tag();
    const name = `Kis idoszak ${t}`;
    const pool = ((await createPool(f.admin, { requestId: rid(), name, code: `KISID_${t}`, volumeLiters: "500", groupIds: [f.group("NAPI_NAGY")] })) as { id: string }).id;
    // in use in January 2026, renovated in February and March, back from April
    await setPoolPeriods(f.admin, pool, { requestId: rid(), periods: [{ firstDay: "2026-01-01", lastDay: "2026-01-31" }, { firstDay: "2026-04-01", lastDay: null }] });
    // the group membership the grid needs, from January (createPool gives one from today)
    await prisma.groupMembership.updateMany({ where: { poolId: pool }, data: { validFrom: new Date("2025-12-31T23:00:00Z") } });
    const measure = (day: string) =>
      createMeasurement(f.admin, { requestId: rid(), groupId: f.group("NAPI_NAGY"), poolId: pool, parameterId: f.param("TEMP"), value: "25", measuredAtLocal: `${day}T08:00`, reason: "régi adat" } as Parameters<typeof createMeasurement>[1], new Date());
    await measure("2026-01-27");
    expect(await code(measure("2026-02-26"))).toBe("POOL_INACTIVE");
    await measure("2026-04-28");
    const row = async (day: string) => ((await getGrid(f.group("NAPI_NAGY"), day))?.layout.pools ?? []).find((p) => p.id === pool);
    expect((await row("2026-01-28"))?.active).toBe(true);
    expect(await row("2026-02-27")).toBeUndefined(); // not in use, not measured: off the grid
    expect((await row("2026-01-27"))?.active).toBe(true);
    // Sunny's case: an animal arrives on an old day into the pool in use then
    const species = await prisma.species.findFirstOrThrow({ where: { active: true } });
    const arrive = (day: string) =>
      createLifecycleEvent(f.admin, { requestId: rid(), type: "ARRIVAL", newAnimal: { speciesId: species.id, name: `Sunny ${t} ${day}`, sex: "UNKNOWN" }, toPoolId: pool, occurredAtLocal: `${day}T09:00`, reason: "régi adat" } as Parameters<typeof createLifecycleEvent>[1], new Date());
    await arrive("2026-01-29");
    expect(await code(arrive("2026-03-03"))).toBe("POOL_NOT_IN_USE");
    // one pool: its measurements on both sides of the gap
    expect(await prisma.measurement.count({ where: { poolId: pool } })).toBe(2);
  });

  it("only an admin sets them; overlaps are refused; the old list is in the audit; the flag follows today", async () => {
    const t = tag();
    const pool = ((await createPool(f.admin, { requestId: rid(), name: `Admin idoszak ${t}`, code: `ADMID_${t}`, volumeLiters: "100", groupIds: [f.group("NAPI_NAGY")] })) as { id: string }).id;
    expect(await code(setPoolPeriods(f.aq1, pool, { requestId: rid(), periods: [] }))).toBe("ADMIN_ONLY");
    expect(await code(setPoolPeriods(f.admin, pool, { requestId: rid(), periods: [{ firstDay: "2019-01-01", lastDay: "2019-06-30" }, { firstDay: "2019-06-30", lastDay: null }] }))).toBe("BAD_PERIODS");
    const r = rid();
    await setPoolPeriods(f.admin, pool, { requestId: r, periods: [{ firstDay: "2019-01-01", lastDay: "2019-06-30" }] });
    const audit = await prisma.auditEntry.findFirstOrThrow({ where: { requestId: r } });
    expect((audit.changes as { periods: { after: unknown } }).periods.after).toEqual([{ firstDay: "2019-01-01", lastDay: "2019-06-30" }]);
    expect((await prisma.pool.findUniqueOrThrow({ where: { id: pool } })).active).toBe(false);
  });
});
