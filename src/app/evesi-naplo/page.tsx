import { DayControls } from "@/components/DayControls";
import { DayNav } from "@/components/DayNav";
import { EatingForm } from "@/components/FeedingForms";
import { Shell } from "@/components/Shell";
import { eatingDayView } from "@/lib/eating";
import { EAT_LABEL } from "@/lib/eating-labels";
import { feedingDayView } from "@/lib/feeding";
import { dayStatus } from "@/lib/journal";
import { requireModuleRead } from "@/lib/session";
import { businessDayOf, isValidDay } from "@/lib/time";

export const dynamic = "force-dynamic";

// EVE-01..EVE-06, EVE-11: ate / partly / not, fasting day; V and Gy; the colour is display only (DN-03).
export default async function EatingPage({ searchParams }: { searchParams: Promise<{ nap?: string }> }) {
  const { user, level } = await requireModuleRead("FEEDING");
  const today = businessDayOf(new Date());
  const sp = await searchParams;
  const day = sp.nap && isValidDay(sp.nap) && sp.nap <= today ? sp.nap : today;
  const [eat, feed, lock] = await Promise.all([eatingDayView(day), feedingDayView(day), dayStatus(null, day, "FEEDING")]);
  const canRecord = level === "RECORD" || level === "ADMIN";
  const isAdmin = level === "ADMIN";
  const editable = canRecord && (isAdmin || (day === today && lock.state === "OPEN"));
  const rows = new Map(eat.rows.map((r) => [r.animalId, r]));
  return (
    <Shell title="Evési napló" active="eating" user={user}>
      <div className="toolbar">
        <DayNav path="/evesi-naplo" day={day} today={today} />
        <span className="spacer" />
        <span className={`badge ${eat.listState === "FINALIZED" ? "badge-valid" : "badge-pending"}`}>
          {eat.listState === "FINALIZED" ? "Lista kész" : "Lista nincs kész"}
        </span>
        <DayControls kind="FEEDING" day={day} status={lock} isAdmin={isAdmin} />
      </div>
      {eat.reopened && <div className="banner banner-warn">Újranyitva: a koplalónapok a nap újbóli lezárásakor számolódnak újra.</div>}
      <div className="card">
        <h2>Evési állapotok</h2>
        <p className="hint">A listán szereplő állat evett, nem evett meg mindent vagy nem evett; aki nincs a listán, koplalónapot kap (a kész lista lezárásakor magától).</p>
        <div className="table-scroll">
          <table className="log-table" data-testid="eating-table">
            <thead>
              <tr><th>Állat</th><th>Csoport</th><th>Medence</th><th>Állapot</th><th>Jelölés</th>{editable && <th></th>}</tr>
            </thead>
            <tbody>
              {feed.animals.map((a) => {
                const r = rows.get(a.id);
                const s = r?.status ?? null;
                return (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td>{a.groupName ?? "–"}</td>
                    <td>{a.poolName ?? "–"}</td>
                    <td className="keep">
                      {s ? (
                        <span className={`badge eat-${s.state}`} data-testid={`state-${a.name}`}>
                          {EAT_LABEL[s.state]}
                          {s.source === "AUTOMATIC" ? " (automatikus)" : ""}
                        </span>
                      ) : r?.pendingFasting ? (
                        <span className="badge eat-pending" data-testid={`state-${a.name}`}>koplal, még nem végleges</span>
                      ) : (
                        <span className="hint" data-testid={`state-${a.name}`}>{a.selected ? "nincs rögzítve" : "–"}</span>
                      )}
                    </td>
                    <td>
                      {s?.vitamin ? "V " : ""}
                      {s?.medicine ? `Gy${s.medicineNote ? `: ${s.medicineNote}` : ""}` : ""}
                    </td>
                    {editable && (
                      <td className="keep">
                        <EatingForm day={day} animalId={a.id} name={a.name} selected={a.selected} status={s} />
                      </td>
                    )}
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
