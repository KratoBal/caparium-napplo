import { DayControls } from "@/components/DayControls";
import { DayJump, DayNav } from "@/components/DayNav";
import { EatingTable } from "@/components/FeedingForms";
import { Shell } from "@/components/Shell";
import { feedingHelper } from "@/lib/helpers";
import { moduleLevel } from "@/lib/master";
import { prisma } from "@/lib/db";
import { eatingDayView } from "@/lib/eating";
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
    <Shell title="Evési napló" active="eating" user={user} helper={await feedingHelper((await moduleLevel(prisma, user.id, user.role, "DOSING")) !== "NONE")}>
      <div className="toolbar">
        <DayNav path="/evesi-naplo" day={day} today={today} />
        {/* Lili 2026-10-26 (Caparium channel msg 1564356412946124921, item 4): the jump calendar, as on the water measurement
            and withdrawal pages: the chosen day opens, and jumping back to today opens today's */}
        <DayJump path="/evesi-naplo" day={day} today={today} />
        <span className="spacer" />
        <span className={`badge ${eat.listState === "FINALIZED" ? "badge-valid" : "badge-pending"}`}>
          {eat.listState === "FINALIZED" ? "Lista kész" : "Lista nincs kész"}
        </span>
        <DayControls kind="FEEDING" day={day} status={lock} isAdmin={isAdmin} />
      </div>
      {eat.reopened && <div className="banner banner-warn">Újranyitva: a koplalónapok a nap újbóli lezárásakor számolódnak újra.</div>}
      <div className="card">
        <h2>Evési állapotok</h2>
        <p className="hint">
          Csak a napi etetési listán szereplő állatokat kell kitölteni: evett, nem evett meg mindent vagy nem evett. Aki nincs a
          listán, arra nem kell semmit beírni: a kész lista lezárásakor magától koplalónapot kap. Töltsd ki a sorokat, és egyszer
          ments: a mentés csak a kitöltött vagy megváltoztatott sorokat rögzíti.
        </p>
        {/* keyed by the day: DayNav changes ?nap= on the same route, which keeps a client component's state, so an
            unsaved draft (and an opened fasting row) would move to the other day (barracuda on #50, the #45 lesson) */}
        <EatingTable
          key={day}
          day={day}
          editable={editable}
          rows={feed.animals.map((a) => {
            const r = rows.get(a.id);
            return {
              animalId: a.id,
              name: a.name,
              groupName: a.groupName ?? null,
              poolName: a.poolName ?? null,
              selected: a.selected,
              pendingFasting: !!r?.pendingFasting,
              status: r?.status ?? null,
            };
          })}
        />
      </div>
    </Shell>
  );
}
