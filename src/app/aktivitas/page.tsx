import Link from "next/link";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import {
  ACTIVE_GAP_MINUTES,
  ACTIVITY_KINDS,
  activityCsvHref,
  activityHref,
  type ActivityKindKey,
  clampPeriod,
  describeSave,
  formatDuration,
  groupSaves,
  loadActivityRows,
  MAX_ACTIVITY_DAYS,
  readActivityParams,
  summarize,
} from "@/lib/activity";
import { prisma } from "@/lib/db";
import { pageTr } from "@/lib/i18n/server";
import { requireUser } from "@/lib/session";
import { addDays, businessDayOf, formatDay, isValidDay, localTimeOf, weekdayLetter } from "@/lib/time";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
type KindParam = ActivityKindKey | "other";

// Card 70cadcf8 (Lili 2026-10-30 10:33 UTC): who recorded what, a summary per day and person, and the saves behind a
// cell one click away. Admins only (acrobot 38464); it reads the audit log and writes nothing.
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/nincs-jogosultsag");
  const { tr } = await pageTr(user);
  const sp = readActivityParams(await searchParams);
  const today = businessDayOf(new Date());
  const to = sp.ig && isValidDay(sp.ig) ? sp.ig : today;
  const period = clampPeriod(sp.tol && isValidDay(sp.tol) ? sp.tol : addDays(to, -6), to);

  const users = await prisma.user.findMany({ where: { role: { in: ["ADMIN", "AQUARIST"] } }, orderBy: { fullName: "asc" } });
  // `ember` filters the summary, `ki` is the person of the opened cell: two keys, each written once by every link
  const person = users.some((u) => u.id === sp.ember) ? sp.ember : undefined;
  const detailPerson = users.some((u) => u.id === sp.ki) ? sp.ki : undefined;
  const name = (id: string) => users.find((u) => u.id === id)?.fullName ?? tr("ismeretlen felhasználó");
  const loginOf = (id: string) => users.find((u) => u.id === id)?.loginId ?? id;

  const saves = groupSaves(await loadActivityRows(period, person));
  const rows = summarize(saves);
  const showOther = rows.some((r) => r.counts.other);
  const columns: { key: KindParam; label: string }[] = [
    // the kinds' labels are data of lib/activity.ts, translated here (on the i18n guard's list)
    ...ACTIVITY_KINDS.map((k) => ({ key: k.key as KindParam, label: tr(k.label) })),
    ...(showOther ? [{ key: "other" as const, label: tr("Egyéb") }] : []),
  ];

  const view = { from: period.from, to: period.to, filter: person };
  const cellHref = (day: string, userId: string, kind: KindParam) => activityHref(view, { day, person: userId, kind });

  // the detail of one cell: one day, one person, one kind
  const kind = columns.find((c) => c.key === sp.fajta);
  const detailDay = sp.nap && isValidDay(sp.nap) ? sp.nap : undefined;
  const detail =
    kind && detailDay && detailPerson
      ? saves.filter((s) => s.day === detailDay && s.userId === detailPerson && s.kind === kind.key)
      : null;
  const page = Math.max(1, Number(sp.oldal) || 1);
  const pages = detail ? Math.max(1, Math.ceil(detail.length / PAGE_SIZE)) : 1;
  const shown = detail ? detail.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : [];
  const detailHref = (p: number) => activityHref(view, { day: detailDay!, person: detailPerson!, kind: kind!.key, page: p });

  return (
    <Shell title={tr("Aktivitás")} active="activity" user={user}>
      <form method="get" action="/aktivitas" className="filters">
        <label className="field">
          {tr("Naptól")}
          <input className="input" type="date" name="tol" defaultValue={period.from} />
        </label>
        <label className="field">
          {tr("Napig")}
          <input className="input" type="date" name="ig" defaultValue={period.to} />
        </label>
        <label className="field">
          {tr("Felhasználó")}
          <select className="input" name="ember" defaultValue={person ?? ""}>
            <option value="">{tr("Mindenki")}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
                {u.active ? "" : ` ${tr("(inaktív)")}`}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" type="submit">
          {tr("Szűrés")}
        </button>
      </form>

      <div className="card">
        <h2>{tr("Ki mit rögzített")}</h2>
        <p className="hint">
          {tr(
            "Egy szám egy mentés: ha egy mentés több sort ír (például egy etetés a koplalási napokat is), az egyszer számít, abban a fajtában, amire a mentés szólt. A rendszer automatikus lépései és a belépések nem számítanak. Egyszerre legfeljebb {days} nap látszik. Egy számra kattintva a mentések listája nyílik meg. Az első és az utolsó mentés a nap első és utolsó rögzítésének ideje; az aktív idő a mentések ideje, a köztük lévő szünetekkel együtt, de a hosszabb szünetek nélkül; a sorok a mentések mögötti naplósorok száma.",
            { days: MAX_ACTIVITY_DAYS },
          )}
        </p>
        {rows.length > 0 ? (
          <p>
            <a className="btn btn-soft" href={activityCsvHref(view)} data-testid="activity-csv" download>
              {tr("Letöltés CSV-ben")}
            </a>
          </p>
        ) : null}
        {rows.length === 0 ? (
          <p className="hint" data-testid="activity-empty">
            {tr("Ebben az időszakban nincs rögzítés.")}
          </p>
        ) : (
          <div className="table-scroll">
            <table className="log-table" data-testid="activity-table">
              <thead>
                <tr>
                  <th>{tr("Nap")}</th>
                  <th>{tr("Felhasználó")}</th>
                  <th>{tr("Első mentés")}</th>
                  <th>{tr("Utolsó mentés")}</th>
                  <th>{tr("Aktív idő ({minutes} percnél hosszabb szünet nélkül)", { minutes: ACTIVE_GAP_MINUTES })}</th>
                  {columns.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                  <th>{tr("Összesen")}</th>
                  <th>{tr("Sorok")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.day}|${r.userId}`}>
                    <td>
                      {formatDay(r.day)} <span className="hint">{weekdayLetter(r.day)}</span>
                    </td>
                    <td>{name(r.userId)}</td>
                    <td data-testid={`activity-first-${r.day}-${loginOf(r.userId)}`}>{localTimeOf(r.first)}</td>
                    <td data-testid={`activity-last-${r.day}-${loginOf(r.userId)}`}>{localTimeOf(r.last)}</td>
                    <td data-testid={`activity-active-${r.day}-${loginOf(r.userId)}`}>{formatDuration(r.activeMs)}</td>
                    {columns.map((c) => {
                      const n = r.counts[c.key];
                      return (
                        <td key={c.key} data-testid={`activity-cell-${r.day}-${loginOf(r.userId)}-${c.key}`}>
                          {n ? <Link href={cellHref(r.day, r.userId, c.key)}>{n}</Link> : ""}
                        </td>
                      );
                    })}
                    <td>
                      <strong>{r.total}</strong>
                    </td>
                    <td>{r.rows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail && kind && detailDay && detailPerson && (
        <div className="card" id="reszlet" data-testid="activity-detail">
          <h2>
            {name(detailPerson)}, {formatDay(detailDay)} ({weekdayLetter(detailDay)}): {kind.label}
          </h2>
          {detail.length === 0 ? (
            <p className="hint">{tr("Ezen a napon ebben a fajtában nincs mentés.")}</p>
          ) : (
            <div className="table-scroll">
              <table className="log-table">
                <thead>
                  <tr>
                    <th>{tr("Időpont")}</th>
                    <th>{tr("Mi történt")}</th>
                    <th>{tr("Indoklás")}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((s) => {
                    const measurement = s.rows.find((r) => r.entityType === "Measurement");
                    const reason = s.rows.find((r) => r.reason)?.reason;
                    return (
                      <tr key={s.key}>
                        <td>{localTimeOf(s.at)}</td>
                        <td>
                          {describeSave(s.rows, tr)}
                          {measurement && (
                            <>
                              {" "}
                              <Link href={`/naplo/${measurement.entityId}`}>{tr("(megnyitás)")}</Link>
                            </>
                          )}
                        </td>
                        <td>{reason ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <div className="toolbar">
              {page > 1 && <Link className="btn btn-soft" href={detailHref(page - 1)}>{tr("Előző oldal")}</Link>}
              <span className="hint">
                {tr("{page}. oldal / {pages} ({n} mentés)", { page, pages, n: detail.length })}
              </span>
              {page < pages && <Link className="btn btn-soft" href={detailHref(page + 1)}>{tr("Következő oldal")}</Link>}
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}
