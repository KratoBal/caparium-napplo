"use client";

// Lili 2026-11-02 09:36-09:40 UTC (acrobot 39956, 39960): the water measurements on one card, as the pools, the feeds and the
// animals: a row each, and opened, everything that belongs to it (src/lib/measurement-types.ts). A unit change's successor
// stands right under its predecessor, joined to it.
import { useState } from "react";
import type { MeasurementTypeView } from "@/lib/measurement-types";
import { formatDay } from "@/lib/time";
import { OrderList } from "./AnimalOrder";
import { ConversionRow, Msg, ReferenceRow, useSave } from "./SettingsForms";
import { useTr } from "./LangProvider";
import type { TrVars } from "@/lib/i18n/translate";

type Tr = (text: string, vars?: TrVars) => string;

type Unit = { id: string; symbol: string };

// the frequencies, translated where shown (tr(FREQ[f])); on the i18n guard's list
const FREQ: Record<string, string> = { DAILY: "napi", WEEKLY: "heti" };
const day = (d: string) => formatDay(d);

function period(t: MeasurementTypeView, tr: Tr): string {
  if (!t.from) return tr("nincs táblában");
  return t.to ? `${day(t.from)} – ${day(t.to)}` : `${day(t.from)} –`;
}

function tablesText(t: MeasurementTypeView, tr: Tr): string {
  const open = t.tables.filter((x) => x.to === null || !t.to || x.to === t.to);
  return (open.length ? open : t.tables).map((x) => `${x.groupName}: ${x.pools ? x.pools.join(", ") : tr("minden medence")}`).join("; ") || "–";
}

export function WaterMeasurements({ rows, units, today, reasons }: { rows: MeasurementTypeView[]; units: Unit[]; today: string; reasons: boolean }) {
  const tr = useTr();
  const byId = new Map(rows.map((r) => [r.id, r]));
  return (
    <>
      <div className="table-scroll">
        <table className="log-table" data-testid="water-measurements">
          <thead>
            <tr><th>{tr("Név")}</th><th>{tr("Mértékegység")}</th><th>{tr("Napi vagy heti")}</th><th>{tr("Táblák és medencék")}</th><th>{tr("Időszak")}</th><th></th></tr>
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
          <summary>{tr("Sorrend")}</summary>
          <p className="hint">
            {tr(
              "Húzd a sort a helyére (érintőképernyőn a Fel és Le gombokkal), majd mentsd. A napi és a heti tábla oszlopai, a vízjelentés és az Excel ezt a sorrendet követik; a ZIMS-fájl sorrendje nem változik.",
            )}
          </p>
          <OrderList
            key={rows.map((r) => r.id).join()}
            rows={rows.map((r) => ({ id: r.id, name: `${tr(r.name)} (${r.unit.symbol})`, detail: r.inForce ? "" : tr("lezárva") }))}
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
  const tr = useTr();
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr data-testid={`wm-${t.name}-${t.unit.symbol}`} className={t.inForce ? undefined : "invalid"}>
        <td className="keep">
          {predecessor && <span className="hint" title={tr("egységváltás: {from} → {to}", { from: predecessor.unit.symbol, to: t.unit.symbol })}>↳ </span>}
          {tr(t.name)}
        </td>
        <td>{t.unit.symbol}</td>
        <td>{t.frequencies.map((f) => (FREQ[f] ? tr(FREQ[f]) : f)).join(", ") || "–"}</td>
        <td className="hint">{tablesText(t, tr)}</td>
        <td>
          {period(t, tr)}
          {t.successorId && <span className="hint"> {tr("(egységváltás, folytatása alatta)")}</span>}
          {predecessor && <span className="hint"> {tr("(az előző, {unit} folytatása)", { unit: predecessor.unit.symbol })}</span>}
        </td>
        <td className="keep">
          <button className="btn btn-row" type="button" aria-expanded={open} aria-label={tr("{name} ({unit}): szerkesztés", { name: tr(t.name), unit: t.unit.symbol })} onClick={() => setOpen(!open)}>
            {open ? tr("Bezárás") : tr("Szerkesztés")}
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
  const tr = useTr();
  return (
    <div className="wm-editor">
      <NameForm t={t} today={today} />
      <LimitsForm t={t} />
      <h3>{tr("Referencia")}</h3>
      <p className="hint">{tr("A közös érték minden saját érték nélküli medencére érvényes; a medence saját értéke felülírja. A „változás” mostantól érvényes, a „helyesbítés” a múltra is hat.")}</p>
      <div className="table-scroll">
        <table className="log-table">
          <thead>
            <tr><th>{tr("Medence")}</th><th>{tr("Mértékegység")}</th><th>{tr("Minimum")}</th><th>{tr("Maximum")}</th><th>{tr("Fajta")}</th>{reasons && <th>{tr("Indoklás")}</th>}<th></th></tr>
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
      <h3>{tr("Mérőeszköz-átváltás")}</h3>
      <p className="hint">{tr("Ha a mérőeszköz leolvasást mutat (például Hanna HI755 a KH-hoz: × 0,056), a táblába a leolvasás kerül, és a mező átváltja.")}</p>
      <div className="table-scroll">
        <table className="log-table">
          <thead>
            <tr><th>{tr("Paraméter")}</th><th>{tr("Most érvényes")}</th><th>{tr("Mérőeszköz")}</th><th>{tr("Szorzó")}</th><th>{tr("Tizedes")}</th><th>{tr("Mettől")}</th><th></th></tr>
          </thead>
          <tbody>
            <ConversionRow parameterId={t.id} name={t.name} unit={t.unit.symbol} current={t.conversion} today={today} />
          </tbody>
        </table>
      </div>
      {t.dilution && (
        <>
          <h3>{tr("Hígítás")}</h3>
          <p className="hint" data-testid="wm-dilution">
            {tr("Heti mérésnél hígítással mérhető: a mentett érték a leolvasás és a hígítás szorzata.")}
          </p>
        </>
      )}
      {t.inForce && <CloseForm t={t} today={today} />}
      {t.inForce && !t.successorId && <UnitChangeForm t={t} units={units} today={today} />}
    </div>
  );
}

function NameForm({ t, today }: { t: MeasurementTypeView; today: string }) {
  const tr = useTr();
  const [name, setName] = useState(t.name);
  const [from, setFrom] = useState(today);
  const { msg, busy, save } = useSave();
  return (
    <div className="toolbar toolbar-end" data-testid="wm-name">
      <label className="field">
        {tr("Név")}
        <input className="input" aria-label={tr("{name} új neve", { name: tr(t.name) })} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        {tr("Mettől")}
        <input className="input" type="date" aria-label={tr("{name} új nevének kezdete", { name: tr(t.name) })} value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <button
        className="btn"
        type="button"
        disabled={busy || name.trim() === t.name || name.trim().length < 2 || !from}
        onClick={() => void save("/api/admin/measurement-types/rename", "POST", { parameterId: t.id, name: name.trim(), from }, tr("Átnevezve; a korábbi napokon a régi név marad."))}
      >
        {tr("Név mentése")}
      </button>
      <Msg msg={msg} />
    </div>
  );
}

function LimitsForm({ t }: { t: MeasurementTypeView }) {
  const tr = useTr();
  const start = { decimals: String(t.decimals), min: (t.plausibleMin ?? "").replace(".", ","), max: (t.plausibleMax ?? "").replace(".", ",") };
  const [f, setF] = useState(start);
  const { msg, busy, save } = useSave();
  const changed = f.decimals !== start.decimals || f.min !== start.min || f.max !== start.max;
  return (
    <div className="toolbar toolbar-end" data-testid="wm-limits">
      <label className="field">
        {tr("Tizedesjegyek")}
        <select className="input" aria-label={tr("{name} tizedesjegyei", { name: tr(t.name) })} value={f.decimals} onChange={(e) => setF({ ...f, decimals: e.target.value })}>
          {[0, 1, 2, 3, 4].map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </label>
      <label className="field">
        {tr("Hihető tartomány alja")}
        <input className="input small" inputMode="decimal" aria-label={tr("{name} hihető tartomány alja", { name: tr(t.name) })} value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} />
      </label>
      <label className="field">
        {tr("teteje")}
        <input className="input small" inputMode="decimal" aria-label={tr("{name} hihető tartomány teteje", { name: tr(t.name) })} value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} />
      </label>
      <button
        className="btn"
        type="button"
        disabled={busy || !changed}
        onClick={() => void save("/api/admin/measurement-types/limits", "POST", { parameterId: t.id, decimals: Number(f.decimals), plausibleMin: f.min || null, plausibleMax: f.max || null })}
      >
        {tr("Mentés")}
      </button>
      <Msg msg={msg} />
    </div>
  );
}

function CloseForm({ t, today }: { t: MeasurementTypeView; today: string }) {
  const tr = useTr();
  const [to, setTo] = useState(today);
  const { msg, busy, save } = useSave();
  return (
    <>
      <h3>{tr("Lezárás")}</h3>
      <p className="hint">{tr("Az utolsó nap után a mérés oszlopa nem jelenik meg a táblákban; a korábbi értékek megmaradnak, az exportokban a saját napjukon látszanak. Törlés nincs.")}</p>
      <div className="toolbar toolbar-end" data-testid="wm-close">
        <label className="field">
          {tr("Meddig (utolsó nap)")}
          <input className="input" type="date" aria-label={tr("{name} utolsó napja", { name: tr(t.name) })} value={to} min={t.from ?? undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button
          className="btn btn-soft"
          type="button"
          disabled={busy || !to}
          onClick={() => {
            if (!window.confirm(tr("Lezárod: {name}, utolsó nap {day}? Utána nem kerül a táblákba; a korábbi értékek megmaradnak.", { name: tr(t.name), day: day(to) }))) return;
            void save("/api/admin/measurement-types/close", "POST", { parameterId: t.id, to }, tr("Lezárva."));
          }}
        >
          {tr("Lezárás")}
        </button>
        <Msg msg={msg} />
      </div>
    </>
  );
}

function UnitChangeForm({ t, units, today }: { t: MeasurementTypeView; units: Unit[]; today: string }) {
  const tr = useTr();
  const own = t.pools.filter((p) => p.own);
  const empty = { from: today, unitId: "", zimsUnit: "", decimals: String(t.decimals), pMin: "", pMax: "", rMin: "", rMax: "", pools: Object.fromEntries(own.map((p) => [p.poolId, { min: "", max: "" }])) as Record<string, { min: string; max: string }> };
  const [f, setF] = useState(empty);
  // the state is made at the first render; a pool that gets its own range later (the reference row above, saved and refreshed)
  // has no entry yet: an empty one, not a crash of the whole page (task caparium-beallitasok-osszeomlas)
  const poolField = (poolId: string) => f.pools[poolId] ?? { min: "", max: "" };
  const { msg, busy, save } = useSave();
  const unit = units.find((u) => u.id === f.unitId);
  const ready = f.from && f.unitId && f.zimsUnit.trim();
  const now = (r: { min: string | null; max: string | null } | null) => (r ? `${(r.min ?? "–").replace(".", ",")} – ${(r.max ?? "–").replace(".", ",")} ${t.unit.symbol}` : tr("nincs"));
  return (
    <>
      <h3>{tr("Mértékegység váltása")}</h3>
      <p className="hint">
        {tr(
          "A mérés a váltás előtti napon lezárul, és a váltás napjától ugyanezzel a névvel, ugyanazokban a táblákban és medencékben, ugyanazon a helyen a sorrendben folytatódik az új mértékegységben. A régi értékek a régi egységben maradnak. A referenciát az új egységben kell megadni; a mérőeszköz-átváltás nem kerül át.",
        )}
      </p>
      <div className="form-grid" data-testid="wm-unit">
        <label className="form-label" htmlFor={`wmu-from-${t.id}`}>{tr("A váltás napja")}</label>
        <input id={`wmu-from-${t.id}`} className="input" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <label className="form-label" htmlFor={`wmu-unit-${t.id}`}>{tr("Új mértékegység")}</label>
        <select id={`wmu-unit-${t.id}`} className="input" value={f.unitId} onChange={(e) => setF({ ...f, unitId: e.target.value })}>
          <option value="">{tr("válassz")}</option>
          {units.filter((u) => u.id !== t.unit.id).map((u) => (
            <option key={u.id} value={u.id}>{u.symbol}</option>
          ))}
        </select>
        <label className="form-label" htmlFor={`wmu-zims-${t.id}`}>{tr("ZIMS-mértékegység")}</label>
        <input id={`wmu-zims-${t.id}`} className="input" value={f.zimsUnit} maxLength={40} onChange={(e) => setF({ ...f, zimsUnit: e.target.value })} />
        <label className="form-label" htmlFor={`wmu-dec-${t.id}`}>{tr("Tizedesjegyek")}</label>
        <select id={`wmu-dec-${t.id}`} className="input" value={f.decimals} onChange={(e) => setF({ ...f, decimals: e.target.value })}>
          {[0, 1, 2, 3, 4].map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <label className="form-label" htmlFor={`wmu-pmin-${t.id}`}>{tr("Hihető tartomány alja")}{unit ? ` (${unit.symbol})` : ""}</label>
        <input id={`wmu-pmin-${t.id}`} className="input small" inputMode="decimal" value={f.pMin} onChange={(e) => setF({ ...f, pMin: e.target.value })} />
        <label className="form-label" htmlFor={`wmu-pmax-${t.id}`}>{tr("Hihető tartomány teteje")}{unit ? ` (${unit.symbol})` : ""}</label>
        <input id={`wmu-pmax-${t.id}`} className="input small" inputMode="decimal" value={f.pMax} onChange={(e) => setF({ ...f, pMax: e.target.value })} />
        <label className="form-label" htmlFor={`wmu-rmin-${t.id}`}>{tr("Közös referencia alja")}{unit ? ` (${unit.symbol})` : ""}; {tr("most: {value}", { value: now(t.common) })}</label>
        <input id={`wmu-rmin-${t.id}`} className="input small" inputMode="decimal" value={f.rMin} onChange={(e) => setF({ ...f, rMin: e.target.value })} />
        <label className="form-label" htmlFor={`wmu-rmax-${t.id}`}>{tr("Közös referencia teteje")}{unit ? ` (${unit.symbol})` : ""}</label>
        <input id={`wmu-rmax-${t.id}`} className="input small" inputMode="decimal" value={f.rMax} onChange={(e) => setF({ ...f, rMax: e.target.value })} />
        {own.map((p) => (
          <span key={p.poolId} style={{ display: "contents" }}>
            <label className="form-label" htmlFor={`wmu-pool-${t.id}-${p.poolId}`}>{tr("{pool} saját referenciája", { pool: p.name })}{unit ? ` (${unit.symbol})` : ""}; {tr("most: {value}", { value: now(p.range) })}</label>
            <span className="toolbar" style={{ margin: 0 }}>
              <input id={`wmu-pool-${t.id}-${p.poolId}`} className="input small" inputMode="decimal" aria-label={tr("{pool} új referencia alja", { pool: p.name })} value={poolField(p.poolId).min} onChange={(e) => setF({ ...f, pools: { ...f.pools, [p.poolId]: { ...poolField(p.poolId), min: e.target.value } } })} />
              <input className="input small" inputMode="decimal" aria-label={tr("{pool} új referencia teteje", { pool: p.name })} value={poolField(p.poolId).max} onChange={(e) => setF({ ...f, pools: { ...f.pools, [p.poolId]: { ...poolField(p.poolId), max: e.target.value } } })} />
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
            if (!window.confirm(tr("{name}: {old} helyett {new}, a váltás napja {day}? A régi mérés az előtte való nappal lezárul.", { name: tr(t.name), old: t.unit.symbol, new: unit?.symbol ?? "?", day: day(f.from) }))) return;
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
              tr("Mértékegység váltva; a folytatás a lista következő sora."),
            );
          }}
        >
          {tr("Mértékegység váltása")}
        </button>
        <Msg msg={msg} />
      </div>
    </>
  );
}
