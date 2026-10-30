import { DayJump, DayNav } from "@/components/DayNav";
import type { FeedOpt } from "@/components/FeedingForms";
import { IntakeItems } from "@/components/IntakeForms";
import { Shell } from "@/components/Shell";
import { prisma } from "@/lib/db";
import { feedStock, intakeDayView, stockStatus } from "@/lib/feed-intake";
import { knownOtherNames, listFeeds } from "@/lib/feeds";
import { plainNumber as num, rowForDisplay } from "@/lib/mass-display";
import { requireModuleRead } from "@/lib/session";
import { businessDayOf, isValidDay } from "@/lib/time";

export const dynamic = "force-dynamic";

// Lili 2026-10-29 (package item 9): the feed that arrives in the freezer a few times a week; the withdrawals (Takarmánykivétel)
// take from this stock. The day's intake with its form, and the stock per feed. A delivery sent back shows on the list and
// does not count. The stock counts from the first intake of a feed: a feed with none has no starting stock and is not listed.
export default async function IntakePage({ searchParams }: { searchParams: Promise<{ nap?: string }> }) {
  const { user, level } = await requireModuleRead("WITHDRAWAL");
  const now = new Date();
  const today = businessDayOf(now);
  const sp = await searchParams;
  const day = sp.nap && isValidDay(sp.nap) && sp.nap <= today ? sp.nap : today;
  const [items, stock, types, units, otherNames] = await Promise.all([
    intakeDayView(day),
    feedStock(now),
    listFeeds(),
    prisma.unit.findMany({ where: { active: true }, orderBy: { symbol: "asc" } }),
    knownOtherNames(),
  ]);
  const canRecord = level === "RECORD" || level === "ADMIN";
  // the server decides: an aquarist records today, an earlier day is the admin's
  const editable = canRecord && (level === "ADMIN" || day === today);
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
  const tracked = stock.filter((r) => r.tracked);
  return (
    <Shell title="Takarmányhűtő" active="intake" user={user}>
      <div className="toolbar toolbar-end">
        <DayNav path="/takarmanyhuto" day={day} today={today} />
        <DayJump path="/takarmanyhuto" day={day} today={today} />
      </div>
      <div className="card">
        <h2>Beérkezett takarmány</h2>
        <p className="hint">A hűtőbe érkezett készlet. Ha a szállítmányt visszaküldik, pipáld be a „Visszaküldve” jelölőt: látszik a listán, de nem kerül a készletre.</p>
        <IntakeItems day={day} feeds={feeds} otherNames={otherNames} items={items} editable={editable} />
      </div>

      <div className="card">
        <h2>Készlet</h2>
        <p className="hint">A bevételezett mínusz a kivett takarmány. A készlet az első bevételezéstől számít: amelyik takarmányhoz még nincs bevétel, az nem szerepel itt. A becsült napok az elmúlt 30 nap átlagos kivétele szerint értendők.</p>
        <div className="table-scroll">
          <table className="log-table" data-testid="feed-stock">
            <thead>
              <tr><th>Takarmány</th><th>Egység</th><th>Készlet</th><th>Becsült napok</th><th></th></tr>
            </thead>
            <tbody>
              {tracked.map((r) => {
                const shown = rowForDisplay(r.unit, [r.level]);
                const status = stockStatus(r);
                return (
                  <tr key={r.key} data-low={status.low ? "yes" : "no"}>
                    <td>{r.feed}</td>
                    <td>{shown.unit}</td>
                    <td>{shown.values[0]}</td>
                    <td>{status.daysLeft === null ? "–" : num(status.daysLeft)}</td>
                    <td>{r.negative ? "negatív készlet" : status.low ? "fogyóban" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
