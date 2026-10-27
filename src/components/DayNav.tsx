import Link from "next/link";
import { addDays, formatDayLong } from "@/lib/time";

/** Previous and next day of a dated page; no step past today. */
export function DayNav({ path, day, today }: { path: string; day: string; today: string }) {
  return (
    <span className="toolbar" style={{ margin: 0 }}>
      <Link className="btn btn-soft" href={`${path}?nap=${addDays(day, -1)}`}>
        ‹ előző nap
      </Link>
      <strong data-testid="shown-day">{formatDayLong(day)}</strong>
      {day < today && (
        <Link className="btn btn-soft" href={`${path}?nap=${addDays(day, 1)}`}>
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
