"use client";

// Correction and invalidation of one measurement (ÁLT-05, ÁLT-16, DN-09; Figma 21).
// The server decides; this form only sends the changed fields with the version it was shown,
// so a concurrent change becomes a conflict, not an overwrite (T-02).

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useReasonsOn } from "./ReasonSwitch";

type Props = {
  measurement: {
    id: string;
    version: number;
    value: string;
    measuredAtLocal: string;
    responsibleUserId: string;
    traineePerformed: boolean;
    dilution: number | null;
    diluentWater: "RO" | "SW" | null;
    /** a weekly nitrate or phosphate value: the dilution and RO/SW fields belong to it */
    dilutable: boolean;
  };
  people: { id: string; fullName: string }[];
  reasonRequired: boolean;
};

function requestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function CorrectionForm({ measurement: m, people, reasonRequired }: Props) {
  const router = useRouter();
  const original = m.value.replace(".", ",");
  const [value, setValue] = useState(original);
  const [time, setTime] = useState(m.measuredAtLocal);
  const [responsible, setResponsible] = useState(m.responsibleUserId);
  const [trainee, setTrainee] = useState(m.traineePerformed);
  const [dilution, setDilution] = useState<number | null>(m.dilution);
  const [diluent, setDiluent] = useState<"RO" | "SW" | null>(m.diluentWater);
  const [reason, setReason] = useState("");
  const [invalidReason, setInvalidReason] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // the reason switch (src/lib/reasons.ts): off, no reason field and no reason asked
  const reasonsOn = useReasonsOn();
  const needReason = reasonsOn && reasonRequired;

  async function call(url: string, method: string, body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: requestId(), clientTimestamp: new Date().toISOString(), expectedVersion: m.version, ...body }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      if (res.ok) {
        setMessage({ kind: "ok", text: "A változás bekerült a naplóba." });
        router.refresh();
        return;
      }
      const e = payload.error ?? {};
      setMessage({
        kind: "error",
        text:
          e.code === "VERSION_CONFLICT"
            ? "A mérés időközben megváltozott. Töltsd újra az oldalt, és nézd meg a friss értéket."
            : e.message ?? "A változás nem mentődött.",
      });
    } catch {
      setMessage({ kind: "error", text: "Nincs kapcsolat a szerverrel. A változás nem mentődött." });
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const body: Record<string, unknown> = {};
    if (value.trim() !== original) body.value = value.trim();
    if (time !== m.measuredAtLocal) body.measuredAtLocal = time;
    if (responsible !== m.responsibleUserId) body.responsibleUserId = responsible;
    if (trainee !== m.traineePerformed) body.traineePerformed = trainee;
    if (m.dilutable && dilution !== m.dilution) body.dilution = dilution;
    if (m.dilutable && diluent !== m.diluentWater) body.diluentWater = diluent;
    if (Object.keys(body).length === 0) {
      setMessage({ kind: "error", text: "Nincs változás." });
      return;
    }
    if (reason.trim()) body.reason = reason.trim();
    void call(`/api/measurements/${m.id}`, "PATCH", body);
  }

  function invalidate() {
    if (reasonsOn && invalidReason.trim().length < 3) {
      setMessage({ kind: "error", text: "Az érvénytelenítéshez indoklás kell." });
      return;
    }
    if (!window.confirm("Biztosan érvényteleníted ezt a mérést? A bejegyzés megmarad, áthúzva.")) return;
    void call(`/api/measurements/${m.id}/invalidate`, "POST", reasonsOn ? { reason: invalidReason.trim() } : {});
  }

  return (
    <>
      <div className="card" data-testid="correction">
        <span className="tag-soft">{reasonRequired ? "Adminisztrátori művelet" : "Saját mai bejegyzés"}</span>
        <h2 style={{ marginTop: 12 }}>Mérési adat javítása</h2>
        <p className="hint">A javítás nem törli a korábbi értéket; a változás visszakereshető.</p>
        <div className="form-grid">
          <span className="form-label">Eredeti érték</span>
          <span className="pill">{original}</span>
          <label className="form-label" htmlFor="corr-value">Új érték</label>
          <input id="corr-value" className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          <label className="form-label" htmlFor="corr-time">Mérés időpontja</label>
          <input id="corr-time" className="input" type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
          <label className="form-label" htmlFor="corr-resp">Mérést végezte</label>
          <select id="corr-resp" className="input" value={responsible} onChange={(e) => setResponsible(e.target.value)}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </select>
          <span className="form-label">Gyakornok</span>
          <label className="check">
            <input type="checkbox" checked={trainee} onChange={(e) => setTrainee(e.target.checked)} />
            Gyakornok végezte
          </label>
          {m.dilutable && (
            <>
              <label className="form-label" htmlFor="corr-dil">Hígítás</label>
              <select
                id="corr-dil"
                className="input"
                value={dilution ?? ""}
                onChange={(e) => setDilution(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">nincs</option>
                {Array.from({ length: 100 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    1:{d}
                  </option>
                ))}
              </select>
              <label className="form-label" htmlFor="corr-ro">Hígító víz</label>
              <select
                id="corr-ro"
                className="input"
                value={diluent ?? ""}
                onChange={(e) => setDiluent((e.target.value || null) as "RO" | "SW" | null)}
              >
                <option value="">nincs</option>
                <option value="RO">RO</option>
                <option value="SW">SW</option>
              </select>
            </>
          )}
          {reasonsOn && (
            <>
              <label className="form-label" htmlFor="corr-reason">
                Indoklás{needReason ? " (kötelező)" : ""}
              </label>
              <input
                id="corr-reason"
                className="input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={needReason ? "pl. Mérőműszer adatának helyesbítése" : "nem kötelező"}
              />
            </>
          )}
        </div>
        <div className="toolbar">
          <span className="spacer" />
          <button className="btn" type="button" onClick={save} disabled={busy || (needReason && reason.trim().length < 3)}>
            Változtatás naplózása
          </button>
        </div>
        {message && (
          <div className={`banner banner-${message.kind === "ok" ? "ok" : "error"}`} role="status" data-testid="correction-message">
            {message.text}
          </div>
        )}
      </div>
      <div className="card">
        <h2>Érvénytelenítés</h2>
        <p className="hint">Törlés nincs: az érvénytelenített mérés a naplóban áthúzva megmarad{reasonsOn ? ", okkal együtt" : ""}.</p>
        <div className="toolbar">
          {reasonsOn && (
            <input
              className="input"
              style={{ flex: 1, minWidth: 220 }}
              aria-label="Az érvénytelenítés oka"
              placeholder="Az érvénytelenítés oka (kötelező)"
              value={invalidReason}
              onChange={(e) => setInvalidReason(e.target.value)}
            />
          )}
          <button className="btn btn-dark" type="button" onClick={invalidate} disabled={busy}>
            Érvénytelenítés
          </button>
        </div>
      </div>
      <div className="banner banner-ok">Audit: régi érték • új érték • módosító • időpont{reasonsOn ? " • indoklás" : ""}</div>
    </>
  );
}
