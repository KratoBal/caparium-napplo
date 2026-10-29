// Lili 2026-10-29 (caparium-finomitas-1, item 3): on the small tanks' daily measurement Ragadozós comes first and
// Korallos last; the rows move with their pool, nothing is renamed. WHAT TURNS RED: the grid in the old order; the
// migration not swapping a database that has the old order, or touching anything but the two rows' places.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { groupLayout } from "@/lib/master";
import { prisma } from "@/lib/db";
import { fixtures, ownerPrisma } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => {
  f = await fixtures();
});

const order = async () => (await groupLayout(prisma, f.group("NAPI_KIS"), new Date())).pools.map((p) => p.name);
const SQL = readFileSync(new URL("../../prisma/migrations/20261029150000_small_tanks_order/migration.sql", import.meta.url), "utf8");

describe("the small tanks' daily order", () => {
  it("a new database starts Ragadozós, Inkubátor, Korallos", async () => {
    expect(await order()).toEqual(["Ragadozós", "Inkubátor", "Korallos"]);
  });

  it("the migration swaps a database in the old order, and only the two rows' places", async () => {
    const rows = async () =>
      (await ownerPrisma.groupMembership.findMany({ where: { groupId: f.group("NAPI_KIS"), validTo: null }, include: { pool: true }, orderBy: { sortOrder: "asc" } })).map((m) => [m.pool.code, m.sortOrder, m.poolId, m.validFrom.getTime()]);
    const now = await rows();
    // the old order, as the live database has it
    const pos = Object.fromEntries(now.map((r) => [r[0], r[1]]));
    await ownerPrisma.groupMembership.updateMany({ where: { groupId: f.group("NAPI_KIS"), pool: { code: "RAGADOZOS" }, validTo: null }, data: { sortOrder: pos.KORALLOS as number } });
    await ownerPrisma.groupMembership.updateMany({ where: { groupId: f.group("NAPI_KIS"), pool: { code: "KORALLOS" }, validTo: null }, data: { sortOrder: pos.RAGADOZOS as number } });
    expect(await order()).toEqual(["Korallos", "Inkubátor", "Ragadozós"]);
    await ownerPrisma.$executeRawUnsafe(SQL);
    expect(await order()).toEqual(["Ragadozós", "Inkubátor", "Korallos"]);
    // the same rows, pools and dates: only the places moved
    expect(await rows()).toEqual(now);
  });
});
