import Link from "next/link";
import { DayControls } from "@/components/DayControls";
import { DayJump, DayNav } from "@/components/DayNav";
import { FeedingDay } from "@/components/FeedingDay";
import { ApplyPlan } from "@/components/FeedingForms";
import { ApplyList } from "@/components/FeedingLists";
import type { FeedOpt, FeedTypeOpt, Recipient } from "@/components/FeedingForms";
import { Shell } from "@/components/Shell";
import { feedingHelper } from "@/lib/helpers";
import { moduleLevel } from "@/lib/master";
import { referencesOn } from "@/lib/calculator";
import { prisma } from "@/lib/db";
import { feedingDayView } from "@/lib/feeding";
import { knownOtherNames, listFeeds } from "@/lib/feeds";
import { activeFeedingLists } from "@/lib/feeding-lists";
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
  const [view, lock, types, units, references, otherNames, lists] = await Promise.all([
    feedingDayView(day),
    dayStatus(null, day, "FEEDING"),
    listFeeds(),
    prisma.unit.findMany({ where: { active: true }, orderBy: { symbol: "asc" } }),
    referencesOn(day),
    knownOtherNames(),
    activeFeedingLists(),
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
        ...(f.sheetTick ? { tick: true as const } : {}),
        dims: f.dimensions.map((d) => ({
          dimension: d,
          base: units.find((u) => u.dimension === d && u.isBase)?.symbol ?? "?",
          units: units.filter((u) => u.dimension === d).map((u) => ({ id: u.id, symbol: u.symbol, factor: Number(u.factorToBase ?? 1) })),
        })),
      })),
  );
  // 6fe63c9b, step 2: the day's feeds narrow what is offered; "Egyéb" stays (it takes its real name per item)
  const chosen = new Set(view.feedIds);
  const offered = chosen.size ? feeds.filter((f) => chosen.has(f.id) || f.isOther) : feeds;
  // the sheet's columns: the chosen feeds, or, if none were chosen, the feeds already given that day; never "Egyéb"
  const given = new Set(view.items.map((i) => i.feedId));
  const sheetFeeds = feeds.filter((f) => !f.isOther && (chosen.size ? chosen.has(f.id) : given.has(f.id)));
  const feedTypes: FeedTypeOpt[] = types
    .filter((t) => t.code !== "EGYEB")
    .map((t) => ({ code: t.code, name: t.name, emoji: t.emoji, feeds: t.feeds.filter((f) => f.active).map((f) => ({ id: f.id, name: f.name })) }))
    .filter((t) => t.feeds.length > 0);
  return (
    <Shell title="Takarmánynapló" active="feeding" user={user} helper={await feedingHelper((await moduleLevel(prisma, user.id, user.role, "DOSING")) !== "NONE")}>
      <div className="toolbar">
        <DayNav path="/etetes" day={day} today={today} />
        {/* Lili 2026-10-27 12:32 and 12:36 UTC (item 7): the jump calendar beside the arrows, as on the eating log */}
        <DayJump path="/etetes" day={day} today={today} />
        <span className="spacer" />
        {/* Lili 2026-10-27 (item 5): the list's state moved to the "Takarmánylap kész" button at the bottom of the choice */}
        {/* Lili 2026-10-26 (item 1): the named lists in the header, beside the weekly plan's button */}
        {editable && lists.length > 0 && (
          <ApplyList
            day={day}
            lists={lists.map((l) => ({ id: l.id, name: l.name }))}
            selectedAnimalIds={view.animals.filter((a) => a.selected).map((a) => a.id)}
            dayFeedIds={view.feedIds}
          />
        )}
        {editable && <ApplyPlan day={day} />}
        {/* Lili 2026-10-26 (msg 1564404799359946884): the timetable is the admin's for now; nobody else sees the entry */}
        {isAdmin && (
          <Link className="btn btn-soft" href="/etetes/rend">
            Etetési rend
          </Link>
        )}
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
        feeds={offered}
        feedTypes={feedTypes}
        dayFeedIds={view.feedIds}
        sheetFeeds={sheetFeeds}
      />
    </Shell>
  );
}
