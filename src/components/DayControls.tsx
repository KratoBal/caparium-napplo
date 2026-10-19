"use client";

// The lock of the shown day (adatmodell 14. terület): state for everyone, reopen/close for admins.
// A feeding day can also be closed by hand before midnight (T-01/3), a water day only after a reopen.
import { useRouter } from "next/navigation";
import { useState } from "react";

type Status = { state: "OPEN" | "CLOSED"; closeMode: "MANUAL" | "AUTOMATIC" | null; reopened: boolean };

function requestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function DayControls({
  groupId,
  kind = "WATER",
  day,
  status,
  isAdmin,
}: {
  groupId?: string;
  kind?: "WATER" | "FEEDING";
  day: string;
  status: Status;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const label = status.reopened
    ? "Újranyitva"
    : status.state === "CLOSED"
      ? status.closeMode === "AUTOMATIC"
        ? "Lezárva (automatikusan, éjfélkor)"
        : "Lezárva"
      : "Nyitott";

  async function act(path: "reopen" | "close") {
    setError(null);
    let reason: string | undefined;
    if (path === "reopen") {
      const r = window.prompt("A nap újranyitásának oka:");
      if (!r || r.trim().length < 3) return;
      reason = r.trim();
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

  return (
    <div className="day-controls" data-testid="day-status">
      <span className={`badge ${status.state === "CLOSED" && !status.reopened ? "badge-invalid" : "badge-valid"}`}>{label}</span>
      {isAdmin && status.state === "CLOSED" && (
        <button className="btn btn-soft" type="button" onClick={() => void act("reopen")}>
          Nap újranyitása
        </button>
      )}
      {isAdmin && (status.reopened || (kind === "FEEDING" && status.state === "OPEN")) && (
        <button className="btn btn-soft" type="button" onClick={() => void act("close")}>
          Nap lezárása
        </button>
      )}
      {error && <span className="err">{error}</span>}
    </div>
  );
}
