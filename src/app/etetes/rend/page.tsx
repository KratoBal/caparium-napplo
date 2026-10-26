import { Shell } from "@/components/Shell";
import type { FeedTypeOpt } from "@/components/FeedingForms";
import { FeedingListsEditor } from "@/components/FeedingLists";
import { Timetable } from "@/components/Timetable";
import { prisma } from "@/lib/db";
import { feedingDayView } from "@/lib/feeding";
import { activeFeedingLists } from "@/lib/feeding-lists";
import { listFeeds } from "@/lib/feeds";
import { currentPlans } from "@/lib/feeding-plan";
import { feedingHelper } from "@/lib/helpers";
import { moduleLevel } from "@/lib/master";
import { requireModuleRead } from "@/lib/session";
import { businessDayOf } from "@/lib/time";

export const dynamic = "force-dynamic";

// 6fe63c9b, item 4: the feeding timetable on one screen (Lili: "az admin létrehoz egy heti órarendet"). The same
// plans as the animal's own form and the "Lista a terv szerint" button. The starting data is intentionally empty
// (acrobot 34526): page 24's table is not loaded, the admin ticks the days here.
export default async function TimetablePage() {
  const { user, level } = await requireModuleRead("FEEDING");
  const today = businessDayOf(new Date());
  const [view, plans, lists, types] = await Promise.all([feedingDayView(today), currentPlans(), activeFeedingLists(), listFeeds()]);
  const feedTypes: FeedTypeOpt[] = types
    .filter((t) => t.code !== "EGYEB")
    .map((t) => ({ code: t.code, name: t.name, emoji: t.emoji, feeds: t.feeds.filter((f) => f.active).map((f) => ({ id: f.id, name: f.name })) }))
    .filter((t) => t.feeds.length > 0);
  const canRecord = level === "RECORD" || level === "ADMIN";
  const animals = view.animals.map((a) => ({ id: a.id, name: a.name, groupName: a.groupName, poolName: a.poolName, weekdays: plans[a.id] ?? [] }));
  return (
    <Shell title="Etetési rend" active="feeding" user={user} helper={await feedingHelper((await moduleLevel(prisma, user.id, user.role, "DOSING")) !== "NONE")}>
      <Timetable animals={animals} editable={canRecord} />
      {/* Lili 2026-10-26 (item 1): the named feeding lists, composed by the feeding admin */}
      {level === "ADMIN" && (
        <FeedingListsEditor
          lists={lists}
          animals={view.animals.map((a) => ({ id: a.id, name: a.name, poolName: a.poolName, poolEmoji: a.poolEmoji }))}
          types={feedTypes}
        />
      )}
    </Shell>
  );
}
