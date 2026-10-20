// What the chemical calculator offers for each pool (caparium-hibak-3): its volume, its latest valid Ca, Mg and KH
// measurement, and its reference band now (the pool's own, else the common one, as src/lib/master.ts referenceAt).
// Suggestions only: the calculator saves nothing.
import type { CalcPool } from "@/components/ChemistryCalculator";
import { prisma } from "./db";
import { canonicalDecimal } from "./decimal";
import { pickValid, validAt } from "./master";
import { dateToDay } from "./time";

const CODES = ["CA", "MG", "KH"] as const;

export async function chemistryCalcPools(now = new Date()): Promise<CalcPool[]> {
  const [pools, params] = await Promise.all([
    prisma.pool.findMany({ where: { active: true }, include: { names: true }, orderBy: { code: "asc" } }),
    prisma.parameter.findMany({ where: { code: { in: [...CODES] } } }),
  ]);
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
      latest: {},
      band: {},
    };
    for (const m of latest.filter((x) => x.poolId === pool.id)) {
      out.latest[codeOf.get(m.parameterId)!] = { value: canonicalDecimal(m.value), day: dateToDay(m.businessDay) };
    }
    for (const p of params) {
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
