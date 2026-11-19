"use client";

// A feeding day put back as it stood just before one operation (src/lib/day-restore.ts; Lili 2026-10-28 23:51 UTC).
// Three steps, each its own click: the day's operations, the dry run before one of them (what would change, nothing is
// written), and the run with a reason and a confirmation. Feeding admins only; the server checks it again.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDateTime, formatDay } from "@/lib/time";
import { useReasonsOn } from "./ReasonSwitch";
import { useTr } from "./LangProvider";

type Op = { op: string; at: string; user: string; count: number; kinds: Record<string, number> };
type Plan = {
  since: string;
  /** every operation turned back, the chosen one first */
  ops: { op: string; at: string; user: string }[];
  count: Record<string, number>;
  changes: { type: string; id: string; animalId: string | null; to: string }[];
  blocked: { type: string; id: string; action: string; at: string }[];
  feedIds: { now: string[]; before: string[] } | null;
};

function requestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

// translated where shown (tr(KIND[k]))
const KIND: Record<string, string> = {
  "FeedingSelection INVALIDATED": "kijelölés le",
  "FeedingSelection VALID": "kijelölés vissza",
  "FeedingItem INVALIDATED": "tétel le",
  "FeedingItem VALID": "tétel vissza",
  "EatingStatus INVALIDATED": "evési állapot le",
  "EatingStatus VALID": "evési állapot vissza",
};

const time = (iso: string) => formatDateTime(iso);

export function DayRestore({ day }: { day: string }) {
  const router = useRouter();
  const [ops, setOps] = useState<Op[] | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // the reason only while the app asks for reasons (Balázs 2026-10-20, task caparium-indoklas-ki): off, no field
  const reasonsOn = useReasonsOn();
  const tr = useTr();

  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/feeding-day-restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: requestId(), day, ...body }),
      });
      const b = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
      if (!res.ok) {
        setMsg({ ok: false, text: b.error?.message ?? tr("Nem sikerült.") });
        return null;
      }
      return b;
    } catch {
      setMsg({ ok: false, text: tr("Nincs kapcsolat a szerverrel.") });
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="card no-print" data-testid="day-restore">
      <summary>
        <h2 style={{ display: "inline" }}>{tr("Nap visszaállítása")}</h2>
      </summary>
      <p className="hint">
        {tr("A nap úgy áll vissza, ahogy egy kiválasztott művelet előtt állt: ami azóta került fel, lekerül, ami azóta lekerült, visszakerül, a nap takarmányai is. Előbb próba (nem ír semmit), utána külön megerősítéssel a visszaállítás. Törlés nincs, minden lépés naplózva.")}
      </p>
      <button className="btn btn-soft" type="button" disabled={busy} onClick={() => void call({ mode: "ops" }).then((b) => b && setOps((b as { ops: Op[] }).ops))}>
        {tr("A nap műveletei")}
      </button>
      {ops && (
        <div className="table-scroll">
        <table className="log-table" data-testid="day-restore-ops">
          <tbody>
            {ops.map((o) => (
              <tr key={o.op} className={o.op === op ? "active-row" : undefined}>
                <td>{time(o.at)}</td>
                <td>{o.user}</td>
                <td className="hint">{Object.entries(o.kinds).map(([k, n]) => `${k} ${n}`).join(", ")}</td>
                <td className="keep">
                  <button
                    className="btn btn-row"
                    type="button"
                    disabled={busy}
                    aria-label={tr("Próba: {time} előtti állapot", { time: time(o.at) })}
                    onClick={() =>
                      void call({ mode: "plan", op: o.op }).then((b) => {
                        if (!b) return;
                        setOp(o.op);
                        setPlan((b as { plan: Plan }).plan);
                      })
                    }
                  >
                    {tr("Előtte állapot (próba)")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {plan && op && (
        <div data-testid="day-restore-plan">
          <p>{tr("Visszaállítás a(z) {time} előtti állapotra. Ezek a műveletek fordulnak vissza:", { time: time(plan.since) })}</p>
          <ul data-testid="day-restore-turned-back">
            {plan.ops.map((o) => (
              <li key={o.op}>
                {time(o.at)}, {o.user}
              </li>
            ))}
          </ul>
          <p>{tr("Ami változik:")}</p>
          <ul>
            {Object.entries(plan.count).map(([k, n]) => (
              <li key={k}>
                {KIND[k] ? tr(KIND[k]) : k}: {n}
              </li>
            ))}
            {plan.feedIds && <li>{tr("a nap takarmányai: {n} takarmány (most {now})", { n: plan.feedIds.before.length, now: plan.feedIds.now.length })}</li>}
            {!Object.keys(plan.count).length && !plan.feedIds && <li>{tr("nincs mit visszaállítani")}</li>}
          </ul>
          {plan.blocked.length > 0 ? (
            <p className="err">
              {tr("{n} változás a napló alapján nem fordítható vissza (tartalmi módosítás azóta), ezért a visszaállítás nem futtatható.", { n: plan.blocked.length })}
            </p>
          ) : (
            <div className="toolbar">
              {reasonsOn && <input className="input" aria-label={tr("A visszaállítás oka")} placeholder={tr("A visszaállítás oka")} value={reason} onChange={(e) => setReason(e.target.value)} />}
              <button
                className="btn"
                type="button"
                disabled={busy || (reasonsOn && reason.trim().length < 3) || (!Object.keys(plan.count).length && !plan.feedIds)}
                onClick={() => {
                  const others = plan.ops.slice(1);
                  const also = others.length ? " " + tr("Ez a kiválasztotton kívül további {n} műveletet is visszafordít: {list}.", { n: others.length, list: others.map((o) => `${time(o.at)} ${o.user}`).join(", ") }) : "";
                  if (!window.confirm(tr("Visszaállítod a(z) {day} napot a(z) {time} előtti állapotra?{also} A fenti változások mind megtörténnek.", { day: formatDay(day), time: time(plan.since), also }))) return;
                  void call({ mode: "run", op, ...(reasonsOn ? { reason: reason.trim() } : {}) }).then((b) => {
                    if (!b) return;
                    setMsg({ ok: true, text: tr("A nap visszaállítva.") });
                    setPlan(null);
                    setOps(null);
                    router.refresh();
                  });
                }}
              >
                {tr("Visszaállítás")}
              </button>
            </div>
          )}
        </div>
      )}
      {msg && (
        <span className={msg.ok ? "hint" : "err"} role="status">
          {msg.text}
        </span>
      )}
    </details>
  );
}
