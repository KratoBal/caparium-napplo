import { redirect } from "next/navigation";
import { SubmissionButtons, WaterMailButton, ZimsCreate } from "@/components/ExportActions";
import { Shell } from "@/components/Shell";
import { pageTr } from "@/lib/i18n/server";
import type { TrVars } from "@/lib/i18n/translate";
import { prisma } from "@/lib/db";
import { previousMonth } from "@/lib/exports/zims";
import { SYSTEM_USER_ID } from "@/lib/db";
import { getSetting, moduleLevel, pickValid } from "@/lib/master";
import { poolInUse } from "@/lib/pool-periods";
import { requireUser } from "@/lib/session";
import { addDays, businessDayOf, dateToDay, dayToDate, formatDay, formatPeriod, isValidDay, localTimeOf } from "@/lib/time";

export const dynamic = "force-dynamic";

const PURPOSE = { SUBMISSION: "Leadás", TRIAL: "Próbaimport", PREVIEW: "Előnézet" } as const;
const STATE = { CREATED: "Elkészült, még nincs leadva", SUBMITTED: "Leadva", REJECTED: "A ZIMS elutasította" } as const;

// E, F (feladat-4): Excel and ZIMS CSV; exporting is not submitting (T-20, R-9).
export default async function ExportPage({ searchParams }: { searchParams: Promise<{ tol?: string; ig?: string; medence?: string | string[] }> }) {
  const user = await requireUser();
  const { tr } = await pageTr(user);
  const level = await moduleLevel(prisma, user.id, user.role, "EXPORT");
  if (level === "NONE") redirect("/nincs-jogosultsag");
  const feedingLevel = await moduleLevel(prisma, user.id, user.role, "FEEDING");
  const waterLevel = await moduleLevel(prisma, user.id, user.role, "WATER");
  const sp = await searchParams;
  const today = businessDayOf(new Date());
  const to = sp.ig && isValidDay(sp.ig) ? sp.ig : today;
  const from = sp.tol && isValidDay(sp.tol) ? sp.tol : addDays(to, -6);
  const now = new Date();
  const pools = await prisma.pool.findMany({
    // in use today by its periods (point 16), not the old flag
    where: { ...poolInUse(today), memberships: { some: {} } },
    include: { names: true },
    orderBy: { code: "asc" },
  });
  const chosen = (Array.isArray(sp.medence) ? sp.medence : sp.medence ? [sp.medence] : []).filter((id) => pools.some((p) => p.id === id));
  const runs = await prisma.exportRun.findMany({
    where: { kind: "ZIMS_CSV" },
    include: { files: { select: { id: true, fileName: true, rowCount: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const recipient = await getSetting(prisma, "water_report_recipient", now);
  const canSend = level === "RECORD" || level === "ADMIN";
  return (
    <Shell title={tr("Export")} active="export" user={user}>
      {/* caparium-hibak-4 (Balázs 2026-10-20 09:45 UTC): the first item of Export, above the Excel. Lili 2026-10-26
          (msg 1564351191281049815): its own background, and a larger gap above the calendar. */}
      <div className="card card-mail" data-testid="water-mail-card">
        <h2>{tr("Vízmérés kiküldése")}</h2>
        <p className="hint">{tr("A mai napi és az e heti vízmérés eredményei medencénként, PDF-ben, e-mailben.")}</p>
        {canSend ? <WaterMailButton recipient={recipient} /> : <p className="hint">{tr("A kiküldéshez exportálási jog kell.")}</p>}
      </div>

      <form method="get" action="/export" className="filters">
        <label className="field">
          {tr("Naptól")}
          <input className="input" type="date" name="tol" defaultValue={from} />
        </label>
        <label className="field">
          {tr("Napig")}
          <input className="input" type="date" name="ig" defaultValue={to} />
        </label>
        <fieldset className="field" style={{ border: 0, padding: 0 }}>
          {tr("Rendszerek (üresen: mind)")}
          <span style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {pools.map((p) => (
              <label key={p.id} className="check">
                <input type="checkbox" name="medence" value={p.id} defaultChecked={chosen.includes(p.id)} />
                {pickValid(p.names, now)?.displayName ?? p.code}
              </label>
            ))}
          </span>
        </fieldset>
        <button className="btn btn-soft" type="submit">{tr("Szűrés")}</button>
      </form>

      <div className="card">
        <h2>Excel</h2>
        <p className="hint">{tr("Összesítő lap és rendszerenként egy lap, a sablon oszlopaival, kiegészítve a hígítással és az RO/SW-vel.")}</p>
        <form method="post" action="/api/exports/excel" className="toolbar">
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="to" value={to} />
          {chosen.map((id) => (
            <input key={id} type="hidden" name="pool" value={id} />
          ))}
          <button className="btn" type="submit" data-testid="excel-download">{tr("Excel letöltése ({period})", { period: formatPeriod(from, to) })}</button>
        </form>
      </div>

      {/* Lili 2026-11-02 (task caparium-hutok): the fridges' book, apart from the water exports above (they never hold a fridge) */}
      {waterLevel !== "NONE" && (
        <div className="card" data-testid="fridge-export">
          <h2>{tr("Hűtők hőmérséklete")}</h2>
          <p className="hint">{tr("A hűtők és fagyasztók leolvasásai az időszakra, havi bontásban (Excelben havonta egy lap): idő, hőmérséklet, a tartomány, leolvasztás, megjegyzés, ki rögzítette. A tartományon kívüli érték piros.")}</p>
          <div className="toolbar">
            {(["excel", "pdf"] as const).map((kind) => (
              <form key={kind} method="post" action="/api/exports/fridges">
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="from" value={from} />
                <input type="hidden" name="to" value={to} />
                <button className="btn" type="submit" data-testid={`fridge-${kind}`}>
                  {kind === "excel" ? "Excel" : "PDF"} ({formatPeriod(from, to)})
                </button>
              </form>
            ))}
          </div>
        </div>
      )}

      {feedingLevel !== "NONE" && (
        <div className="card">
          <h2>{tr("Takarmányozás (Excel)")}</h2>
          <p className="hint">
            {tr("Egyedi takarmánynapló: naponként és állatonként egy sor, a SUM mértékegységenként külön (a darab és a gramm nem adódik össze). Evési minta: állatonként egy sor, a napok vízszintesen, az állapot színnel, a gyógyszer megjegyzése a nap oszlopának alján.")}
          </p>
          <div className="toolbar">
            {(["etetes", "evesi"] as const).map((kind) => (
              <form key={kind} method="post" action="/api/exports/feeding">
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="from" value={from} />
                <input type="hidden" name="to" value={to} />
                <button className="btn" type="submit" data-testid={`excel-${kind}`}>
                  {tr(kind === "etetes" ? "Egyedi takarmánynapló" : "Evési minta")} ({formatPeriod(from, to)})
                </button>
              </form>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2>ZIMS CSV</h2>
        <p className="hint">
          {tr("Rendszerenként külön fájl. Az elkészült export még nincs a ZIMS-ben: amikor feltöltötted, jelöld „Leadva”-ként.")}
        </p>
        <ZimsCreate from={from} to={to} poolIds={chosen} />
      </div>

      <MonthlyPackage tr={tr} />

      {/* caparium-lili-1027 (Lili 2026-10-27 12:17 UTC): the "Leadás után eltér" list leaves the page for now; divergence()
          stays in src/lib/exports/zims.ts. */}

      <div className="card">
        <h2>{tr("Korábbi ZIMS-exportok")}</h2>
        {runs.length === 0 ? (
          <p className="hint">{tr("Még nem készült ZIMS-export.")}</p>
        ) : (
          <div className="table-scroll">
            <table className="log-table" data-testid="runs-table">
              <thead><tr><th>{tr("Készült")}</th><th>{tr("Időszak")}</th><th>{tr("Cél")}</th><th>{tr("Állapot")}</th><th>{tr("Fájlok")}</th><th></th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDay(businessDayOf(r.createdAt))} {localTimeOf(r.createdAt)}</td>
                    <td>{formatPeriod(dateToDay(r.periodFrom), dateToDay(r.periodTo))}</td>
                    <td>{tr(PURPOSE[r.purpose])}</td>
                    <td>{r.submissionState ? tr(STATE[r.submissionState]) : "–"}</td>
                    <td>
                      {r.files.map((f) => (
                        <div key={f.id}>
                          <a href={`/api/exports/files/${f.id}`} download>{f.fileName}</a> <span className="hint">({tr("{n} sor", { n: f.rowCount })})</span>
                        </div>
                      ))}
                    </td>
                    <td>{level === "ADMIN" && r.submissionState === "CREATED" && <SubmissionButtons runId={r.id} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}

/** VIZ-20 (NY-09 default: no e-mail): the previous month's ZIMS files, prepared by the system once a month. */
async function MonthlyPackage({ tr }: { tr: (text: string, vars?: TrVars) => string }) {
  const { from, to } = previousMonth(new Date());
  const run = await prisma.exportRun.findFirst({
    where: { kind: "ZIMS_CSV", purpose: "PREVIEW", createdById: SYSTEM_USER_ID, periodFrom: dayToDate(from), periodTo: dayToDate(to) },
    include: { files: { select: { id: true, fileName: true, rowCount: true } } },
  });
  return (
    <div className="card" data-testid="monthly-package">
      <h2 className="title-small">{tr("Havi ZIMS-csomag ({period})", { period: formatPeriod(from, to) })}</h2>
      <p className="hint">
        {tr("A rendszer havonta egyszer előkészíti az előző hónap ZIMS-fájljait letöltésre, és ha az automatikus levél be van kapcsolva, a Beállítások „Havi ZIMS-csomag levélben” részében megadott címzettnek e-mailben is elküldi. Ez előnézet, nem leadás: a ZIMS-be feltöltött futást továbbra is egy adminisztrátor jelöli leadottnak.")}
      </p>
      {run ? (
        <ul>
          {run.files.map((f) => (
            <li key={f.id}>
              <a href={`/api/exports/files/${f.id}`} download>{f.fileName}</a> <span className="hint">({tr("{n} sor", { n: f.rowCount })})</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">{tr("Még nem készült el: vagy nincs a hónapban érvényes mérés, vagy valamelyik méréshez hiányzik a ZIMS-megfeleltetés (a fenti kézi export megmutatja, melyik).")}</p>
      )}
    </div>
  );
}
