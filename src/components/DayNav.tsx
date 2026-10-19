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
