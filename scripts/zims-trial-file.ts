// The trial-import file for the customer (VIZ-24, NY-01, NY-18): one system, every parameter once,
// built by the same code and the same mapping as the real export, with plausible values inside the
// current reference ranges. MeasuredBy must be a name that exists in the customer's ZIMS, so it is
// an argument: a real name never goes into the repository or the test environment.
//
//   DATABASE_URL=... npx tsx scripts/zims-trial-file.ts --pool Nagymedence --date 2026-10-20 --measured-by "<ZIMS name>" > trial.csv
import { PrismaClient } from "@prisma/client";
import { csvField, zimsDate, zimsTime, zimsValue } from "../src/lib/exports/zims";
import { pickValid } from "../src/lib/master";
import { resolveLocalDateTime } from "../src/lib/time";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i > 0 ? process.argv[i + 1] : undefined;
  if (!v) throw new Error(`--${name} is required`);
  return v;
}

async function main() {
  const poolName = arg("pool");
  const date = arg("date");
  const measuredBy = arg("measured-by");
  const prisma = new PrismaClient();
  try {
    const profile = await prisma.zimsExportProfile.findFirstOrThrow({ where: { active: true }, orderBy: { version: "desc" } });
    const tz = profile.timeZone;
    const at = resolveLocalDateTime(`${date}T09:00`, tz)!.instant;
    const pool = (await prisma.pool.findMany({ include: { names: true } })).find((p) => pickValid(p.names, at)?.displayName === poolName);
    if (!pool) throw new Error(`no pool named ${poolName}`);
    const params = await prisma.parameter.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      include: { zimsNames: true, referenceRanges: true, unit: { include: { zimsUnitNames: true } } },
    });
    const lines = [profile.header];
    params.forEach((p, i) => {
      const name = pickValid(p.zimsNames, at)?.zimsName;
      const unit = p.unit.zimsUnitNames.find((u) => u.parameterId === null && u.validFrom <= at && (u.validTo === null || u.validTo > at))?.zimsUnit;
      if (!name || !unit) throw new Error(`missing ZIMS mapping for ${p.code}`);
      // the pool's own range, else the common one (caparium-hibak-3): an unfiltered pick could be another pool's
      const r = pickValid(p.referenceRanges.filter((x) => x.poolId === pool.id), at) ?? pickValid(p.referenceRanges.filter((x) => x.poolId === null), at);
      // the middle of the reference range, or the upper bound's half: a plausible, in-range value
      const min = r?.min ? Number(r.min) : 0;
      const max = r?.max ? Number(r.max) : min * 2 || 1;
      const value = ((min + max) / 2).toFixed(4);
      const time = new Date(at.getTime() + i * 60_000);
      lines.push([zimsDate(time, tz), zimsTime(time, tz), name, zimsValue(value, p.decimals), unit, measuredBy].map((f) => csvField(f)).join(","));
    });
    process.stdout.write(lines.join(profile.lineEnding) + profile.lineEnding);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
