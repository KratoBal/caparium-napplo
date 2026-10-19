import { DayControls } from "@/components/DayControls";
import { DayNav } from "@/components/DayNav";
import { FeedingDay } from "@/components/FeedingDay";
import { ApplyPlan } from "@/components/FeedingForms";
import type { FeedOpt, Recipient } from "@/components/FeedingForms";
import { Shell } from "@/components/Shell";
import { referencesOn } from "@/lib/calculator";
import { prisma } from "@/lib/db";
import { feedingDayView } from "@/lib/feeding";
import { knownOtherNames, listFeeds } from "@/lib/feeds";
import { dayStatus } from "@/lib/journal";
import { requireModuleRead } from "@/lib/session";
import { businessDayOf, isValidDay } from "@/lib/time";

export const dynamic = "force-dynamic";

// EGY-01..EGY-12: the common daily list (NY-06 default), then the items, totals per unit (DN-16).
export default async function FeedingPage({ searchParams }: { searchParams: Promise<{ nap?: string }> }) {
  const { user, level } = await requireModuleRead("FEEDING");
  const today = businessDayOf(new Date());
  const sp = await searchParams;
  const day = sp.nap && isValidDay(sp.nap) && sp.nap <= today ? sp.nap : today;
  const [view, lock, types, units, references, otherNames] = await Promise.all([
    feedingDayView(day),
    dayStatus(null, day, "FEEDING"),
    listFeeds(),
    prisma.unit.findMany({ where: { active: true }, orderBy: { symbol: "asc" } }),
    referencesOn(day),
    knownOtherNames(),
  ]);
  const canRecord = level === "RECORD" || level === "ADMIN";
  const isAdmin = level === "ADMIN";
  const editable = canRecord && (isAdmin || (day === today && lock.state === "OPEN"));
  const groups = new Map<string, { name: string; members: string[]; selected: number }>();
  for (const a of view.animals) {
    if (!a.groupId) continue;
    const g = groups.get(a.groupId) ?? { name: a.groupName ?? "?", members: [], selected: 0 };
    g.members.push(a.id);
    if (a.selected) g.selected += 1;
    groups.set(a.groupId, g);
  }
  const recipients: Recipient[] = [
    ...view.animals.filter((a) => a.selected).map((a) => ({ key: a.id, label: a.name, animalId: a.id })),
    ...[...groups].filter(([, g]) => g.selected > 0).map(([id, g]) => ({ key: `g:${id}`, label: `${g.name} (csoport)`, groupId: id })),
  ];
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
    <Shell title="Takarmánynapló" active="feeding" user={user}>
      <div className="toolbar">
        <DayNav path="/etetes" day={day} today={today} />
        <span className="spacer" />
        <span className={`badge ${view.listState === "FINALIZED" ? "badge-valid" : "badge-pending"}`} data-testid="list-state">
          {view.listState === "FINALIZED" ? "Lista kész" : "Lista nincs kész"}
        </span>
        {editable && <ApplyPlan day={day} />}
        <DayControls kind="FEEDING" day={day} status={lock} isAdmin={isAdmin} />
      </div>

      <FeedingDay
        day={day}
        editable={editable}
        finalized={view.listState === "FINALIZED"}
        animals={view.animals}
        groups={[...groups].map(([id, g]) => ({ id, name: g.name, members: g.members }))}
        items={view.items}
        totals={view.totals}
        references={references}
        otherNames={otherNames}
        recipients={recipients}
        feeds={feeds}
      />
    </Shell>
  );
}
