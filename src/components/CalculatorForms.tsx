"use client";

// KALK-01, KALK-02, JAV-06: the calculator with live results (the same arithmetic as the server), the
// "Mentés referenciaként" button with its animal, and the body weight form (shown only while the body
// weight log is switched on, src/lib/master.ts body_weight_log_visible). The server decides every permission.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { calculate, FR_STEP } from "@/lib/calc-math";

function requestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

const num = (v: number) => String(v).replace(".", ",");

function useSend() {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(url: string, body: Record<string, unknown>, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: requestId(), ...body }) });
      const b = (await res.json().catch(() => ({}))) as { error?: { message?: string; issues?: { message: string }[] } };
      if (!res.ok) {
        setMsg({ ok: false, text: b.error?.issues?.[0]?.message ?? b.error?.message ?? "Nem sikerült." });
        return false;
      }
      setMsg({ ok: true, text: okText });
      router.refresh();
      return true;
    } catch {
      setMsg({ ok: false, text: "Nincs kapcsolat a szerverrel." });
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { msg, busy, run };
}

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <span className={msg.ok ? "hint" : "err"} role="status">
      {msg.text}
    </span>
  );
}

const FR_OPTIONS = Array.from({ length: Math.round((8 - 1) / FR_STEP) + 1 }, (_, i) => 1 + i * FR_STEP);

export type CalculatorAnimal = { id: string; name: string; poolName: string | null };

/**
 * A general calculator (caparium-hibak-1 round 2, Balázs 2026-10-20 08:07 UTC): no animal on top, and the
 * result is saved only as an animal's reference, the one picked next to the button. A calculation alone is
 * not saved ("Számítás mentése" removed).
 */
export function Calculator({
  animals,
  references,
  initialAnimalId = "",
  defaultBwKg = null,
}: {
  animals: CalculatorAnimal[];
  /** animal id -> today's reference, grams per feeding */
  references: Record<string, number>;
  initialAnimalId?: string;
  defaultBwKg?: string | null;
}) {
  const [bw, setBw] = useState(defaultBwKg ?? "");
  const [fr, setFr] = useState(2);
  const [n, setN] = useState(3);
  const [animalId, setAnimalId] = useState(initialAnimalId);
  const { msg, busy, run } = useSend();
  const bwNum = Number(bw.replace(",", "."));
  let result: ReturnType<typeof calculate> | null = null;
  try {
    result = bw.trim() ? calculate(bwNum, fr, n) : null;
  } catch {
    result = null;
  }
  const save = () =>
    run("/api/calculator", { animalId, bwKg: bw.replace(",", "."), frWeekPct: fr, nWeek: n, saveAsReference: true }, "Mentve referenciaként.");
  const pools = [...new Set(animals.map((a) => a.poolName ?? "Medence nélkül"))];
  const current = animalId ? references[animalId] : undefined;
  return (
    <div data-testid="calculator">
      <div className="toolbar">
        <label className="field">
          BW (kg)
          <input className="input" inputMode="decimal" style={{ width: 120 }} value={bw} onChange={(e) => setBw(e.target.value)} aria-label="Testtömeg (kg)" />
        </label>
        <label className="field">
          Heti FR (%)
          <select className="input" value={fr} onChange={(e) => setFr(Number(e.target.value))} aria-label="Heti FR (%)">
            {FR_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {num(v)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Heti etetésszám (N)
          <select className="input" value={n} onChange={(e) => setN(Number(e.target.value))} aria-label="Heti etetésszám (N)">
            {[1, 2, 3, 4, 5, 6, 7].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <table className="log-table" data-testid="calc-result">
        <tbody>
          <tr><th>FR napi</th><td>{result ? `${num(result.frDayPct)} %` : "–"}</td></tr>
          <tr><th>F etetésenként</th><td>{result ? `${num(result.fKg)} kg = ${num(result.fG)} g` : "–"}</td></tr>
          <tr><th>Fw hetente</th><td>{result ? `${num(result.fwG)} g` : "–"}</td></tr>
        </tbody>
      </table>
      <div className="toolbar">
        <label className="field">
          Állat
          <select className="input" value={animalId} onChange={(e) => setAnimalId(e.target.value)} aria-label="Állat">
            <option value="">Válassz állatot</option>
            {pools.map((pool) => (
              <optgroup key={pool} label={pool}>
                {animals
                  .filter((a) => (a.poolName ?? "Medence nélkül") === pool)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <button className="btn" type="button" disabled={busy || !result || !animalId} onClick={() => void save()}>
          Mentés referenciaként
        </button>
        <Msg msg={msg} />
      </div>
      {animalId && (
        <p className="pill" data-testid="current-reference">
          Mai referencia: {current !== undefined ? `${num(current)} g etetésenként` : "nincs"}
        </p>
      )}
    </div>
  );
}

export function BodyWeightForm({ animalId }: { animalId: string }) {
  const [w, setW] = useState("");
  const { msg, busy, run } = useSend();
  return (
    <div className="toolbar" data-testid="body-weight-form">
      <label className="field">
        Mért testtömeg (kg)
        <input className="input" inputMode="decimal" style={{ width: 120 }} value={w} onChange={(e) => setW(e.target.value)} aria-label="Mért testtömeg (kg)" />
      </label>
      <button
        className="btn btn-soft"
        type="button"
        disabled={busy}
        onClick={() => void run("/api/body-weights", { animalId, weightKg: w.replace(",", "."), clientTimestamp: new Date().toISOString() }, "Testtömeg mentve.").then((ok) => ok && setW(""))}
      >
        Testtömeg mentése
      </button>
      <Msg msg={msg} />
    </div>
  );
}
