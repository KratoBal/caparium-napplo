import { PrintButton } from "@/components/PrintButton";
import { ReportTable } from "@/components/ReportTable";
import { Shell } from "@/components/Shell";
import { listAnimals } from "@/lib/animals";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { feedingLog } from "@/lib/feeding-log";
import { moduleLevel, pickValid } from "@/lib/master";
import { breakdown } from "@/lib/reports";
import { requireModuleRead } from "@/lib/session";
import { addDays, businessDayOf, isValidDay } from "@/lib/time";

export const dynamic = "force-dynamic";

// EGY-13 (NY-11 default: a filterable table and Excel): the period's feedings by day and by recipient,
// per feed and base unit; the same as Excel.
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ tol?: string; ig?: string; medence?: string; allat?: string }> }) {
  const { user } = await requireModuleRead("FEEDING");
  const sp = await searchParams;
  const today = businessDayOf(new Date());
  const to = sp.ig && isValidDay(sp.ig) ? sp.ig : today;
  const from = sp.tol && isValidDay(sp.tol) ? sp.tol : addDays(to, -6);
  const uuid = /^[0-9a-f-]{36}$/;
  const poolId = sp.medence && uuid.test(sp.medence) ? sp.medence : null;
  const animalId = sp.allat && uuid.test(sp.allat) ? sp.allat : null;
  const now = new Date();
  const [pools, animals, exportLevel] = await Promise.all([
    prisma.pool.findMany({ where: { active: true }, include: { names: true }, orderBy: { code: "asc" } }),
    listAnimals(now),
    moduleLevel(prisma, user.id, user.role, "EXPORT"),
  ]);
  let report: ReturnType<typeof breakdown> | null = null;
  let error: string | null = null;
  try {
    const log = await feedingLog({ from, to, poolId, animalId });
    report = breakdown(log.entries, log.days);
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    error = e.message;
  }
  return (
    <Shell title="Kimutatások" active="reports" user={user}>
      <form method="get" action="/kimutatasok" className="filters no-print">
        <label className="field">
          Naptól
          <input className="input" type="date" name="tol" defaultValue={from} />
        </label>
        <label className="field">
          Napig
          <input className="input" type="date" name="ig" defaultValue={to} />
        </label>
        <label className="field">
          Medence
          <select className="input" name="medence" defaultValue={poolId ?? ""} aria-label="Medence">
            <option value="">mind</option>
            {pools.map((p) => (
              <option key={p.id} value={p.id}>
                {pickValid(p.names, now)?.displayName ?? p.code}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Állat
          <select className="input" name="allat" defaultValue={animalId ?? ""} aria-label="Állat">
            <option value="">mind</option>
            {animals.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-soft" type="submit">Lekérés</button>
        <span className="spacer" />
        <PrintButton />
      </form>
      {error && <div className="banner banner-error">{error}</div>}
      {report && (
        <>
          <div className="card">
            <h2>Napokra bontva</h2>
            <p className="hint">Takarmányonként és alapegységben; a darab és a tömeg külön oszlop. A csoportos tétel a csoporté, felosztás nélkül.</p>
            <ReportTable title="Nap" columns={report.columns} lines={report.byDay} total={report.total} testId="report-by-day" />
          </div>
          <div className="card">
            <h2>Kinek</h2>
            <ReportTable title="Állat vagy csoport" columns={report.columns} lines={report.byRecipient} total={report.total} testId="report-by-recipient" />
          </div>
          {exportLevel !== "NONE" && (
            <form method="post" action="/api/exports/feeding" className="toolbar no-print">
              <input type="hidden" name="kind" value="kimutatas" />
              <input type="hidden" name="from" value={from} />
              <input type="hidden" name="to" value={to} />
              {poolId && <input type="hidden" name="pool" value={poolId} />}
              {animalId && <input type="hidden" name="animal" value={animalId} />}
              <button className="btn" type="submit" data-testid="excel-kimutatas">Kimutatás (Excel, {from} – {to})</button>
            </form>
          )}
        </>
      )}
    </Shell>
  );
}
