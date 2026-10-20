"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { askReason, useReasonsOn } from "./ReasonSwitch";

function requestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Approve or reject one pending save (K9); rejection needs a reason. */
export function PendingActions({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const reasonsOn = useReasonsOn();

  async function decide(decision: "approve" | "reject") {
    setError(null);
    let reason: string | undefined;
    if (decision === "reject") {
      const asked = askReason(reasonsOn, "Az elutasítás oka:", "Elutasítod ezt a mentést?");
      if (!asked) return;
      reason = asked.reason;
    }
    const res = await fetch(`/api/measurements/${id}/pending`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: requestId(), decision, ...(reason ? { reason } : {}) }),
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setError(b.error?.message ?? "A döntés nem mentődött.");
      return;
    }
    router.refresh();
  }

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <button className="btn" type="button" onClick={() => void decide("approve")}>
        Jóváhagyás
      </button>
      <button className="btn btn-dark" type="button" onClick={() => void decide("reject")}>
        Elutasítás
      </button>
      {error && <span className="err">{error}</span>}
    </div>
  );
}
