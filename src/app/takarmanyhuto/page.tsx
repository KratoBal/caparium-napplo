import { DayJump, DayNav } from "@/components/DayNav";
import type { FeedOpt } from "@/components/FeedingForms";
import { IntakeItems, StockStart } from "@/components/IntakeForms";
import { Shell } from "@/components/Shell";
import { prisma } from "@/lib/db";
import { feedStock, getStockStart, intakeDayView, stockStatus } from "@/lib/feed-intake";
import { knownOtherNames, listFeeds } from "@/lib/feeds";
import { plainNumber as num, rowForDisplay } from "@/lib/mass-display";
import { moduleLevel } from "@/lib/master";
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
  const [items, stock, types, units, otherNames, stockStart, exportLevel] = await Promise.all([
    intakeDayView(day),
    feedStock(now),
    listFeeds(),
    prisma.unit.findMany({ where: { active: true }, orderBy: { symbol: "asc" } }),
    knownOtherNames(),
    getStockStart(),
    moduleLevel(prisma, user.id, user.role, "EXPORT"),
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
  const tracked = stock.filter((r) => r.tracked && r.active);
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
        <p className="hint">A bevételezett mínusz a kivett takarmány, a kezdőnaptól számítva. Amelyik takarmányhoz még nincs be nem küldött bevétel, az nem szerepel itt, és a kivezetett (inaktív) takarmány sem. A becsült napok az elmúlt 30 nap átlagos kivétele szerint értendők, és 0-ra állnak, ha a készlet elfogyott.</p>
        <StockStart start={stockStart} today={today} canSet={level === "ADMIN"} />
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
      {exportLevel !== "NONE" && (
        <div className="card">
          <h2>Kimutatás</h2>
          <p className="hint">Az időszak bevételei (a visszaküldött szállítmány pirossal), a kivételek takarmányonként összesítve és a záró készlet. Nyomtatható PDF vagy Excel.</p>
          <form method="post" action="/api/exports/feeding" className="filters" data-testid="intake-export">
            <input type="hidden" name="kind" value="huto" />
            <label className="field">
              Naptól
              <input className="input" type="date" name="from" defaultValue={`${today.slice(0, 8)}01`} max={today} required />
            </label>
            <label className="field">
              Napig
              <input className="input" type="date" name="to" defaultValue={today} max={today} required />
            </label>
            <button className="btn" type="submit" name="format" value="pdf" data-testid="intake-pdf">PDF</button>
            <button className="btn btn-soft" type="submit" name="format" value="xlsx" data-testid="intake-excel">Excel</button>
          </form>
        </div>
      )}
    </Shell>
  );
}
