// Lili 2026-10-29 (caparium-finomitas-1, item 2): a pool off for a renovation and back, nothing lost. WHAT TURNS RED:
// an aquarist switches it; an inactive pool takes a new measurement; it stays on the grid of a day it was not
// measured on, or leaves the grid or the report of a day it WAS measured on; its measurements are touched; activated
// again it does not take a measurement; the change is not audited. Its own pool, so no other file sees it. Days in June 2027.
import { beforeAll, describe, expect, it } from "vitest";
import { createPool, setPoolActive } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createMeasurement } from "@/lib/measurements";
import { getGrid } from "@/lib/queries";
import { waterReport } from "@/lib/water-report";
import { cest, fixtures, rid } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => {
  f = await fixtures();
});

const code = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e as AppError).code);

describe("a pool off for a renovation", () => {
  it("takes no new measurement, leaves the grid of the days it was not measured on, keeps everything, comes back", async () => {
    const tag = rid().replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase();
    const name = `Felujitas ${tag}`;
    const pool = ((await createPool(f.admin, { requestId: rid(), name, code: `FELUJ_${tag}`, volumeLiters: "500", groupIds: [f.group("NAPI_NAGY")] })) as { id: string }).id;
    const measure = (local: string, value: string) =>
      createMeasurement(f.aq1, { requestId: rid(), groupId: f.group("NAPI_NAGY"), poolId: pool, parameterId: f.param("TEMP"), value, measuredAtLocal: local } as Parameters<typeof createMeasurement>[1], cest(local));
    const rows = async (day: string) => ((await getGrid(f.group("NAPI_NAGY"), day))?.layout.pools ?? []).filter((p) => p.id === pool);

    await measure("2027-06-07T08:00", "25");
    const before = await prisma.measurement.count({ where: { poolId: pool } });

    expect(await code(setPoolActive(f.aq1, { requestId: rid(), poolId: pool, active: false }))).toBe("ADMIN_ONLY");
    const off = rid();
    await setPoolActive(f.admin, { requestId: off, poolId: pool, active: false });
    expect(await setPoolActive(f.admin, { requestId: off, poolId: pool, active: false })).toEqual({ replayed: true });
    expect(await code(setPoolActive(f.admin, { requestId: rid(), poolId: pool, active: false }))).toBe("NO_CHANGE");
    const audit = await prisma.auditEntry.findFirstOrThrow({ where: { requestId: off } });
    expect([audit.entityType, audit.entityId, audit.changes]).toEqual(["Pool", pool, { active: { before: true, after: false } }]);

    // inactive: no new measurement; off the grid of a day without one; on the grid (read-only flag) and in the report
    // of the day it was measured on; its measurement untouched
    expect(await code(measure("2027-06-08T08:00", "24"))).toBe("POOL_INACTIVE");
    expect(await rows("2027-06-08")).toEqual([]);
    expect(await rows("2027-06-07")).toEqual([{ id: pool, name, active: false }]);
    expect((await waterReport("2027-06-07")).pools.map((p) => p.pool)).toContain(name);
    expect(await prisma.measurement.count({ where: { poolId: pool } })).toBe(before);

    // back: as it was, and it takes a measurement again
    await setPoolActive(f.admin, { requestId: rid(), poolId: pool, active: true });
    expect(await rows("2027-06-08")).toEqual([{ id: pool, name, active: true }]);
    expect(await code(measure("2027-06-08T09:00", "24"))).toBe(null);
  });
});
