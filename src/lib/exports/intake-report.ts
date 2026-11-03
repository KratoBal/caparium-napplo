// The Takarmányhűtő report (Lili 2026-10-30, acrobot 38557 and 38558): for a period, the intake with the delivery that was
// sent back marked, and (Lili 2026-11-01, point 7) the balance of every feed: one table a feed with its opening stock, what came in,
// what was taken, the closing stock, and where it applies what was taken before the feed's stock started. As a printable PDF and
// as Excel, in the style of the existing exports. The data is read once here, so the two files say the same.
//
// The intake list is the log's full value: the stock's start day (feed-intake.ts setStockStart) archives early items out of the
// STOCK, not out of the log, so they appear here when they fall in the period. The balance follows the stock (feedBalance).
import { prisma } from "../db";
import { AppError } from "../errors";
import { dayBounds } from "../feeding";
import { feedBalance, feedStock, stockStatus } from "../feed-intake";
import { pickValid } from "../master";
import { periodDays, periodTooLongText, ROW_EXPORT_MAX_DAYS } from "./period-limit";
import { otherLabel } from "../other-name";
import { plainNumber, rowForDisplay } from "../mass-display";
import { dateToDay, dayToDate } from "../time";

export type IntakeReportRow = { day: string; type: string; feed: string; quantity: string; unit: string; note: string; returned: boolean };
/**
 * Lili 2026-11-01 (point 7): a feed's balance in one unit: opening, in, out, closing, and the withdrawals before its stock started
 * (null where there were none). The numbers read as the pages show them, one unit for the row (kg from 1000 g).
 */
export type BalanceLine = { unit: string; opening: string; received: string; taken: string; beforeStock: string | null; closing: string; negative: boolean; low: boolean };
/** One table a feed: its lines, one a dimension (grams, pieces). */
export type BalanceTable = { feed: string; lines: BalanceLine[] };
export type IntakeReport = { from: string; to: string; intake: IntakeReportRow[]; balance: BalanceTable[] };

const num = (v: string) => v.replace(".", ",");

export async function intakeReport(f: { from: string; to: string }, now = new Date()): Promise<IntakeReport> {
  if (f.from > f.to) throw new AppError(422, "BAD_PERIOD", "Az időszak vége nem lehet a kezdete előtt.");
  if (periodDays(f.from, f.to) > ROW_EXPORT_MAX_DAYS) throw new AppError(422, "PERIOD_TOO_LONG", periodTooLongText(ROW_EXPORT_MAX_DAYS));
  const range = { gte: dayToDate(f.from), lte: dayToDate(f.to) };
  // "as of the end of the period": the stock's windows (the 7 and 30 day withdrawal, so the "fogyóban" mark) and the names are
  // read at the period's last day, not today, so a stock that was running out then still says so (barracuda on #143). Never
  // later than now: a period that ends in the future is read as of now.
  const asOf = new Date(Math.min(now.getTime(), dayBounds(f.to).end.getTime() - 1));
  const [received, balance, stock] = await Promise.all([
    prisma.feedIntakeItem.findMany({
      where: { status: "VALID", intakeDay: range },
      include: { quantities: { include: { unit: true } }, feed: { include: { names: true, type: true } } },
      orderBy: [{ intakeDay: "asc" }, { createdAt: "asc" }],
    }),
    feedBalance(f.from, f.to, asOf),
    feedStock(asOf, f.to),
  ]);

  const intake: IntakeReportRow[] = [];
  for (const it of received) {
    const day = dateToDay(it.intakeDay);
    const name = pickValid(it.feed.names, dayBounds(day).start)?.name ?? it.feed.names.at(-1)?.name ?? "?";
    const feed = it.otherName ? `${name}: ${otherLabel(it.otherName)}` : name;
    for (const q of it.quantities) {
      intake.push({ day, type: it.feed.type.name, feed, quantity: num(plainNumber(Number(q.quantity))), unit: q.unit.symbol, note: it.note ?? "", returned: it.returned });
    }
  }

  // the "fogyóban" mark from the stock as of the period's end (its 30-day withdrawal)
  const lowOf = new Map(stock.map((r) => [r.key, stockStatus(r).low]));
  const tables = new Map<string, BalanceTable>();
  for (const r of balance) {
    const shown = rowForDisplay(r.unit, [r.opening, r.received, r.taken, r.beforeStock, r.closing]);
    const table = tables.get(r.feed) ?? { feed: r.feed, lines: [] };
    table.lines.push({
      unit: shown.unit,
      opening: shown.values[0],
      received: shown.values[1],
      taken: shown.values[2],
      beforeStock: r.beforeStock !== 0 ? shown.values[3] : null,
      closing: shown.values[4],
      negative: r.closing < 0,
      low: lowOf.get(r.key) ?? false,
    });
    tables.set(r.feed, table);
  }
  return { from: f.from, to: f.to, intake, balance: [...tables.values()] };
}
