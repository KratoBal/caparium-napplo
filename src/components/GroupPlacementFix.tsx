"use client";

// The group placement moved to the arrival day (src/lib/group-placement-fix.ts; Lili 2026-11-10). Two steps, each its own click: the
// dry run (the animals, their group, the day they were put into it now and the arrival day; the ones left out with the reason; how many
// closed days get their fasting computed again), then the run with a confirmation. Feeding admins only; the server checks it again.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDay } from "@/lib/time";
import { useReasonsOn } from "./ReasonSwitch";

type Plan = {
  changes: { animalId: string; animalName: string; groupName: string; fromDay: string; toDay: string }[];
  skipped: { animalId: string; animalName: string; reason: string }[];
  closedDays: { from: string | null; count: number };
};
type Changed = { days: string[]; fastingAdded: number; fastingRemoved: number };

function requestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function GroupPlacementFix() {
  const router = useRouter();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const reasonsOn = useReasonsOn();

  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/group-placement-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: requestId(), ...body }),
      });
      const b = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
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

  async function run() {
    if (!plan) return;
    if (!window.confirm(`${plan.changes.length} állat csoportba helyezése az érkezése napjára kerül. Végrehajtod?`)) return;
    const b = await call({ mode: "run", ...(reason.trim() ? { reason: reason.trim() } : {}) });
    if (!b) return;
    const fixed = (b as { fixed?: Plan }).fixed;
    const changed = (b as { closedDaysChanged?: Changed }).closedDaysChanged;
    setPlan(null);
    setMsg({
      ok: true,
      text:
        `Kész: ${fixed?.changes.length ?? 0} állat csoportba helyezése az érkezése napjára került. ` +
        (changed && changed.days.length
          ? `${changed.days.length} lezárt napon változott a koplalás (${changed.fastingAdded} új, ${changed.fastingRemoved} megszűnt koplalónap): ${changed.days.map(formatDay).join(", ")}.`
          : "A lezárt napok koplalása nem változott."),
    });
    router.refresh();
  }

  return (
    <details className="card no-print" data-testid="group-placement-fix">
      <summary>
        <h2 style={{ display: "inline" }}>Csoportba helyezés javítása</h2>
      </summary>
      <p className="hint">
        Azok az állatok, amelyek egyedül érkeztek és később kerültek a mostani csoportjukba, az érkezésük napjától lesznek a csoport tagjai, így a régi
        takarmánylapokon is a csoportban szerepelnek. Aki több csoportban is volt, kimarad és a listán megjelenik. Előbb próba (nem ír semmit), utána külön
        megerősítéssel a végrehajtás. Törlés nincs, minden lépés naplózva.
      </p>
      <button className="btn btn-soft" type="button" disabled={busy} onClick={() => void call({ mode: "plan" }).then((b) => b && setPlan((b as { plan: Plan }).plan))}>
        Próba
      </button>
      {plan && (
        <div data-testid="group-placement-plan">
          {plan.changes.length === 0 ? (
            <p>Nincs javítandó csoportba helyezés.</p>
          ) : (
            <div className="table-scroll">
              <table className="log-table">
                <thead>
                  <tr><th>Állat</th><th>Csoport</th><th>Most csoportban</th><th>Javítva</th></tr>
                </thead>
                <tbody>
                  {plan.changes.map((c) => (
                    <tr key={c.animalId}>
                      <td>{c.animalName}</td>
                      <td>{c.groupName}</td>
                      <td>{formatDay(c.fromDay)}</td>
                      <td>{formatDay(c.toDay)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {plan.skipped.length > 0 && (
            <>
              <p>Kimarad (ezekről te döntesz, a javítás nem nyúl hozzájuk):</p>
              <ul data-testid="group-placement-skipped">
                {plan.skipped.map((s) => (
                  <li key={s.animalId}>
                    {s.animalName}: {s.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
          {plan.changes.length > 0 && (
            <>
              <p data-testid="group-placement-closed">
                {plan.closedDays.count > 0 && plan.closedDays.from
                  ? `${plan.closedDays.count} lezárt nap (${formatDay(plan.closedDays.from)}-tól) koplalását a végrehajtás újraszámolja: ahol egy állat ezeken a napokon a csoporttagság miatt máshogy számít, ott koplalónap kerülhet fel vagy le. A végrehajtás után a pontos lista megjelenik.`
                  : "Lezárt nap nem érintett."}
              </p>
              {reasonsOn && (
                <label className="field">
                  Indoklás
                  <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
                </label>
              )}
              <button className="btn" type="button" disabled={busy || (reasonsOn && reason.trim().length < 3)} onClick={() => void run()}>
                Végrehajtás
              </button>
            </>
          )}
        </div>
      )}
      {msg && (
        <p className={msg.ok ? "hint" : "err"} role={msg.ok ? "status" : "alert"}>
          {msg.text}
        </p>
      )}
    </details>
  );
}
