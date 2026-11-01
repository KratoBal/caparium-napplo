"use client";

// The weekly rows saved before the dilution became a factor (src/lib/dilution-recalc.ts; acrobot 39888): a dry run first
// (how many, by parameter, from which day to which), then the recalculation on its own confirmation. Water admins only;
// the server checks it again.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDay } from "@/lib/time";

type Plan = {
  count: number;
  notValid: number;
  parameters: { parameter: string; count: number; firstDay: string; lastDay: string }[];
  rows: { id: string; day: string; parameter: string; value: string; dilution: number; result: string }[];
};

function requestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

const hu = (v: string) => v.replace(".", ",");

export function DilutionRecalc() {
  const router = useRouter();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/dilution-recalc", {
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

  return (
    <div data-testid="dilution-recalc">
      <p className="hint">
        A hígítás 2026.11.02. óta szorzó: a mentett érték a leolvasás és a hígítás szorzata. Az ezelőtt mentett heti nitrát- és foszfátsorokban a leolvasás áll, a hígítás csak megjegyzés. Előbb próba (nem ír semmit), utána külön megerősítéssel az átszámolás: az érték a leolvasás × hígítás lesz, a leolvasás a „Hígítás előtti érték” mezőbe kerül. Minden sor naplózva.
      </p>
      <button className="btn btn-soft" type="button" disabled={busy} onClick={() => void call({ mode: "plan" }).then((b) => b && setPlan((b as { plan: Plan }).plan))}>
        Régi hígított sorok (próba)
      </button>
      {plan && (
        <div data-testid="dilution-recalc-plan">
          <p data-testid="dilution-recalc-count">
            {plan.count === 0 ? "Nincs átszámolandó sor." : `${plan.count} átszámolandó sor.`}
            {plan.notValid > 0 ? ` További ${plan.notValid} nem érvényes sor, ezekhez nem nyúl.` : ""}
          </p>
          {plan.parameters.length > 0 && (
            <ul>
              {plan.parameters.map((p) => (
                <li key={p.parameter}>
                  {p.parameter}: {p.count} sor, {formatDay(p.firstDay)} – {formatDay(p.lastDay)}
                </li>
              ))}
            </ul>
          )}
          {plan.rows.length > 0 && (
            <table className="log-table">
              <tbody>
                {plan.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDay(r.day)}</td>
                    <td>{r.parameter}</td>
                    <td>
                      {hu(r.value)} × {r.dilution} = {hu(r.result)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {plan.count > 0 && (
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(`${plan.count} régi heti sor értéke a leolvasás × hígítás lesz. Átszámolod?`)) return;
                void call({ mode: "run", expected: plan.count }).then((b) => {
                  if (!b) return;
                  setPlan(null);
                  setMsg({ ok: true, text: `${(b as { recalculated?: number }).recalculated ?? 0} sor átszámolva.` });
                  router.refresh();
                });
              }}
            >
              Átszámolás
            </button>
          )}
        </div>
      )}
      {msg && (
        <p role="status" className={msg.ok ? "hint" : "err"}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
