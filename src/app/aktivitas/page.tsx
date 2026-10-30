import Link from "next/link";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import {
  ACTIVITY_KINDS,
  type ActivityKindKey,
  clampPeriod,
  describeSave,
  groupSaves,
  loadActivityRows,
  MAX_ACTIVITY_DAYS,
  summarize,
} from "@/lib/activity";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { addDays, businessDayOf, isValidDay, localTimeOf, weekdayLetter } from "@/lib/time";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
type KindParam = ActivityKindKey | "other";

// Card 70cadcf8 (Lili 2026-10-30 10:33 UTC): who recorded what, a summary per day and person, and the saves behind a
// cell one click away. Admins only (acrobot 38464); it reads the audit log and writes nothing.
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ tol?: string; ig?: string; ember?: string; nap?: string; fajta?: string; oldal?: string }>;
}) {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/nincs-jogosultsag");
  const sp = await searchParams;
  const today = businessDayOf(new Date());
  const to = sp.ig && isValidDay(sp.ig) ? sp.ig : today;
  const period = clampPeriod(sp.tol && isValidDay(sp.tol) ? sp.tol : addDays(to, -6), to);

  const users = await prisma.user.findMany({ where: { role: { in: ["ADMIN", "AQUARIST"] } }, orderBy: { fullName: "asc" } });
  const person = users.some((u) => u.id === sp.ember) ? sp.ember : undefined;
  const name = (id: string) => users.find((u) => u.id === id)?.fullName ?? "ismeretlen felhasználó";
  const loginOf = (id: string) => users.find((u) => u.id === id)?.loginId ?? id;

  const saves = groupSaves(await loadActivityRows(period, person));
  const rows = summarize(saves);
  const showOther = rows.some((r) => r.counts.other);
  const columns: { key: KindParam; label: string }[] = [
    ...ACTIVITY_KINDS.map((k) => ({ key: k.key as KindParam, label: k.label })),
    ...(showOther ? [{ key: "other" as const, label: "Egyéb" }] : []),
  ];

  const base = `/aktivitas?tol=${period.from}&ig=${period.to}${person ? `&ember=${person}` : ""}`;
  const cellHref = (day: string, userId: string, kind: KindParam) => `${base}&nap=${day}&ember=${userId}&fajta=${kind}#reszlet`;

  // the detail of one cell: one day, one person, one kind
  const kind = columns.find((c) => c.key === sp.fajta);
  const detailDay = sp.nap && isValidDay(sp.nap) ? sp.nap : undefined;
  const detail =
    kind && detailDay && person ? saves.filter((s) => s.day === detailDay && s.userId === person && s.kind === kind.key) : null;
  const page = Math.max(1, Number(sp.oldal) || 1);
  const pages = detail ? Math.max(1, Math.ceil(detail.length / PAGE_SIZE)) : 1;
  const shown = detail ? detail.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : [];
  const detailHref = (p: number) => `${base}&nap=${detailDay}&fajta=${kind?.key}&oldal=${p}#reszlet`;

  return (
    <Shell title="Aktivitás" active="activity" user={user}>
      <form method="get" action="/aktivitas" className="filters">
        <label className="field">
          Naptól
          <input className="input" type="date" name="tol" defaultValue={period.from} />
        </label>
        <label className="field">
          Napig
          <input className="input" type="date" name="ig" defaultValue={period.to} />
        </label>
        <label className="field">
          Felhasználó
          <select className="input" name="ember" defaultValue={person ?? ""}>
            <option value="">Mindenki</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
                {u.active ? "" : " (inaktív)"}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" type="submit">
          Szűrés
        </button>
      </form>

      <div className="card">
        <h2>Ki mit rögzített</h2>
        <p className="hint">
          Egy szám egy mentés: ha egy mentés több sort ír (például egy etetés a koplalási napokat is), az egyszer számít, abban
          a fajtában, amire a mentés szólt. A rendszer automatikus lépései és a belépések nem számítanak. Egyszerre legfeljebb{" "}
          {MAX_ACTIVITY_DAYS} nap látszik. Egy számra kattintva a mentések listája nyílik meg.
        </p>
        {rows.length === 0 ? (
          <p className="hint" data-testid="activity-empty">
            Ebben az időszakban nincs rögzítés.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="log-table" data-testid="activity-table">
              <thead>
                <tr>
                  <th>Nap</th>
                  <th>Felhasználó</th>
                  {columns.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                  <th>Összesen</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.day}|${r.userId}`}>
                    <td>
                      {r.day} <span className="hint">{weekdayLetter(r.day)}</span>
                    </td>
                    <td>{name(r.userId)}</td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail && kind && detailDay && person && (
        <div className="card" id="reszlet" data-testid="activity-detail">
          <h2>
            {name(person)}, {detailDay} ({weekdayLetter(detailDay)}): {kind.label}
          </h2>
          {detail.length === 0 ? (
            <p className="hint">Ezen a napon ebben a fajtában nincs mentés.</p>
          ) : (
            <div className="table-scroll">
              <table className="log-table">
                <thead>
                  <tr>
                    <th>Időpont</th>
                    <th>Mi történt</th>
                    <th>Indoklás</th>
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
                          {describeSave(s.rows)}
                          {measurement && (
                            <>
                              {" "}
                              <Link href={`/naplo/${measurement.entityId}`}>(megnyitás)</Link>
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
              {page > 1 && <Link className="btn btn-soft" href={detailHref(page - 1)}>Előző oldal</Link>}
              <span className="hint">
                {page}. oldal / {pages} ({detail.length} mentés)
              </span>
              {page < pages && <Link className="btn btn-soft" href={detailHref(page + 1)}>Következő oldal</Link>}
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}
