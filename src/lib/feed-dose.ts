// The base amount of a ticked feed (Lili 2026-10-29, package item 3, worked out with Bálint): for some feeds (the
// coral feeds, krill, mysis, artemia) the admin sets one amount, and the "given" tick on the feeding sheet records
// it. Only the admin sets or changes it (Lili, acrobot 38076); an aquarist sees it and the tick uses it. The tick is
// the SHEET ROW's amount: an animal's row gives it to the animal, a group's row to the group as a whole (Lili, "ne
// bonyolítsuk", acrobot 38075).
//
// Stored in coral_feed_dose (the schema had it since #9, unused until now): one row per period, with validity. The
// first amount of a feed is valid from the start of time, as a name is (FIRST_NAME_FROM): a tick recorded later for
// an earlier day takes it too. A change starts when it is made. An item keeps the quantity it was saved with, so a
// changed amount never rewrites a day already recorded.
import type { Dimension } from "@prisma/client";
import { canonicalDecimal, compareDecimal, parseDecimalInput } from "./decimal";
import type { Tx } from "./db";
import { AppError } from "./errors";
import { FIRST_NAME_FROM, validAt } from "./master";

export type FeedDose = { value: string; unitId: string; symbol: string };

/** The feed's base amount valid at `at`, or null. */
export async function doseAt(tx: Pick<Tx, "coralFeedDose">, feedId: string, at: Date): Promise<FeedDose | null> {
  const row = await tx.coralFeedDose.findFirst({ where: { feedId, ...validAt(at) }, include: { unit: true }, orderBy: { validFrom: "desc" } });
  return row ? { value: canonicalDecimal(row.dose), unitId: row.unitId, symbol: row.unit.symbol } : null;
}

/** The instant a tick for `day` reads the amount at: the save itself for today, the end of an earlier day. */
export function doseInstant(dayEnd: Date, serverNow: Date): Date {
  return serverNow < dayEnd ? serverNow : new Date(dayEnd.getTime() - 1);
}

/**
 * Sets (or with null, ends) the feed's base amount from `now`. Checks the amount and that its unit is one of the
 * feed's dimensions (T-08). Returns the old and the new amount as text for the audit, or null when nothing changed.
 */
export async function setDose(
  tx: Pick<Tx, "coralFeedDose" | "unit">,
  feed: { id: string; allowedDimensions: Dimension[] },
  input: { value: string; unitId: string } | null,
  now: Date,
): Promise<{ before: string | null; after: string | null } | null> {
  const current = await doseAt(tx, feed.id, now);
  let next: { value: string; unitId: string; symbol: string } | null = null;
  if (input) {
    const value = parseDecimalInput(input.value);
    if (value === null || compareDecimal(value, "0") <= 0) throw new AppError(422, "INVALID_DOSE", "Az alapmennyiség pozitív szám legyen.");
    const unit = await tx.unit.findUnique({ where: { id: input.unitId } });
    if (!unit || !feed.allowedDimensions.includes(unit.dimension)) {
      throw new AppError(422, "UNIT_DIMENSION", `Ez a takarmány nem mérhető ebben az egységben${unit ? ` (${unit.symbol})` : ""}.`);
    }
    next = { value: canonicalDecimal(value), unitId: unit.id, symbol: unit.symbol };
  }
  const text = (d: { value: string; symbol: string } | null) => (d ? `${d.value} ${d.symbol}` : null);
  if (text(current) === text(next) && (current?.unitId ?? null) === (next?.unitId ?? null)) return null;
  const open = await tx.coralFeedDose.findFirst({ where: { feedId: feed.id, validTo: null } });
  if (open) await tx.coralFeedDose.update({ where: { id: open.id }, data: { validTo: now } });
  if (next) {
    const first = (await tx.coralFeedDose.count({ where: { feedId: feed.id } })) === 0;
    await tx.coralFeedDose.create({ data: { feedId: feed.id, dose: next.value, unitId: next.unitId, validFrom: first ? FIRST_NAME_FROM : now } });
  }
  return { before: text(current), after: text(next) };
}
