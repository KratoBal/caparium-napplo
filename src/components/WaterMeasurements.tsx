"use client";

// Lili 2026-11-02 09:36-09:40 UTC (acrobot 39956, 39960): the water measurements on one card, as the pools, the feeds and the
// animals: a row each, and opened, everything that belongs to it (src/lib/measurement-types.ts). A unit change's successor
// stands right under its predecessor, joined to it.
import { useState } from "react";
import type { MeasurementTypeView } from "@/lib/measurement-types";
import { formatDay } from "@/lib/time";
import { OrderList } from "./AnimalOrder";
import { ConversionRow, Msg, ReferenceRow, useSave } from "./SettingsForms";

type Unit = { id: string; symbol: string };

const FREQ: Record<string, string> = { DAILY: "napi", WEEKLY: "heti" };
const day = (d: string) => formatDay(d);

function period(t: MeasurementTypeView): string {
  if (!t.from) return "nincs táblában";
  return t.to ? `${day(t.from)} – ${day(t.to)}` : `${day(t.from)} –`;
}

function tablesText(t: MeasurementTypeView): string {
  const open = t.tables.filter((x) => x.to === null || !t.to || x.to === t.to);
  return (open.length ? open : t.tables).map((x) => `${x.groupName}: ${x.pools ? x.pools.join(", ") : "minden medence"}`).join("; ") || "–";
}

export function WaterMeasurements({ rows, units, today, reasons }: { rows: MeasurementTypeView[]; units: Unit[]; today: string; reasons: boolean }) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return (
    <>
      <div className="table-scroll">
        <table className="log-table" data-testid="water-measurements">
          <thead>
            <tr><th>Név</th><th>Mértékegység</th><th>Napi vagy heti</th><th>Táblák és medencék</th><th>Időszak</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <TypeRow key={t.id} t={t} units={units} today={today} reasons={reasons} predecessor={t.predecessorId ? byId.get(t.predecessorId) : undefined} />
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 1 && (
        <details className="no-print" data-testid="water-order-box">
          <summary>Sorrend</summary>
          <p className="hint">
            Húzd a sort a helyére (érintőképernyőn a Fel és Le gombokkal), majd mentsd. A napi és a heti tábla oszlopai, a vízjelentés
            és az Excel ezt a sorrendet követik; a ZIMS-fájl sorrendje nem változik.
          </p>
          <OrderList
            key={rows.map((r) => r.id).join()}
            rows={rows.map((r) => ({ id: r.id, name: `${r.name} (${r.unit.symbol})`, detail: r.inForce ? "" : "lezárva" }))}
            saveUrl="/api/admin/parameter-order"
            testId="water-order"
            saveTestId="save-water-order"
          />
        </details>
      )}
    </>
  );
}

function TypeRow({ t, units, today, reasons, predecessor }: { t: MeasurementTypeView; units: Unit[]; today: string; reasons: boolean; predecessor?: MeasurementTypeView }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr data-testid={`wm-${t.name}-${t.unit.symbol}`} className={t.inForce ? undefined : "invalid"}>
        <td className="keep">
          {predecessor && <span className="hint" title={`egységváltás: ${predecessor.unit.symbol} → ${t.unit.symbol}`}>↳ </span>}
          {t.name}
        </td>
        <td>{t.unit.symbol}</td>
        <td>{t.frequencies.map((f) => FREQ[f] ?? f).join(", ") || "–"}</td>
        <td className="hint">{tablesText(t)}</td>
        <td>
          {period(t)}
          {t.successorId && <span className="hint"> (egységváltás, folytatása alatta)</span>}
          {predecessor && <span className="hint"> (az előző, {predecessor.unit.symbol} folytatása)</span>}
        </td>
        <td className="keep">
          <button className="btn btn-row" type="button" aria-expanded={open} aria-label={`${t.name} (${t.unit.symbol}): szerkesztés`} onClick={() => setOpen(!open)}>
            {open ? "Bezárás" : "Szerkesztés"}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="edit-row" data-testid={`wm-edit-${t.name}-${t.unit.symbol}`}>
          <td colSpan={6}>
            <TypeEditor t={t} units={units} today={today} reasons={reasons} />
          </td>
        </tr>
      )}
    </>
  );
}

function TypeEditor({ t, units, today, reasons }: { t: MeasurementTypeView; units: Unit[]; today: string; reasons: boolean }) {
  return (
    <div className="wm-editor">
      <NameForm t={t} today={today} />
      <LimitsForm t={t} />
      <h3>Referencia</h3>
      <p className="hint">A közös érték minden saját érték nélküli medencére érvényes; a medence saját értéke felülírja. A „változás” mostantól érvényes, a „helyesbítés” a múltra is hat.</p>
      <div className="table-scroll">
        <table className="log-table">
          <thead>
            <tr><th>Medence</th><th>Mértékegység</th><th>Minimum</th><th>Maximum</th><th>Fajta</th>{reasons && <th>Indoklás</th>}<th></th></tr>
          </thead>
          <tbody>
            <ReferenceRow parameterId={t.id} name={t.name} unit={t.unit.symbol} min={t.common?.min ?? null} max={t.common?.max ?? null} />
            {t.pools.map((p) => (
              <ReferenceRow
                key={p.poolId}
                parameterId={t.id}
                name={t.name}
                unit={t.unit.symbol}
                min={p.range?.min ?? null}
                max={p.range?.max ?? null}
                pool={{ id: p.poolId, name: p.name, inherited: !p.own }}
              />
            ))}
          </tbody>
        </table>
      </div>
      <h3>Mérőeszköz-átváltás</h3>
      <p className="hint">Ha a mérőeszköz leolvasást mutat (például Hanna HI755 a KH-hoz: × 0,056), a táblába a leolvasás kerül, és a mező átváltja.</p>
      <div className="table-scroll">
        <table className="log-table">
          <thead>
            <tr><th>Paraméter</th><th>Most érvényes</th><th>Mérőeszköz</th><th>Szorzó</th><th>Tizedes</th><th>Mettől</th><th></th></tr>
          </thead>
          <tbody>
            <ConversionRow parameterId={t.id} name={t.name} unit={t.unit.symbol} current={t.conversion} today={today} />
          </tbody>
        </table>
      </div>
      {t.dilution && (
        <>
          <h3>Hígítás</h3>
          <p className="hint" data-testid="wm-dilution">
            Heti mérésnél hígítással mérhető: a mentett érték a leolvasás és a hígítás szorzata.
          </p>
        </>
      )}
      {t.inForce && <CloseForm t={t} today={today} />}
      {t.inForce && !t.successorId && <UnitChangeForm t={t} units={units} today={today} />}
    </div>
  );
}

function NameForm({ t, today }: { t: MeasurementTypeView; today: string }) {
  const [name, setName] = useState(t.name);
  const [from, setFrom] = useState(today);
  const { msg, busy, save } = useSave();
  return (
    <div className="toolbar toolbar-end" data-testid="wm-name">
      <label className="field">
        Név
        <input className="input" aria-label={`${t.name} új neve`} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        Mettől
        <input className="input" type="date" aria-label={`${t.name} új nevének kezdete`} value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <button
        className="btn"
        type="button"
        disabled={busy || name.trim() === t.name || name.trim().length < 2 || !from}
        onClick={() => void save("/api/admin/measurement-types/rename", "POST", { parameterId: t.id, name: name.trim(), from }, "Átnevezve; a korábbi napokon a régi név marad.")}
      >
        Név mentése
      </button>
      <Msg msg={msg} />
    </div>
  );
}

function LimitsForm({ t }: { t: MeasurementTypeView }) {
  const start = { decimals: String(t.decimals), min: (t.plausibleMin ?? "").replace(".", ","), max: (t.plausibleMax ?? "").replace(".", ",") };
  const [f, setF] = useState(start);
  const { msg, busy, save } = useSave();
  const changed = f.decimals !== start.decimals || f.min !== start.min || f.max !== start.max;
  return (
    <div className="toolbar toolbar-end" data-testid="wm-limits">
      <label className="field">
        Tizedesjegyek
        <select className="input" aria-label={`${t.name} tizedesjegyei`} value={f.decimals} onChange={(e) => setF({ ...f, decimals: e.target.value })}>
          {[0, 1, 2, 3, 4].map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </label>
      <label className="field">
        Hihető tartomány alja
        <input className="input small" inputMode="decimal" aria-label={`${t.name} hihető tartomány alja`} value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} />
      </label>
      <label className="field">
        teteje
        <input className="input small" inputMode="decimal" aria-label={`${t.name} hihető tartomány teteje`} value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} />
      </label>
      <button
        className="btn"
        type="button"
        disabled={busy || !changed}
        onClick={() => void save("/api/admin/measurement-types/limits", "POST", { parameterId: t.id, decimals: Number(f.decimals), plausibleMin: f.min || null, plausibleMax: f.max || null })}
      >
        Mentés
      </button>
      <Msg msg={msg} />
    </div>
  );
}

function CloseForm({ t, today }: { t: MeasurementTypeView; today: string }) {
  const [to, setTo] = useState(today);
  const { msg, busy, save } = useSave();
  return (
    <>
      <h3>Lezárás</h3>
      <p className="hint">Az utolsó nap után a mérés oszlopa nem jelenik meg a táblákban; a korábbi értékek megmaradnak, az exportokban a saját napjukon látszanak. Törlés nincs.</p>
      <div className="toolbar toolbar-end" data-testid="wm-close">
        <label className="field">
          Meddig (utolsó nap)
          <input className="input" type="date" aria-label={`${t.name} utolsó napja`} value={to} min={t.from ?? undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button
          className="btn btn-soft"
          type="button"
          disabled={busy || !to}
          onClick={() => {
            if (!window.confirm(`Lezárod: ${t.name}, utolsó nap ${day(to)}? Utána nem kerül a táblákba; a korábbi értékek megmaradnak.`)) return;
            void save("/api/admin/measurement-types/close", "POST", { parameterId: t.id, to }, "Lezárva.");
          }}
        >
          Lezárás
        </button>
        <Msg msg={msg} />
      </div>
    </>
  );
}

function UnitChangeForm({ t, units, today }: { t: MeasurementTypeView; units: Unit[]; today: string }) {
  const own = t.pools.filter((p) => p.own);
  const empty = { from: today, unitId: "", zimsUnit: "", decimals: String(t.decimals), pMin: "", pMax: "", rMin: "", rMax: "", pools: Object.fromEntries(own.map((p) => [p.poolId, { min: "", max: "" }])) as Record<string, { min: string; max: string }> };
  const [f, setF] = useState(empty);
  // the state is made at the first render; a pool that gets its own range later (the reference row above, saved and refreshed)
  // has no entry yet: an empty one, not a crash of the whole page (task caparium-beallitasok-osszeomlas)
  const poolField = (poolId: string) => f.pools[poolId] ?? { min: "", max: "" };
  const { msg, busy, save } = useSave();
  const unit = units.find((u) => u.id === f.unitId);
  const ready = f.from && f.unitId && f.zimsUnit.trim();
  const now = (r: { min: string | null; max: string | null } | null) => (r ? `${(r.min ?? "–").replace(".", ",")} – ${(r.max ?? "–").replace(".", ",")} ${t.unit.symbol}` : "nincs");
  return (
    <>
      <h3>Mértékegység váltása</h3>
      <p className="hint">
        A mérés a váltás előtti napon lezárul, és a váltás napjától ugyanezzel a névvel, ugyanazokban a táblákban és medencékben,
        ugyanazon a helyen a sorrendben folytatódik az új mértékegységben. A régi értékek a régi egységben maradnak. A referenciát az új
        egységben kell megadni; a mérőeszköz-átváltás nem kerül át.
      </p>
      <div className="form-grid" data-testid="wm-unit">
        <label className="form-label" htmlFor={`wmu-from-${t.id}`}>A váltás napja</label>
        <input id={`wmu-from-${t.id}`} className="input" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <label className="form-label" htmlFor={`wmu-unit-${t.id}`}>Új mértékegység</label>
        <select id={`wmu-unit-${t.id}`} className="input" value={f.unitId} onChange={(e) => setF({ ...f, unitId: e.target.value })}>
          <option value="">válassz</option>
          {units.filter((u) => u.id !== t.unit.id).map((u) => (
            <option key={u.id} value={u.id}>{u.symbol}</option>
          ))}
        </select>
        <label className="form-label" htmlFor={`wmu-zims-${t.id}`}>ZIMS-mértékegység</label>
        <input id={`wmu-zims-${t.id}`} className="input" value={f.zimsUnit} maxLength={40} onChange={(e) => setF({ ...f, zimsUnit: e.target.value })} />
        <label className="form-label" htmlFor={`wmu-dec-${t.id}`}>Tizedesjegyek</label>
        <select id={`wmu-dec-${t.id}`} className="input" value={f.decimals} onChange={(e) => setF({ ...f, decimals: e.target.value })}>
          {[0, 1, 2, 3, 4].map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <label className="form-label" htmlFor={`wmu-pmin-${t.id}`}>Hihető tartomány alja{unit ? ` (${unit.symbol})` : ""}</label>
        <input id={`wmu-pmin-${t.id}`} className="input small" inputMode="decimal" value={f.pMin} onChange={(e) => setF({ ...f, pMin: e.target.value })} />
        <label className="form-label" htmlFor={`wmu-pmax-${t.id}`}>Hihető tartomány teteje{unit ? ` (${unit.symbol})` : ""}</label>
        <input id={`wmu-pmax-${t.id}`} className="input small" inputMode="decimal" value={f.pMax} onChange={(e) => setF({ ...f, pMax: e.target.value })} />
        <label className="form-label" htmlFor={`wmu-rmin-${t.id}`}>Közös referencia alja{unit ? ` (${unit.symbol})` : ""}; most: {now(t.common)}</label>
        <input id={`wmu-rmin-${t.id}`} className="input small" inputMode="decimal" value={f.rMin} onChange={(e) => setF({ ...f, rMin: e.target.value })} />
        <label className="form-label" htmlFor={`wmu-rmax-${t.id}`}>Közös referencia teteje{unit ? ` (${unit.symbol})` : ""}</label>
        <input id={`wmu-rmax-${t.id}`} className="input small" inputMode="decimal" value={f.rMax} onChange={(e) => setF({ ...f, rMax: e.target.value })} />
        {own.map((p) => (
          <span key={p.poolId} style={{ display: "contents" }}>
            <label className="form-label" htmlFor={`wmu-pool-${t.id}-${p.poolId}`}>{p.name} saját referenciája{unit ? ` (${unit.symbol})` : ""}; most: {now(p.range)}</label>
            <span className="toolbar" style={{ margin: 0 }}>
              <input id={`wmu-pool-${t.id}-${p.poolId}`} className="input small" inputMode="decimal" aria-label={`${p.name} új referencia alja`} value={poolField(p.poolId).min} onChange={(e) => setF({ ...f, pools: { ...f.pools, [p.poolId]: { ...poolField(p.poolId), min: e.target.value } } })} />
              <input className="input small" inputMode="decimal" aria-label={`${p.name} új referencia teteje`} value={poolField(p.poolId).max} onChange={(e) => setF({ ...f, pools: { ...f.pools, [p.poolId]: { ...poolField(p.poolId), max: e.target.value } } })} />
            </span>
          </span>
        ))}
      </div>
      <div className="toolbar">
        <button
          className="btn"
          type="button"
          disabled={busy || !ready}
          onClick={() => {
            if (!window.confirm(`${t.name}: ${t.unit.symbol} helyett ${unit?.symbol ?? "?"}, a váltás napja ${day(f.from)}? A régi mérés az előtte való nappal lezárul.`)) return;
            void save(
              "/api/admin/measurement-types/unit",
              "POST",
              {
                parameterId: t.id,
                from: f.from,
                unitId: f.unitId,
                zimsUnit: f.zimsUnit.trim(),
                decimals: Number(f.decimals),
                plausibleMin: f.pMin || null,
                plausibleMax: f.pMax || null,
                referenceMin: f.rMin || null,
                referenceMax: f.rMax || null,
                poolReferences: own.map((p) => ({ poolId: p.poolId, min: poolField(p.poolId).min || null, max: poolField(p.poolId).max || null })),
              },
              "Mértékegység váltva; a folytatás a lista következő sora.",
            );
          }}
        >
          Mértékegység váltása
        </button>
        <Msg msg={msg} />
      </div>
    </>
  );
}
