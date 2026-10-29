"use client";

// The chemical calculator under "Vegyszeradagolás" (caparium-hibak-3, Balázs 2026-10-20 08:41 and 08:44 UTC): the
// Acropora OS partner portal's calculator for pure chemicals, its arithmetic taken over unchanged
// (src/lib/reef-chemistry.ts). The pool picked on top gives the volume (Beállítások -> Medencék -> Űrtartalom) and,
// as a suggestion, the pool's latest measured value and its reference band; every field can be overwritten.
// Nothing is saved: it is a calculation, the dosing itself is recorded in the form above.
import { useMemo, useState } from "react";
import { dailyPlan, SYSTEM_LABEL, type SystemType } from "@/lib/daily-limit";
import { alkalinityElevation, calciumElevation, magnesiumElevation, type MagnesiumSalt, type ReefChemistryElevationResult } from "@/lib/reef-chemistry";

type Code = "CA" | "MG" | "KH";
export type CalcPool = {
  id: string;
  name: string;
  volumeLiters: string | null;
  /** coral or fish (package item 5b): the daily raise limit follows it; null = not set in Beállítások */
  systemType: SystemType | null;
  latest: Partial<Record<Code, { value: string; day: string }>>;
  band: Partial<Record<Code, { min: string | null; max: string | null; unit: string }>>;
};

const hu = (v: string) => v.replace(".", ",");
const toNumber = (v: string) => Number(v.trim().replace(",", "."));
const resultFormatter = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 1 });

function Card({
  code,
  title,
  unit,
  pool,
  volume,
  system,
  compute,
  children,
}: {
  code: Code;
  title: string;
  unit: string;
  pool: CalcPool | undefined;
  volume: string;
  system: SystemType | "";
  compute: (v: { volumeLiters: number; current: number; target: number }) => ReefChemistryElevationResult;
  children?: React.ReactNode;
}) {
  const latest = pool?.latest[code];
  const band = pool?.band[code];
  const [current, setCurrent] = useState(latest ? hu(latest.value) : "");
  const [target, setTarget] = useState("");
  const result = useMemo(() => {
    const [v, c, t] = [toNumber(volume), toNumber(current), toNumber(target)];
    if (!volume.trim() || !current.trim() || !target.trim() || ![v, c, t].every(Number.isFinite) || v <= 0) return null;
    return compute({ volumeLiters: v, current: c, target: t });
  }, [compute, current, target, volume]);
  // Lili 2026-10-29 (package item 5b, Balázs's limits): the dose split into days, not all of it at once
  const plan = result?.kind === "dose" && system ? dailyPlan(code, system, toNumber(current), toNumber(target), result.grams) : null;
  const raiseFmt = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 2 });
  return (
    <div className="card" data-testid={`chem-${code}`} style={{ margin: 0 }}>
      <h3>{title}</h3>
      {children}
      <div className="toolbar">
        <label className="field">
          Jelenlegi érték ({unit})
          <input className="input small" inputMode="decimal" aria-label={`${title}: jelenlegi érték`} value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label className="field">
          Célérték ({unit})
          <input className="input small" inputMode="decimal" aria-label={`${title}: célérték`} value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
      </div>
      {latest && (
        <p className="hint">
          Legutóbbi mérés: {hu(latest.value)} {unit} ({latest.day}){" "}
          <button className="btn btn-soft" type="button" onClick={() => setCurrent(hu(latest.value))}>
            Átvétel
          </button>
        </p>
      )}
      {band && (band.min !== null || band.max !== null) && (
        <p className="hint">
          A medence célsávja: {band.min !== null ? hu(band.min) : "–"} … {band.max !== null ? hu(band.max) : "–"} {band.unit}
        </p>
      )}
      {/* Lili 2026-10-29 (package item 5a): the result wraps inside its card instead of running out of it */}
      <div className="pill pill-wrap" data-testid={`chem-${code}-result`} role="status">
        {result === null
          ? "Szükséges mennyiség: töltsd ki a mezőket a számításhoz."
          : result.kind === "no-dosing-needed"
            ? "A célérték nem magasabb a jelenlegi értéknél, nincs szükség adagolásra."
            : `Szükséges mennyiség: ${resultFormatter.format(result.grams)} g`}
      </div>
      {result?.kind === "dose" && (
        <p className="hint" data-testid={`chem-${code}-daily`} role="status">
          {plan
            ? plan.days === 1
              ? `Egy napon belül marad (${SYSTEM_LABEL[system as SystemType]} rendszer: legfeljebb ${raiseFmt.format(plan.max)} ${unit} naponta).`
              : `Ajánlott: ${plan.days} nap alatt, naponta ${resultFormatter.format(plan.perDayGrams)} g (+${raiseFmt.format(plan.perDayRaise)} ${unit}/nap; ${SYSTEM_LABEL[system as SystemType]} rendszer: legfeljebb ${raiseFmt.format(plan.max)} ${unit} naponta).`
            : "A napi ajánláshoz válaszd ki a rendszert (korallos vagy halas) fent, vagy add meg a medencénél a Beállításokban."}
        </p>
      )}
    </div>
  );
}

export function ChemistryCalculator({ pools }: { pools: CalcPool[] }) {
  const [poolId, setPoolId] = useState("");
  const pool = pools.find((p) => p.id === poolId);
  const [volume, setVolume] = useState("");
  const [salt, setSalt] = useState<MagnesiumSalt>("MGCL2_HEXAHYDRATE");
  // the pool's system as a suggestion, as the volume: it can be set here for a pool without one, or with none picked
  const [system, setSystem] = useState<SystemType | "">("");
  const pick = (id: string) => {
    setPoolId(id);
    const p = pools.find((x) => x.id === id);
    setVolume(p?.volumeLiters ? hu(p.volumeLiters) : "");
    setSystem(p?.systemType ?? "");
  };
  return (
    <div data-testid="chemistry-calculator">
      <div className="toolbar">
        <label className="field">
          Medence
          <select className="input" aria-label="Medence" value={poolId} onChange={(e) => pick(e.target.value)}>
            <option value="">Nincs kiválasztva</option>
            {pools.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Térfogat (liter)
          <input className="input small" inputMode="decimal" aria-label="Térfogat (liter)" value={volume} onChange={(e) => setVolume(e.target.value)} />
        </label>
        <label className="field">
          Rendszer
          <select className="input" aria-label="Rendszer" value={system} onChange={(e) => setSystem(e.target.value as SystemType | "")}>
            <option value="">nincs megadva</option>
            <option value="CORAL">korallos</option>
            <option value="FISH">halas</option>
          </select>
        </label>
      </div>
      {pool && !pool.volumeLiters && (
        <p className="hint" data-testid="no-volume">
          Ennek a medencének még nincs megadva az űrtartalma (Beállítások → Medencék); add meg itt kézzel.
        </p>
      )}
      {/* keyed by the pool: a new pool brings its own suggestions instead of keeping the previous pool's values */}
      <div className="chem-grid" key={poolId} style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        <Card code="CA" title="Kalcium emelése" unit="mg/l" pool={pool} volume={volume} system={system} compute={({ volumeLiters, current, target }) => calciumElevation({ volumeLiters, currentMgL: current, targetMgL: target })}>
          <p className="hint">Kalcium-klorid-dihidrát (CaCl₂·2H₂O)</p>
        </Card>
        <Card
          code="MG"
          title="Magnézium emelése"
          unit="mg/l"
          pool={pool}
          volume={volume}
          system={system}
          compute={({ volumeLiters, current, target }) => magnesiumElevation({ volumeLiters, currentMgL: current, targetMgL: target, salt })}
        >
          <label className="field">
            Készítmény
            <select className="input" aria-label="Magnézium-só" value={salt} onChange={(e) => setSalt(e.target.value as MagnesiumSalt)}>
              <option value="MGCL2_HEXAHYDRATE">Magnézium-klorid-hexahidrát</option>
              <option value="MGSO4_HEPTAHYDRATE">Magnézium-szulfát-heptahidrát</option>
            </select>
          </label>
        </Card>
        <Card code="KH" title="KH emelése" unit="dKH" pool={pool} volume={volume} system={system} compute={({ volumeLiters, current, target }) => alkalinityElevation({ volumeLiters, currentDkh: current, targetDkh: target })}>
          <p className="hint">Nátrium-hidrogén-karbonát (NaHCO₃)</p>
        </Card>
      </div>
    </div>
  );
}
