// The fasting day the eating pattern shows without a stored row (Lili, 2026-10-21: "ahol nincs adat az
// automatikusan koplalónap legyen"). The customer's rule is DN-03 (2026-10-15): "aki aznap nincs kiválasztva
// etetésre, az koplalt". The stored AUTOMATIC fasting rows (feeding.ts recomputeFasting) come only with the day's
// close and a finalized list, and skip the day of an arrival, death or release (T-01/5): so today, an unfinalized
// day and an arrival day stayed white in the Excel and on the screen. The pattern therefore DERIVES the cell: a day
// the animal lived, up to today, without a valid eating status and without being on that day's list, is a fasting
// day. An animal on the list without a recorded status is NOT a fasting day: it was fed, only its eating is
// missing, and that stays an empty cell.
import { prisma } from "./db";
import { dateToDay, dayToDate } from "./time";

/** `${animalId}|${day}` of every animal on a day's feeding list in the period. */
export async function selectedKeys(from: string, to: string): Promise<Set<string>> {
  const rows = await prisma.feedingSelection.findMany({
    where: { status: "VALID", feedingDay: { businessDay: { gte: dayToDate(from), lte: dayToDate(to) } } },
    select: { animalId: true, feedingDay: { select: { businessDay: true } } },
  });
  return new Set(rows.map((r) => `${r.animalId}|${dateToDay(r.feedingDay.businessDay)}`));
}

/** A cell without a stored status, on a day the animal lived: a fasting day when it was not on that day's list. */
export function isDerivedFasting(selected: Set<string>, animalId: string, day: string, today: string): boolean {
  return day <= today && !selected.has(`${animalId}|${day}`);
}
