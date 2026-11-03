import Link from "next/link";
import { DayControls } from "@/components/DayControls";
import { FridgeCard } from "@/components/FridgeCard";
import { MeasurementGrid } from "@/components/MeasurementGrid";
import { dayStatus } from "@/lib/journal";
import { Shell } from "@/components/Shell";
import { waterHelper } from "@/lib/helpers";
import { helperStockAccess } from "@/lib/helper-access";
import { prisma } from "@/lib/db";
import { fridgeAlert, fridgeAlertText, type FridgeAlert } from "@/lib/fridge-alert";
import { fridgeDay } from "@/lib/fridges";
import { monogramResolver, responsiblePeople } from "@/lib/master";
import { getGrid, listGroups } from "@/lib/queries";
import { saveReminderOn } from "@/lib/save-reminder-setting";
import { requireModuleRead } from "@/lib/session";
import { businessDayOf, formatDay, isValidDay, localDateTimeOf, weekdayName } from "@/lib/time";

/**
 * The two daily group buttons carry a picture above the text (Lili 2026-10-26: Nagy medencék -> the capybara,
 * Kis Akváriumok -> the shrimp). The label is presentation only: the group's stored name (exports, reports,
 * settings) is untouched. The pictures are 360 px wide WebP files with an alpha channel; the inactive button
 * shows the same colored file in grayscale through CSS.
 */
const TAB_LOOK: Record<string, { image: string; width: number; height: number; label?: string }> = {
  NAPI_NAGY: { image: "/vizmeres/nagymedencek.webp", width: 360, height: 189 },
  NAPI_KIS: { image: "/vizmeres/kis-akvariumok.webp", width: 360, height: 334, label: "Kis Akváriumok" },
};

/**
 * THE THIRD TILE (Lili 2026-11-03 16:29 UTC, task caparium-fagyaszto-csempe): "Fagyasztók hőmérséklete", the shark in a
 * woolly hat. It opens the fridges' own page (the "Hűtők" card moved there from under the big pools' table); it is no
 * measurement group, so the water exports and reports never see it. The picture is portrait (360 x 461) and the label long, so
 * its box has its own class (.tab-picture-box-wide in globals.css): 2 : 1, so the tile is no taller than Kis Akváriumok, and the
 * picture fits inside whole (object-fit: contain); on the tablet, where the tiles have one fixed width, the Kis Akváriumok ratio.
 */
const FRIDGE_TILE = {
  href: "/vizmeres/hutok",
  image: "/vizmeres/fagyasztok.webp",
  width: 360,
  height: 461,
  label: "Fagyasztók hőmérséklete",
};

export type MeasurementSearch = { csoport?: string; nap?: string; kor?: string };

type TabGroup = { id: string; code: string; name: string };

/**
 * The daily page's tiles: the water groups, then (daily only) the fridges' tile with its corner mark. `activeGroupId` is
 * null on the fridges' page, where the fridge tile is the active one.
 */
function waterTabs({
  groups,
  activeGroupId,
  day,
  basePath,
  daily,
  fridge,
}: {
  groups: TabGroup[];
  activeGroupId: string | null;
  day: string;
  basePath: string;
  daily: boolean;
  fridge?: { active: boolean; alert: FridgeAlert | null };
}) {
  return (
    <div className="tabs" role="tablist" aria-label="Mérési csoport">
      {groups.map((g) => {
        const look = daily ? TAB_LOOK[g.code] : undefined;
        return (
          <Link
            key={g.id}
            role="tab"
            aria-selected={g.id === activeGroupId}
            className={`tab${look ? " tab-picture" : ""}${g.id === activeGroupId ? " active" : ""}`}
            href={`${basePath}?csoport=${g.code}&nap=${day}`}
          >
            {look && (
              <span className="tab-picture-box" style={{ aspectRatio: `${look.width} / ${look.height}` }}>
                <img src={look.image} alt="" width={look.width} height={look.height} />
              </span>
            )}
            <span className="tab-label">{look?.label ?? g.name}</span>
          </Link>
        );
      })}
      {daily && fridge && (
        <Link
          role="tab"
          aria-selected={fridge.active}
          className={`tab tab-picture${fridge.active ? " active" : ""}`}
          href={`${FRIDGE_TILE.href}?nap=${day}`}
          data-testid="fridge-tile"
        >
          {fridge.alert && (
            <span className="tab-alert" role="img" aria-label={fridgeAlertText(fridge.alert)} title={fridgeAlertText(fridge.alert)} data-testid="fridge-alert">
              !
            </span>
          )}
          <span className="tab-picture-box tab-picture-box-wide">
            <img src={FRIDGE_TILE.image} alt="" width={FRIDGE_TILE.width} height={FRIDGE_TILE.height} />
          </span>
          <span className="tab-label">{FRIDGE_TILE.label}</span>
        </Link>
      )}
    </div>
  );
}

/** The day picker of the water pages; `group` is left out on the fridges' page. */
function dayPickerFor(basePath: string, day: string, today: string, groupCode?: string) {
  return (
    <form method="get" action={basePath} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
      {groupCode && <input type="hidden" name="csoport" value={groupCode} />}
      <label className="field">
        Nap
        <input className="input" type="date" name="nap" defaultValue={day} max={today} />
      </label>
      <button className="btn btn-soft" type="submit">Ugrás</button>
    </form>
  );
}

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
  const people = await responsiblePeople(day, today);

  // Lili 2026-11-01 22:59 UTC (msg 1566587603879469096): less dead space in the head. The date and the day's state on one row;
  // the table picker, the day picker and the save button on the next (MeasurementGrid draws that row, the button is its)
  const daily = frequency === "DAILY";
  const fridges = daily ? await fridgeDay(day) : null;
  const tables = waterTabs({
    groups,
    activeGroupId: group.id,
    day,
    basePath,
    daily,
    fridge: fridges ? { active: false, alert: fridgeAlert(fridges.fridges, fridges.readings) } : undefined,
  });
  const dayPicker = dayPickerFor(basePath, day, today, group.code);

  return (
    <Shell title={title} active={active} user={user} helper={await waterHelper(await helperStockAccess(user))}>
      <div className="water-head" data-testid="water-head">
        <p className="hint" style={{ fontSize: 20, margin: 0 }}>
          {formatDay(day)} · {weekdayName(day)}
        </p>
        <DayControls groupId={group.id} day={day} status={status} isAdmin={level === "ADMIN"} />
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
          saveReminder={await saveReminderOn(prisma)}
          tables={tables}
          dayPicker={dayPicker}
        />
      )}
      {!grid && (
        <div className="toolbar toolbar-end">
          {tables}
          <span className="spacer" />
          {dayPicker}
        </div>
      )}
    </Shell>
  );
}

/**
 * THE FRIDGES' OWN PAGE (Lili 2026-11-03, task caparium-fagyaszto-csempe): the "Hűtők" card, which sat under the big pools'
 * table until now, behind the third tile. Same head and tiles as the daily water page, the fridge tile active; every
 * fridge and freezer one row (they are one kind for the team), the range, the red mark, the export unchanged.
 */
export async function FridgePage({ sp }: { sp: { nap?: string } }) {
  const { user, level } = await requireModuleRead("WATER");
  const today = businessDayOf(new Date());
  const day = sp.nap && isValidDay(sp.nap) ? sp.nap : today;
  const groups = (await listGroups()).filter((g) => g.frequency === "DAILY");
  const data = await fridgeDay(day);
  return (
    <Shell title="Fagyasztók hőmérséklete" active="daily" user={user} helper={await waterHelper(await helperStockAccess(user))}>
      <div className="water-head" data-testid="water-head">
        <p className="hint" style={{ fontSize: 20, margin: 0 }}>
          {formatDay(day)} · {weekdayName(day)}
        </p>
      </div>
      <div className="toolbar toolbar-end">
        {waterTabs({
          groups,
          activeGroupId: null,
          day,
          basePath: "/vizmeres",
          daily: true,
          fridge: { active: true, alert: fridgeAlert(data.fridges, data.readings) },
        })}
        <span className="spacer" />
        {dayPickerFor(FRIDGE_TILE.href, day, today)}
      </div>
      {await fridgeSection(data, day, today, level)}
    </Shell>
  );
}

/** The "Hűtők" card of a day: the fridges, the day's readings, who recorded each. */
async function fridgeSection(
  { fridges, readings }: Awaited<ReturnType<typeof fridgeDay>>,
  day: string,
  today: string,
  level: string,
) {
  const who = await monogramResolver(readings.map((r) => r.createdById));
  return (
    <FridgeCard
      fridges={fridges}
      readings={readings.map((r) => ({
        id: r.id,
        fridgeId: r.fridgeId,
        measuredAt: r.measuredAt,
        temperature: r.temperature,
        min: r.min,
        max: r.max,
        outOfRange: r.outOfRange,
        defrost: r.defrost,
        note: r.note,
        version: r.version,
        by: who.monogram(r.createdById, new Date(r.measuredAt)),
      }))}
      canWrite={level === "RECORD" || level === "ADMIN"}
      isAdmin={level === "ADMIN"}
      day={day}
      today={today}
      nowAt={localDateTimeOf(new Date())}
    />
  );
}
