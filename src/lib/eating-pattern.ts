// The fasting day the eating pattern shows without a stored row (Lili, 2026-10-21: "ahol nincs adat az
// automatikusan koplalónap legyen"). The customer's rule is DN-03 (2026-10-15): "aki aznap nincs kiválasztva
// etetésre, az koplalt". The stored AUTOMATIC fasting rows (feeding.ts recomputeFasting) come only with the day's
// close and a finalized list, and skip the day of an arrival, death or release (T-01/5): so today, an unfinalized
// day and an arrival day stayed white in the Excel and on the screen. The pattern therefore DERIVES the cell: a day
// the animal lived, up to today, without a valid eating status and without being on that day's list, is a fasting
// day. An animal on the list without a recorded status is NOT a fasting day: it was fed, only its eating is
// missing, and that stays an empty cell.
// TODAY only once the list is finalized (or the day closed): before that "not on the list" does not mean "does not
// eat", and the whole stock would read blue in the morning (barracuda #48; acrobot 34622 from Lili's words: the
// fasting day is for the closed or finalized days, today stays empty until the list is ready). A past day's list
// no longer changes, so a past day is derived as it is.
// NO DATA IS NOT FASTING (Lili 2026-11-02, keying in old data back to 2018; acrobot 40205, C7): a past day derives fasting only
// when it HAS a feeding day, i.e. the log was kept that day. Since the go-live every day has one (the scheduled run makes it, and
// any entry does), so nothing changes there; an old day nobody keyed in stays empty instead of reading all blue.
import { prisma } from "./db";
import { dateToDay, dayToDate } from "./time";

export type ListFacts = {
  /** `${animalId}|${day}` of every animal on a day's feeding list in the period */
  selected: Set<string>;
  /** the days whose list is final: finalized, or the day closed */
  settled: Set<string>;
  /** the days that have a feeding day at all: the log was kept on them */
  kept: Set<string>;
};

export async function listFacts(from: string, to: string): Promise<ListFacts> {
  const range = { gte: dayToDate(from), lte: dayToDate(to) };
  const [rows, days] = await Promise.all([
    prisma.feedingSelection.findMany({
      where: { status: "VALID", feedingDay: { businessDay: range } },
      select: { animalId: true, feedingDay: { select: { businessDay: true } } },
    }),
    prisma.feedingDay.findMany({ where: { businessDay: range }, select: { businessDay: true, listState: true, journalDay: { select: { state: true } } } }),
  ]);
  return {
    selected: new Set(rows.map((r) => `${r.animalId}|${dateToDay(r.feedingDay.businessDay)}`)),
    settled: new Set(days.filter((d) => d.listState === "FINALIZED" || d.journalDay.state === "CLOSED").map((d) => dateToDay(d.businessDay))),
    kept: new Set(days.map((d) => dateToDay(d.businessDay))),
  };
}

/** A cell without a stored status, on a day the animal lived: a fasting day when it was not on that day's list. */
export function isDerivedFasting(facts: ListFacts, animalId: string, day: string, today: string): boolean {
  if (day > today || (day === today && !facts.settled.has(day)) || !facts.kept.has(day)) return false;
  return !facts.selected.has(`${animalId}|${day}`);
}
