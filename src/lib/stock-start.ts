// The day a stock begins, from its first RECORDED row (a chemical's movement, a feed's intake; acrobot 40205 A1/A3). That row's own
// day, unless it was keyed in long after it: an old row keyed in back to 2018 is a backfill, and a stock that begins with one would
// take the whole past out of today's number (the e2e caparium-regi-nap-e2e: a chemical without movements, a dosing of 2019 as its
// first, today's stock 0 l -> -5 l). A first row dated at most LATE_ENTRY_DAYS before the day it was recorded is a late entry of
// an ordinary day (a delivery noted on Tuesday for Monday) and starts the stock on its own day, as before.
import { addDays, businessDayOf, dayToDate } from "./time";

export const LATE_ENTRY_DAYS = 7;

/** The stock's first day for its first recorded row: the row's day, or the recording day for a backfill. */
export function stockStartDay(rowDay: Date, recordedAt: Date): Date {
  const recorded = businessDayOf(recordedAt);
  return rowDay < dayToDate(addDays(recorded, -LATE_ENTRY_DAYS)) ? dayToDate(recorded) : rowDay;
}
