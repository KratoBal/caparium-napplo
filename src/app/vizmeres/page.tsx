import Link from "next/link";
import { MeasurementGrid } from "@/components/MeasurementGrid";
import { Shell } from "@/components/Shell";
import { prisma } from "@/lib/db";
import { getGrid, listGroups } from "@/lib/queries";
import { requireUser } from "@/lib/session";
import { businessDayOf, formatDayLong, isValidDay, weekdayName } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function DailyMeasurementPage({
  searchParams,
}: {
  searchParams: Promise<{ csoport?: string; nap?: string; kor?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const today = businessDayOf(new Date());
  const day = sp.nap && isValidDay(sp.nap) ? sp.nap : today;
  const groups = (await listGroups()).filter((g) => g.frequency === "DAILY");
  const group = groups.find((g) => g.code === sp.csoport) ?? groups[0];
  if (!group) {
    return (
      <Shell title="Napi vízmérések" active="daily" user={user}>
        <div className="card">Nincs aktív napi mérési csoport. Az adminisztrátor a beállításokban veheti fel.</div>
      </Shell>
    );
  }
  const roundSeq = Number(sp.kor) || undefined;
  const grid = await getGrid(group.id, day, roundSeq);
  const people = await prisma.user.findMany({
    where: { active: true, role: { in: ["AQUARIST", "ADMIN"] } },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true },
  });

  return (
    <Shell title="Napi vízmérések" active="daily" user={user}>
      <p className="hint" style={{ fontSize: 20, marginTop: 0 }}>
        {formatDayLong(day)} · {weekdayName(day)}
      </p>
      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="Mérési csoport">
          {groups.map((g) => (
            <Link
              key={g.id}
              role="tab"
              aria-selected={g.id === group.id}
              className={`tab${g.id === group.id ? " active" : ""}`}
              href={`/vizmeres?csoport=${g.code}&nap=${day}`}
            >
              {g.name}
            </Link>
          ))}
        </div>
        <span className="spacer" />
        <form method="get" action="/vizmeres" style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <input type="hidden" name="csoport" value={group.code} />
          <label className="field">
            Nap
            <input className="input" type="date" name="nap" defaultValue={day} max={today} />
          </label>
          <button className="btn btn-soft" type="submit">Ugrás</button>
        </form>
      </div>
      {grid && (
        <MeasurementGrid
          key={`${group.id}:${day}:${grid.selectedRound?.seq ?? 0}`}
          initial={grid}
          groupCode={group.code}
          today={today}
          user={{ id: user.id, role: user.role }}
          people={people}
        />
      )}
    </Shell>
  );
}
