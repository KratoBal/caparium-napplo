"use client";

// The lock of the shown day (adatmodell 14. terület): state for everyone, reopen/close for admins.
// A feeding day can also be closed by hand before midnight (T-01/3), a water day only after a reopen.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { askReason, useReasonsOn } from "./ReasonSwitch";

type Status = { state: "OPEN" | "CLOSED"; closeMode: "MANUAL" | "AUTOMATIC" | null; reopened: boolean };

function requestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export type DayLock = { kind: "WATER" | "FEEDING" | "WITHDRAWAL"; day: string; status: Status; isAdmin: boolean };

/**
 * `bottom` (Lili 2026-10-29 08:29 UTC, msg 1565281522519375953): the same close action under a page's save button too,
 * so nobody scrolls back up. Only the buttons there (the state badge stays on top); it beside an unsaved draft asks
 * first, which the top one cannot, as it does not see the draft (`unsaved`, the count of unsaved cells or rows).
 */
export function DayControls({
  groupId,
  kind = "WATER",
  day,
  status,
  isAdmin,
  bottom = false,
  unsaved = 0,
}: {
  groupId?: string;
  kind?: "WATER" | "FEEDING" | "WITHDRAWAL";
  day: string;
  status: Status;
  isAdmin: boolean;
  bottom?: boolean;
  unsaved?: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const reasonsOn = useReasonsOn();
  const label = status.reopened
    ? "Újranyitva"
    : status.state === "CLOSED"
      ? status.closeMode === "AUTOMATIC"
        ? "Lezárva (automatikusan, éjfélkor)"
        : "Lezárva"
      : "Nyitott";

  async function act(path: "reopen" | "close") {
    setError(null);
    if (path === "close" && unsaved > 0 && !window.confirm(`${unsaved} mentetlen változás van ezen a lapon. Előbb mentsd el, mert a lezárás után csak újranyitással írható. Lezárod most, mentés nélkül?`)) return;
    let reason: string | undefined;
    if (path === "reopen") {
      const asked = askReason(reasonsOn, "A nap újranyitásának oka:", "Újranyitod ezt a napot?");
      if (!asked) return;
      reason = asked.reason;
    }
    const res = await fetch(`/api/journal-days/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: requestId(), kind, ...(groupId ? { groupId } : {}), day, ...(reason ? { reason } : {}) }),
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setError(b.error?.message ?? "A művelet nem sikerült.");
      return;
    }
    router.refresh();
  }

  const closable = isAdmin && (status.reopened || (kind !== "WATER" && status.state === "OPEN"));
  if (bottom)
    return closable ? (
      <div className="day-controls no-print" data-testid="day-status-bottom">
        <button className="btn btn-soft" type="button" onClick={() => void act("close")}>
          Nap lezárása
        </button>
        {error && <span className="err">{error}</span>}
      </div>
    ) : null;
  return (
    <div className="day-controls" data-testid="day-status">
      <span className={`badge ${status.state === "CLOSED" && !status.reopened ? "badge-invalid" : "badge-valid"}`}>{label}</span>
      {isAdmin && status.state === "CLOSED" && (
        <button className="btn btn-soft" type="button" onClick={() => void act("reopen")}>
          Nap újranyitása
        </button>
      )}
      {closable && (
        <button className="btn btn-soft" type="button" onClick={() => void act("close")}>
          Nap lezárása
        </button>
      )}
      {error && <span className="err">{error}</span>}
    </div>
  );
}
