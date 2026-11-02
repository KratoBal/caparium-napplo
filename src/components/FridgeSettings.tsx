"use client";

// The settings' "Hűtők" card (Lili 2026-11-02, task caparium-hutok): a fridge's name, kind (fridge or freezer) and range, and its
// closing. No delete: a closed fridge takes no new reading and leaves the daily card, its readings stay in the book and the
// exports, and it may be opened again. A new range acts from now on; the readings already taken keep theirs.
import { useState } from "react";
import { Msg, useSave } from "./SettingsForms";

export type FridgeSetting = { id: string; name: string; kind: "FRIDGE" | "FREEZER"; min: string; max: string; active: boolean };

const hu = (v: string) => v.replace(".", ",");
const dot = (v: string) => v.trim().replace(",", ".");

function KindSelect({ value, onChange, label }: { value: string; onChange: (v: "FRIDGE" | "FREEZER") => void; label: string }) {
  return (
    <select className="input" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as "FRIDGE" | "FREEZER")}>
      <option value="FRIDGE">hűtő</option>
      <option value="FREEZER">fagyasztó</option>
    </select>
  );
}

function FridgeSettingRow({ f }: { f: FridgeSetting }) {
  const [name, setName] = useState(f.name);
  const [kind, setKind] = useState(f.kind);
  const [min, setMin] = useState(hu(f.min));
  const [max, setMax] = useState(hu(f.max));
  const { msg, busy, save } = useSave();
  const unchanged = name.trim() === f.name && kind === f.kind && dot(min) === f.min && dot(max) === f.max;
  return (
    <tr data-testid={`fridge-setting-${f.name}`} className={f.active ? undefined : "invalid"}>
      <td className="keep"><input className="input" aria-label={`${f.name} neve`} value={name} onChange={(e) => setName(e.target.value)} /></td>
      <td className="keep"><KindSelect label={`${f.name} fajtája`} value={kind} onChange={setKind} /></td>
      <td className="keep"><input className="input small" inputMode="decimal" aria-label={`${f.name} minimuma (°C)`} value={min} onChange={(e) => setMin(e.target.value)} /></td>
      <td className="keep"><input className="input small" inputMode="decimal" aria-label={`${f.name} maximuma (°C)`} value={max} onChange={(e) => setMax(e.target.value)} /></td>
      <td className="keep">
        <button className="btn" type="button" disabled={busy || unchanged} onClick={() => void save(`/api/admin/fridges/${f.id}`, "PATCH", { name: name.trim(), kind, min: dot(min), max: dot(max) })}>
          Mentés
        </button>{" "}
        <button
          className="btn btn-row"
          type="button"
          disabled={busy}
          aria-label={`${f.name}: ${f.active ? "lezárás" : "újranyitás"}`}
          onClick={() => {
            if (f.active && !window.confirm(`Lezárod: ${f.name}? Új leolvasás nem rögzíthető rá, és lekerül a napi oldalról; a korábbi leolvasásai megmaradnak, és újranyitható.`)) return;
            void save(`/api/admin/fridges/${f.id}`, "PATCH", { active: !f.active }, f.active ? "Lezárva." : "Újra használatban.");
          }}
        >
          {f.active ? "Lezárás" : "Újranyitás"}
        </button>{" "}
        <Msg msg={msg} />
      </td>
    </tr>
  );
}

function NewFridgeForm() {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"FRIDGE" | "FREEZER">("FRIDGE");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const { msg, busy, save } = useSave();
  return (
    <div className="toolbar" data-testid="new-fridge">
      <label className="field">
        Név
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        Fajta
        <KindSelect label="Új hűtő fajtája" value={kind} onChange={setKind} />
      </label>
      <label className="field">
        Minimum (°C)
        <input className="input small" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
      </label>
      <label className="field">
        Maximum (°C)
        <input className="input small" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
      </label>
      <button
        className="btn"
        type="button"
        disabled={busy || !name.trim() || !min.trim() || !max.trim()}
        onClick={async () => {
          if (await save("/api/admin/fridges", "POST", { name: name.trim(), kind, min: dot(min), max: dot(max) }, "Felvéve.")) {
            setName("");
            setMin("");
            setMax("");
          }
        }}
      >
        Hűtő felvétele
      </button>
      <Msg msg={msg} />
    </div>
  );
}

export function FridgeSettings({ fridges }: { fridges: FridgeSetting[] }) {
  return (
    <>
      {fridges.length > 0 && (
        <div className="table-scroll">
          <table className="log-table" data-testid="fridges-table">
            <thead>
              <tr>
                <th>Név</th>
                <th>Fajta</th>
                <th>Minimum (°C)</th>
                <th>Maximum (°C)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {fridges.map((f) => (
                <FridgeSettingRow key={f.id} f={f} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3 style={{ marginTop: 20 }}>Új hűtő</h3>
      <NewFridgeForm />
    </>
  );
}
