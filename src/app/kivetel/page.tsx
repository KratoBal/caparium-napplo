import { DayControls } from "@/components/DayControls";
import { DayJump, DayNav } from "@/components/DayNav";
import { CloseWithdrawalDay, WithdrawalItems, type FeedOpt } from "@/components/FeedingForms";
import { Shell } from "@/components/Shell";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { feedStock } from "@/lib/feed-intake";
import { knownOtherNames, listFeeds } from "@/lib/feeds";
import { dayStatus } from "@/lib/journal";
import { plainNumber as num, rowForDisplay } from "@/lib/mass-display";
import { moduleLevel } from "@/lib/master";
import { requireModuleRead } from "@/lib/session";
import { addDays, businessDayOf, isValidDay } from "@/lib/time";
import { takenVersusGiven, withdrawalDayView } from "@/lib/withdrawal";

export const dynamic = "force-dynamic";

// KIV-01..KIV-05, TAK-06: what goes out of the freezer on a day, for which day; the day's total in the
// corner; the "Lezárás" button; taken against given for a period; the Excel after the template.
export default async function WithdrawalPage({ searchParams }: { searchParams: Promise<{ nap?: string; tol?: string; ig?: string }> }) {
  const { user, level } = await requireModuleRead("WITHDRAWAL");
  const today = businessDayOf(new Date());
  const sp = await searchParams;
  const day = sp.nap && isValidDay(sp.nap) && sp.nap <= today ? sp.nap : today;
  const to = sp.ig && isValidDay(sp.ig) ? sp.ig : today;
  const from = sp.tol && isValidDay(sp.tol) ? sp.tol : addDays(to, -6);
  const [view, lock, types, units, exportLevel, otherNames, stock] = await Promise.all([
    withdrawalDayView(day),
    dayStatus(null, day, "WITHDRAWAL"),
    listFeeds(),
    prisma.unit.findMany({ where: { active: true }, orderBy: { symbol: "asc" } }),
    moduleLevel(prisma, user.id, user.role, "EXPORT"),
    knownOtherNames(),
    feedStock(),
  ]);
  let compare: Awaited<ReturnType<typeof takenVersusGiven>> = [];
  let compareError: string | null = null;
  try {
    compare = await takenVersusGiven(from, to);
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    compareError = e.message;
  }
  const canRecord = level === "RECORD" || level === "ADMIN";
  const isAdmin = level === "ADMIN";
  const editable = canRecord && (isAdmin || (day === today && lock.state === "OPEN"));
  const feeds: FeedOpt[] = types.flatMap((t) =>
    t.feeds
      .filter((f) => f.active)
      .map((f) => ({
        id: f.id,
        name: f.name,
        isOther: t.code === "EGYEB",
        dims: f.dimensions.map((d) => ({
          dimension: d,
          base: units.find((u) => u.dimension === d && u.isBase)?.symbol ?? "?",
          units: units.filter((u) => u.dimension === d).map((u) => ({ id: u.id, symbol: u.symbol, factor: Number(u.factorToBase ?? 1) })),
        })),
      })),
  );
  return (
    <Shell title="Takarmánykivétel" active="withdrawal" user={user}>
      <div className="toolbar toolbar-end">
        <DayNav path="/kivetel" day={day} today={today} />
        {/* Lili 2026-10-26: a date picker, as on the water measurement pages; the compare period is kept */}
        <DayJump path="/kivetel" day={day} today={today} keep={{ tol: from, ig: to }} />
        <span className="spacer" />
        <span className="pill" data-testid="withdrawal-total">
          Kivéve: {Object.entries(view.totals).map(([u, v]) => `${num(v)} ${u}`).join(", ") || "semmi"}
        </span>
        {canRecord && lock.state === "OPEN" && day === today && !isAdmin && <CloseWithdrawalDay day={day} />}
        <DayControls kind="WITHDRAWAL" day={day} status={lock} isAdmin={isAdmin} />
      </div>
      <div className="card">
        <h2>Kivett takarmány</h2>
        <p className="hint">Amit ma kiveszel a fagyasztóból; a felhasználás napja alapból a holnap. A darab és a tömeg külön összeg. A kivétel a Takarmányhűtő készletéből vonódik le.</p>
        <WithdrawalItems
          day={day}
          useDay={addDays(day, 1)}
          feeds={feeds}
          otherNames={otherNames}
          // the Takarmányhűtő stock: only a feed with an intake has one
          stock={stock.filter((s) => s.tracked).map((s) => ({ feedId: s.feedId, otherName: s.otherName?.toLowerCase() ?? null, dimension: s.dimension, unit: s.unit, level: s.level }))}
          items={view.items}
          editable={editable}
        />
      </div>

      <div className="card">
        <h2>Kivett és kiosztott</h2>
        <form method="get" action="/kivetel" className="filters">
          <input type="hidden" name="nap" value={day} />
          <label className="field">
            Naptól
            <input className="input" type="date" name="tol" defaultValue={from} />
          </label>
          <label className="field">
            Napig
            <input className="input" type="date" name="ig" defaultValue={to} />
          </label>
          <button className="btn btn-soft" type="submit">Összevetés</button>
        </form>
        <p className="hint">A kivett a felhasználás napja szerint, a kiosztott az egyedi takarmánynaplóból; a különbség kimutatás, nem hiba. Az „Egyéb” tételek a szabad nevük miatt nem párosíthatók.</p>
        {compareError && <div className="banner banner-error">{compareError}</div>}
        <div className="table-scroll">
          <table className="log-table" data-testid="taken-given">
            <thead>
              <tr><th>Takarmány</th><th>Egység</th><th>Kivett</th><th>Kiosztott</th><th>Különbség</th></tr>
            </thead>
            <tbody>
              {compare.map((r) => {
                const shown = rowForDisplay(r.unit, [r.taken, r.given, r.taken - r.given]);
                return (
                  <tr key={r.key}>
                    <td>{r.feed}{r.paired ? "" : " (nem párosított)"}</td>
                    <td>{shown.unit}</td>
                    {shown.values.map((v, i) => (
                      <td key={i}>{v}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {exportLevel !== "NONE" && (
          <form method="post" action="/api/exports/feeding" className="toolbar">
            <input type="hidden" name="kind" value="kivetel" />
            <input type="hidden" name="from" value={from} />
            <input type="hidden" name="to" value={to} />
            <button className="btn" type="submit" data-testid="excel-kivetel">Takarmánykivétel (Excel, {from} – {to})</button>
          </form>
        )}
      </div>
    </Shell>
  );
}
