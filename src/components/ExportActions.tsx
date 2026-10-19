"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

function requestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

type ApiError = { error?: { message?: string; problems?: { problem: string }[] } };

/** Creates a ZIMS CSV run for the filter shown on the page (T-20: preview, trial or submission). */
export function ZimsCreate({ from, to, poolIds }: { from: string; to: string; poolIds: string[] }) {
  const router = useRouter();
  const [purpose, setPurpose] = useState<"PREVIEW" | "TRIAL" | "SUBMISSION">("SUBMISSION");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/exports/zims", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: requestId(), from, to, poolIds: poolIds.length ? poolIds : null, purpose }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setMsg({ ok: false, text: "Nincs kapcsolat a szerverrel." });
    const b = (await res.json().catch(() => ({}))) as ApiError & { files?: unknown[]; warnings?: string[] };
    if (!res.ok) {
      const details = b.error?.problems?.slice(0, 5).map((p) => p.problem).join("; ");
      return setMsg({ ok: false, text: `${b.error?.message ?? "Az export nem készült el."}${details ? ` (${details})` : ""}` });
    }
    setMsg({ ok: true, text: `Elkészült: ${b.files?.length ?? 0} fájl.${b.warnings?.length ? ` Figyelmeztetés: ${b.warnings.join(" ")}` : ""}` });
    router.refresh();
  }
  return (
    <div className="toolbar" data-testid="zims-create">
      <label className="field">
        Cél
        <select className="input" value={purpose} onChange={(e) => setPurpose(e.target.value as typeof purpose)} aria-label="Az export célja">
          <option value="SUBMISSION">Leadásra (ZIMS-be)</option>
          <option value="TRIAL">Próbaimportra</option>
          <option value="PREVIEW">Előnézet</option>
        </select>
      </label>
      <button className="btn" type="button" disabled={busy} onClick={() => void run()}>
        ZIMS CSV készítése
      </button>
      {msg && (
        <span className={msg.ok ? "hint" : "err"} role="status" data-testid="zims-message">
          {msg.text}
        </span>
      )}
    </div>
  );
}

/** Admin: the submission run was uploaded into ZIMS, or ZIMS refused it. */
export function SubmissionButtons({ runId }: { runId: string }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  async function mark(state: "SUBMITTED" | "REJECTED") {
    let reason: string | undefined;
    if (state === "REJECTED") {
      const r = window.prompt("Miért utasította el a ZIMS?");
      if (!r || r.trim().length < 3) return;
      reason = r.trim();
    }
    const res = await fetch(`/api/exports/runs/${runId}/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: requestId(), state, ...(reason ? { reason } : {}) }),
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as ApiError;
      setErr(b.error?.message ?? "Nem sikerült.");
      return;
    }
    router.refresh();
  }
  return (
    <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
      <button className="btn btn-soft" type="button" onClick={() => void mark("SUBMITTED")}>
        Leadva a ZIMS-be
      </button>
      <button className="btn btn-soft" type="button" onClick={() => void mark("REJECTED")}>
        Elutasítva
      </button>
      {err && <span className="err">{err}</span>}
    </span>
  );
}
