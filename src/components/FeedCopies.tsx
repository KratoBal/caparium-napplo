"use client";

// The basic data's copies (Lili 2026-10-29, package item 14): an admin's operation with a dry run, as the feeding day's
// restore. "Keresés" lists the feeds the old start made again after a correction, with what refers to them; the run
// makes them inactive (a feed is never deleted, DAT-02), with an audit row in the admin's name. src/lib/feed-copies.ts
import { useRouter } from "next/navigation";
import { useState } from "react";
import { askReason, useReasonsOn } from "./ReasonSwitch";

type Copy = { id: string; name: string; createdAt: string; originalName: string; uses: { items: number; withdrawals: number; lists: number; doses: number; days: number } };
type Outcome = { id: string; name: string; outcome: "inactivated" | "failed"; error?: string };

function requestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

const usesText = (u: Copy["uses"]) =>
  [u.items && `${u.items} tétel`, u.withdrawals && `${u.withdrawals} kivétel`, u.lists && `${u.lists} lista`, u.doses && `${u.doses} alapmennyiség`, u.days && `${u.days} nap`]
    .filter(Boolean)
    .join(", ") || "nincs rajta adat";

export function FeedCopies() {
  const router = useRouter();
  const reasonsOn = useReasonsOn();
  const [copies, setCopies] = useState<Copy[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/feed-copies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: requestId(), ...body }) });
      const b = (await res.json().catch(() => ({}))) as { copies?: Copy[]; results?: Outcome[]; error?: { message?: string } };
      if (!res.ok) {
        setMsg({ ok: false, text: b.error?.message ?? "Nem sikerült." });
        return null;
      }
      return b;
    } catch {
      setMsg({ ok: false, text: "Nincs kapcsolat a szerverrel." });
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function plan() {
    const b = await call({ mode: "plan" });
    if (b) setCopies(b.copies ?? []);
  }
  async function run() {
    const why = askReason(reasonsOn, "Az inaktiválás oka:", `${copies!.length} másodpéldányt inaktiválsz. A rajtuk lévő adat megmarad. Folytatod?`);
    if (!why) return;
    const b = await call({ mode: "run", ...why });
    if (!b?.results) return;
    const failed = b.results.filter((r) => r.outcome === "failed");
    setMsg(
      failed.length
        ? { ok: false, text: `Inaktiválva: ${b.results.length - failed.length}; nem sikerült: ${failed.map((r) => `${r.name} (${r.error ?? "hiba"})`).join("; ")}.` }
        : { ok: true, text: `Inaktiválva: ${b.results.length} másodpéldány.` },
    );
    setCopies(null);
    router.refresh();
  }
  return (
    <div className="card no-print" data-testid="feed-copies">
      <h2>Alapadat-másodpéldányok</h2>
      <p className="hint">
        Egy korábbi hiba miatt az átnevezett alaptakarmányok (például Artemia) egy újraindítás után régi nevükön újra megjelenhettek. A keresés megmutatja
        ezeket és a rajtuk lévő adatot; az inaktiválás után nem jelennek meg a lapokon, az adatuk megmarad.
      </p>
      <p className="toolbar">
        <button className="btn btn-soft" type="button" disabled={busy} onClick={() => void plan()}>
          Másodpéldányok keresése (próba)
        </button>
        {copies && copies.length > 0 && (
          <button className="btn" type="button" disabled={busy} onClick={() => void run()}>
            {copies.length} másodpéldány inaktiválása
          </button>
        )}
      </p>
      {copies && copies.length === 0 && <p className="hint" data-testid="feed-copies-none">Nincs másodpéldány.</p>}
      {copies && copies.length > 0 && (
        <table className="log-table" data-testid="feed-copies-list">
          <thead>
            <tr>
              <th>Másodpéldány</th>
              <th>Az eredeti, átnevezve</th>
              <th>Rajta</th>
            </tr>
          </thead>
          <tbody>
            {copies.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.originalName}</td>
                <td>{usesText(c.uses)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {msg && (
        <p className={msg.ok ? "hint" : "err"} role="status">
          {msg.text}
        </p>
      )}
    </div>
  );
}
