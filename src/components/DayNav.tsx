import Link from "next/link";
import { addDays, formatDay, weekdayName } from "@/lib/time";

/**
 * Previous and next day of a dated page; no step past today. Lili 2026-10-29 (package item 2, msg
 * 1565432942686244978): the day of the week small under the date, and the two step buttons smaller (one mostly
 * moves with the calendar beside them).
 */
export function DayNav({ path, day, today }: { path: string; day: string; today: string }) {
  return (
    <span className="toolbar day-nav" style={{ margin: 0 }} data-testid="day-nav">
      <Link className="btn btn-soft btn-day" href={`${path}?nap=${addDays(day, -1)}`}>
        ‹ előző nap
      </Link>
      <span className="day-shown">
        <strong data-testid="shown-day">{formatDay(day)}</strong>
        <small data-testid="shown-weekday">{weekdayName(day)}</small>
      </span>
      {day < today && (
        <Link className="btn btn-soft btn-day" href={`${path}?nap=${addDays(day, 1)}`}>
          következő nap ›
        </Link>
      )}
    </span>
  );
}

/**
 * The jump calendar beside the day arrows (the eating log and withdrawal pages; the feeding page since
 * Lili 2026-10-27 12:36 UTC): the chosen day opens. `keep` carries other query values (the withdrawal's compare period).
 */
export function DayJump({ path, day, today, keep = {} }: { path: string; day: string; today: string; keep?: Record<string, string> }) {
  return (
    <form method="get" action={path} style={{ display: "flex", gap: 10, alignItems: "flex-end" }} data-testid="day-picker">
      {Object.entries(keep).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label className="field">
        Nap
        <input className="input" type="date" name="nap" defaultValue={day} max={today} />
      </label>
      <button className="btn btn-soft" type="submit">Ugrás</button>
    </form>
  );
}
