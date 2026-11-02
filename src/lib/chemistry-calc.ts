// What the chemical calculator offers for each pool (caparium-hibak-3): its volume, its latest valid Ca, Mg and KH
// measurement, and its reference band now (the pool's own, else the common one, as src/lib/master.ts referenceAt).
// Suggestions only: the calculator saves nothing.
import type { CalcPool } from "@/components/ChemistryCalculator";
import { prisma } from "./db";
import { canonicalDecimal } from "./decimal";
import { pickValid, validAt } from "./master";
import { businessDayOf, dateToDay } from "./time";
import { poolInUse } from "./pool-periods";

const CODES = ["CA", "MG", "KH"] as const;

export async function chemistryCalcPools(now = new Date()): Promise<CalcPool[]> {
  const [pools, params] = await Promise.all([
    prisma.pool.findMany({ where: poolInUse(businessDayOf(now)), include: { names: true }, orderBy: { code: "asc" } }),
    prisma.parameter.findMany({ where: { code: { in: [...CODES] } }, include: { successor: { select: { id: true } } } }),
  ]);
  // barracuda on #188: after a unit change the built-in measurement is closed and its successor goes on in another unit; the
  // calculator works in ppm and dKH, so it stops loudly instead of computing from the closed measurement's last value
  const stopped = Object.fromEntries(
    params.filter((p) => p.successor).map((p) => [p.code, "A mérés mértékegysége megváltozott, ezért a kalkulátor ehhez nem számol."]),
  ) as NonNullable<CalcPool["stopped"]>;
  const codeOf = new Map(params.map((p) => [p.id, p.code as (typeof CODES)[number]]));
  const [latest, ranges] = await Promise.all([
    prisma.measurement.findMany({
      where: { status: "VALID", parameterId: { in: params.map((p) => p.id) }, measuredAt: { lte: now } },
      orderBy: [{ measuredAt: "desc" }, { createdAt: "desc" }],
      distinct: ["poolId", "parameterId"],
    }),
    prisma.referenceRange.findMany({ where: { parameterId: { in: params.map((p) => p.id) }, ...validAt(now) }, include: { unit: true } }),
  ]);
  return pools.map((pool) => {
    const out: CalcPool = {
      id: pool.id,
      name: pickValid(pool.names, now)?.displayName ?? pool.code,
      volumeLiters: pool.volumeLiters ? canonicalDecimal(pool.volumeLiters) : null,
      systemType: pool.systemType,
      latest: {},
      band: {},
      stopped,
    };
    for (const m of latest.filter((x) => x.poolId === pool.id && !stopped[codeOf.get(x.parameterId)!])) {
      out.latest[codeOf.get(m.parameterId)!] = { value: canonicalDecimal(m.value), day: dateToDay(m.businessDay) };
    }
    for (const p of params.filter((x) => !stopped[x.code as (typeof CODES)[number]])) {
      const r = ranges.find((x) => x.parameterId === p.id && x.poolId === pool.id) ?? ranges.find((x) => x.parameterId === p.id && x.poolId === null);
      if (r) {
        out.band[codeOf.get(p.id)!] = {
          min: r.min ? canonicalDecimal(r.min) : null,
          max: r.max ? canonicalDecimal(r.max) : null,
          unit: r.unit.symbol,
        };
      }
    }
    return out;
  });
}
