// The Takarmányhűtő report (Lili 2026-10-30, acrobot 38557 and 38558): for a period, the intake with the delivery that was
// sent back marked, the withdrawals added up per feed, and the closing stock; as a printable PDF and as Excel, in the style
// of the existing exports. The data is read once here, so the two files say the same.
//
// The intake and withdrawal lists are the logs' full values: the stock's start day (feed-intake.ts setStockStart) archives
// early items out of the STOCK, not out of the logs, so they appear here when they fall in the period. The closing stock is
// the stock at the end of the period's last day.
import { prisma } from "../db";
import { AppError } from "../errors";
import { dayBounds } from "../feeding";
import { feedStock, stockStatus } from "../feed-intake";
import { pickValid } from "../master";
import { otherKey, otherLabel } from "../other-name";
import { plainNumber, rowForDisplay } from "../mass-display";
import { dateToDay, dayToDate } from "../time";

export type IntakeReportRow = { day: string; type: string; feed: string; quantity: string; unit: string; note: string; returned: boolean };
export type TakenRow = { feed: string; unit: string; quantity: string };
export type ClosingRow = { feed: string; unit: string; level: string; negative: boolean; low: boolean };
export type IntakeReport = { from: string; to: string; intake: IntakeReportRow[]; taken: TakenRow[]; closing: ClosingRow[] };

const MAX_DAYS = 366;

const num = (v: string) => v.replace(".", ",");

export async function intakeReport(f: { from: string; to: string }, now = new Date()): Promise<IntakeReport> {
  if (f.from > f.to) throw new AppError(422, "BAD_PERIOD", "Az időszak vége nem lehet a kezdete előtt.");
  if ((dayToDate(f.to).getTime() - dayToDate(f.from).getTime()) / 86_400_000 >= MAX_DAYS) throw new AppError(422, "PERIOD_TOO_LONG", "Az időszak legfeljebb egy év lehet.");
  const range = { gte: dayToDate(f.from), lte: dayToDate(f.to) };
  const [received, withdrawn, stock, baseUnits] = await Promise.all([
    prisma.feedIntakeItem.findMany({
      where: { status: "VALID", intakeDay: range },
      include: { quantities: { include: { unit: true } }, feed: { include: { names: true, type: true } } },
      orderBy: [{ intakeDay: "asc" }, { createdAt: "asc" }],
    }),
    prisma.withdrawalItem.findMany({
      where: { status: "VALID", withdrawalDay: { businessDay: range } },
      include: { quantities: { include: { unit: true } }, feed: { include: { names: true } } },
    }),
    feedStock(now, f.to),
    prisma.unit.findMany({ where: { isBase: true } }),
  ]);
  const baseOf = new Map(baseUnits.map((u) => [u.dimension, u.symbol]));

  const intake: IntakeReportRow[] = [];
  for (const it of received) {
    const day = dateToDay(it.intakeDay);
    const name = pickValid(it.feed.names, dayBounds(day).start)?.name ?? it.feed.names.at(-1)?.name ?? "?";
    const feed = it.otherName ? `${name}: ${otherLabel(it.otherName)}` : name;
    for (const q of it.quantities) {
      intake.push({ day, type: it.feed.type.name, feed, quantity: num(plainNumber(Number(q.quantity))), unit: q.unit.symbol, note: it.note ?? "", returned: it.returned });
    }
  }

  // withdrawals added up per feed (and other name) and base unit; a gram total from 1000 g reads in kg, as on the pages
  const sums = new Map<string, { feed: string; unit: string; sum: number }>();
  for (const it of withdrawn) {
    const name = pickValid(it.feed.names, now)?.name ?? it.feed.names.at(-1)?.name ?? "?";
    const other = it.otherName ? otherKey(it.otherName) : null;
    for (const q of it.quantities) {
      const unit = baseOf.get(q.unit.dimension) ?? q.unit.symbol;
      const key = `${it.feedId}|${other ?? ""}|${unit}`;
      const row = sums.get(key) ?? { feed: other ? `${name}: ${otherLabel(other)}` : name, unit, sum: 0 };
      row.sum += Number(q.quantity) * Number(q.unit.factorToBase ?? 1);
      sums.set(key, row);
    }
  }
  const taken = [...sums.values()]
    .sort((a, b) => a.feed.localeCompare(b.feed, "hu") || a.unit.localeCompare(b.unit))
    .map((r) => {
      const shown = rowForDisplay(r.unit, [r.sum]);
      return { feed: r.feed, unit: shown.unit, quantity: shown.values[0] };
    });

  const closing = stock
    .filter((r) => r.tracked && r.active)
    .map((r) => {
      const shown = rowForDisplay(r.unit, [r.level]);
      return { feed: r.feed, unit: shown.unit, level: shown.values[0], negative: r.negative, low: stockStatus(r).low };
    });
  return { from: f.from, to: f.to, intake, taken, closing };
}
