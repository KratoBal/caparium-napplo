"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { askReason, useReasonsOn } from "./ReasonSwitch";

function requestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

type Problem = { problem: string; count?: number; link?: string };
type ApiError = { error?: { message?: string; problems?: Problem[] } };

/** Creates a ZIMS CSV run for the filter shown on the page (T-20: preview, trial or submission). */
export function ZimsCreate({ from, to, poolIds }: { from: string; to: string; poolIds: string[] }) {
  const router = useRouter();
  const [purpose, setPurpose] = useState<"PREVIEW" | "TRIAL" | "SUBMISSION">("SUBMISSION");
  const [msg, setMsg] = useState<{ ok: boolean; text: string; problems?: Problem[] } | null>(null);
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
      // a szerver az azonos hibákat egy sorba vonja, a mérések számával (a lili-eset: 136 azonos sor helyett egy)
      return setMsg({ ok: false, text: b.error?.message ?? "Az export nem készült el.", problems: b.error?.problems?.slice(0, 10) });
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
          {msg.problems?.length ? (
            <ul data-testid="zims-problems">
              {msg.problems.map((p) => (
                <li key={p.problem}>
                  {p.problem}
                  {p.count && p.count > 1 ? ` (${p.count} mérés)` : ""}
                  {p.link ? (
                    <>
                      {" "}
                      <a href={p.link}>Beállítások › Felhasználók</a>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </span>
      )}
    </div>
  );
}

/** Admin: the submission run was uploaded into ZIMS, or ZIMS refused it. */
export function SubmissionButtons({ runId }: { runId: string }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const reasonsOn = useReasonsOn();
  async function mark(state: "SUBMITTED" | "REJECTED") {
    let reason: string | undefined;
    if (state === "REJECTED") {
      const asked = askReason(reasonsOn, "Miért utasította el a ZIMS?", "Elutasítottként jelölöd a ZIMS-beküldést?");
      if (!asked) return;
      reason = asked.reason;
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

/** "Vízmérés kiküldése" (caparium-hibak-4): today's and this week's results by pool, as a PDF, to the address set in Beállítások. */
export function WaterMailButton({ recipient }: { recipient: string }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/exports/water-mail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: requestId() }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setMsg({ ok: false, text: "Nincs kapcsolat a szerverrel." });
    const b = (await res.json().catch(() => ({}))) as ApiError & { to?: string; pools?: number };
    if (!res.ok) return setMsg({ ok: false, text: b.error?.message ?? "A kiküldés nem sikerült." });
    setMsg({ ok: true, text: `Elküldve: ${b.to} (${b.pools ?? 0} medence).` });
  }
  return (
    <div className="toolbar" data-testid="water-mail">
      <button className="btn" type="button" disabled={busy || !recipient} onClick={() => void send()}>
        Vízmérés kiküldése
      </button>
      <span className="hint">{recipient ? `Címzett: ${recipient}` : "Nincs megadva címzett: a Beállításokban állítható be."}</span>
      {msg && (
        <span className={msg.ok ? "hint" : "err"} role="status">
          {msg.text}
        </span>
      )}
    </div>
  );
}
