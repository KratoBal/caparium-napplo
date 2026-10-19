// In-app notices (stage 4; NY-09 default: no e-mail, everything inside the app or as a file to download).
// JAV-07: a daily measurement still missing after the day's deadline. ADA-07: a chemical expected to run
// out soon, from its average usage. Both are computed when the page is shown, nothing is stored.
// Temporary settings (documented): the deadline is 14:00 local time; "soon" is 3 days (D-18: 2-3 days).

import { prisma } from "./db";
import { stockLevels } from "./dosing";
import { pickValid, validAt } from "./master";
import { businessDayOf, dayToDate, localTimeOf } from "./time";

export const MEASUREMENT_DEADLINE = "14:00";
export const RUN_OUT_DAYS = 3;

/** JAV-07: the pools of the daily groups not measured today, once the deadline has passed. */
export async function missedMeasurements(now = new Date()) {
  const day = businessDayOf(now);
  if (localTimeOf(now) < MEASUREMENT_DEADLINE) return { day, due: false, pools: [] as string[] };
  const memberships = await prisma.groupMembership.findMany({
    where: { group: { active: true, frequency: "DAILY" }, ...validAt(now) },
    include: { pool: { include: { names: true } } },
  });
  const measured = new Set(
    (
      await prisma.measurement.findMany({
        where: { businessDay: dayToDate(day), status: "VALID", round: { group: { frequency: "DAILY" } } },
        distinct: ["poolId"],
        select: { poolId: true },
      })
    ).map((m) => m.poolId),
  );
  const pools = [...new Map(memberships.filter((m) => !measured.has(m.poolId)).map((m) => [m.poolId, pickValid(m.pool.names, now)?.displayName ?? m.pool.code])).values()];
  return { day, due: true, pools: pools.sort((a, b) => a.localeCompare(b, "hu")) };
}

/**
 * ADA-07: the chemicals at or below zero, or expected to run out within RUN_OUT_DAYS at the average daily
 * usage of the last 30 days. Without usage there is no estimate (and no notice unless the level is <= 0).
 */
export async function runningOut(now = new Date()) {
  const stock = await stockLevels(now);
  return stock
    .filter((c) => c.active)
    .map((c) => {
      const perDay = c.month / 30;
      const daysLeft = perDay > 0 ? c.level / perDay : null;
      return { name: c.name, unit: c.unit, level: c.level, daysLeft: daysLeft === null ? null : Math.round(daysLeft * 10) / 10 };
    })
    .filter((c) => c.level <= 0 || (c.daysLeft !== null && c.daysLeft <= RUN_OUT_DAYS));
}
