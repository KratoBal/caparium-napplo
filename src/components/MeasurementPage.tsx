import Link from "next/link";
import { DayControls } from "@/components/DayControls";
import { MeasurementGrid } from "@/components/MeasurementGrid";
import { dayStatus } from "@/lib/journal";
import { Shell } from "@/components/Shell";
import { waterHelper } from "@/lib/helpers";
import { moduleLevel } from "@/lib/master";
import { prisma } from "@/lib/db";
import { getGrid, listGroups } from "@/lib/queries";
import { requireModuleRead } from "@/lib/session";
import { businessDayOf, formatDayLong, isValidDay, weekdayName } from "@/lib/time";

export type MeasurementSearch = { csoport?: string; nap?: string; kor?: string };

/** The daily and the weekly measurement page share everything but the groups, the title and the path. */
export async function MeasurementPage({
  sp,
  frequency,
  basePath,
  title,
  active,
}: {
  sp: MeasurementSearch;
  frequency: "DAILY" | "WEEKLY";
  basePath: string;
  title: string;
  active: "daily" | "weekly";
}) {
  const { user, level } = await requireModuleRead("WATER");
  const today = businessDayOf(new Date());
  const day = sp.nap && isValidDay(sp.nap) ? sp.nap : today;
  const groups = (await listGroups()).filter((g) => g.frequency === frequency);
  const group = groups.find((g) => g.code === sp.csoport) ?? groups[0];
  if (!group) {
    return (
      <Shell title={title} active={active} user={user}>
        <div className="card">Nincs aktív mérési csoport. Az adminisztrátor a beállításokban veheti fel.</div>
      </Shell>
    );
  }
  const roundSeq = Number(sp.kor) || undefined;
  const grid = await getGrid(group.id, day, roundSeq);
  const status = await dayStatus(group.id, day);
  const people = await prisma.user.findMany({
    where: { active: true, role: { in: ["AQUARIST", "ADMIN"] } },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true },
  });

  return (
    <Shell title={title} active={active} user={user} helper={await waterHelper((await moduleLevel(prisma, user.id, user.role, "DOSING")) !== "NONE")}>
      <p className="hint" style={{ fontSize: 20, marginTop: 0 }}>
        {formatDayLong(day)} · {weekdayName(day)}
      </p>
      <DayControls groupId={group.id} day={day} status={status} isAdmin={level === "ADMIN"} />
      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="Mérési csoport">
          {groups.map((g) => (
            <Link
              key={g.id}
              role="tab"
              aria-selected={g.id === group.id}
              className={`tab${g.id === group.id ? " active" : ""}`}
              href={`${basePath}?csoport=${g.code}&nap=${day}`}
            >
              {g.name}
            </Link>
          ))}
        </div>
        <span className="spacer" />
        <form method="get" action={basePath} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
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
          canWrite={level === "RECORD" || level === "ADMIN"}
          isAdmin={level === "ADMIN"}
          people={people}
          weekly={frequency === "WEEKLY"}
          basePath={basePath}
        />
      )}
    </Shell>
  );
}
