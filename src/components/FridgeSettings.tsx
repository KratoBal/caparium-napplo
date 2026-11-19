"use client";

// The settings' "Hűtők" card (Lili 2026-11-02, task caparium-hutok): a fridge's name, kind (fridge or freezer) and range, and its
// closing. No delete: a closed fridge takes no new reading and leaves the daily card, its readings stay in the book and the
// exports, and it may be opened again. A new range acts from now on; the readings already taken keep theirs.
import { useState } from "react";
import { hasDigit, signedTemperature, startsNegative } from "@/lib/fridge-sign";
import { Msg, useSave } from "./SettingsForms";
import { SignButton } from "./SignButton";
import { useTr } from "./LangProvider";

export type FridgeSetting = { id: string; name: string; kind: "FRIDGE" | "FREEZER"; min: string; max: string; active: boolean };

const hu = (v: string) => v.replace(".", ",");
const dot = (v: string) => v.trim().replace(",", ".");

function KindSelect({ value, onChange, label }: { value: string; onChange: (v: "FRIDGE" | "FREEZER") => void; label: string }) {
  const tr = useTr();
  return (
    <select className="input" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as "FRIDGE" | "FREEZER")}>
      <option value="FRIDGE">{tr("hűtő")}</option>
      <option value="FREEZER">{tr("fagyasztó")}</option>
    </select>
  );
}

function FridgeSettingRow({ f }: { f: FridgeSetting }) {
  const tr = useTr();
  const [name, setName] = useState(f.name);
  const [kind, setKind] = useState(f.kind);
  const [min, setMin] = useState(hu(f.min));
  const [max, setMax] = useState(hu(f.max));
  // the saved texts carry their own sign here; the sign button flips it (the phone's decimal keypad has no minus)
  const [minNeg, setMinNeg] = useState(false);
  const [maxNeg, setMaxNeg] = useState(false);
  const { msg, busy, save } = useSave();
  const minSigned = dot(signedTemperature(min, minNeg));
  const maxSigned = dot(signedTemperature(max, maxNeg));
  const unchanged = name.trim() === f.name && kind === f.kind && minSigned === f.min && maxSigned === f.max;
  return (
    <tr data-testid={`fridge-setting-${f.name}`} className={f.active ? undefined : "invalid"}>
      <td className="keep"><input className="input" aria-label={tr("{name} neve", { name: f.name })} value={name} onChange={(e) => setName(e.target.value)} /></td>
      <td className="keep"><KindSelect label={tr("{name} fajtája", { name: f.name })} value={kind} onChange={setKind} /></td>
      <td className="keep"><span className="temp-field"><SignButton name={tr("{name} minimuma", { name: f.name })} text={min} negative={minNeg} onToggle={(n) => { setMin(n.text); setMinNeg(n.negative); }} /><input className="input small" inputMode="decimal" aria-label={tr("{name} minimuma (°C)", { name: f.name })} value={min} onChange={(e) => setMin(e.target.value)} /></span></td>
      <td className="keep"><span className="temp-field"><SignButton name={tr("{name} maximuma", { name: f.name })} text={max} negative={maxNeg} onToggle={(n) => { setMax(n.text); setMaxNeg(n.negative); }} /><input className="input small" inputMode="decimal" aria-label={tr("{name} maximuma (°C)", { name: f.name })} value={max} onChange={(e) => setMax(e.target.value)} /></span></td>
      <td className="keep">
        <button className="btn" type="button" disabled={busy || unchanged} onClick={() => void save(`/api/admin/fridges/${f.id}`, "PATCH", { name: name.trim(), kind, min: minSigned, max: maxSigned })}>
          {tr("Mentés")}
        </button>{" "}
        <button
          className="btn btn-row"
          type="button"
          disabled={busy}
          aria-label={f.active ? tr("{name}: lezárás", { name: f.name }) : tr("{name}: újranyitás", { name: f.name })}
          onClick={() => {
            if (f.active && !window.confirm(tr("Lezárod: {name}? Új leolvasás nem rögzíthető rá, és lekerül a napi oldalról; a korábbi leolvasásai megmaradnak, és újranyitható.", { name: f.name }))) return;
            void save(`/api/admin/fridges/${f.id}`, "PATCH", { active: !f.active }, f.active ? tr("Lezárva.") : tr("Újra használatban."));
          }}
        >
          {f.active ? tr("Lezárás") : tr("Újranyitás")}
        </button>{" "}
        <Msg msg={msg} />
      </td>
    </tr>
  );
}

function NewFridgeForm() {
  const tr = useTr();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"FRIDGE" | "FREEZER">("FRIDGE");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  // a freezer's range is negative: both fields start on minus for it, on plus for a fridge; the button flips each one
  const [minNeg, setMinNeg] = useState(startsNegative("FRIDGE"));
  const [maxNeg, setMaxNeg] = useState(startsNegative("FRIDGE"));
  const minSigned = signedTemperature(min, minNeg);
  const maxSigned = signedTemperature(max, maxNeg);
  const { msg, busy, save } = useSave();
  return (
    <div className="toolbar" data-testid="new-fridge">
      <label className="field">
        {tr("Név")}
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        {tr("Fajta")}
        <KindSelect
          label={tr("Új hűtő fajtája")}
          value={kind}
          onChange={(next) => {
            setKind(next);
            setMinNeg(startsNegative(next));
            setMaxNeg(startsNegative(next));
          }}
        />
      </label>
      <label className="field">
        {tr("Minimum (°C)")}
        {/* the INPUT comes first in the DOM: a wrapping <label> belongs to its first labelable descendant, and a button before the
            input took the label (the e2e's getByLabel("Minimum (°C)") then found the button); the button is shown on the left by CSS */}
        <span className="temp-field">
          <input className="input small" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
          <SignButton name={tr("Új hűtő minimuma")} text={min} negative={minNeg} onToggle={(n) => { setMin(n.text); setMinNeg(n.negative); }} />
        </span>
      </label>
      <label className="field">
        {tr("Maximum (°C)")}
        <span className="temp-field">
          <input className="input small" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
          <SignButton name={tr("Új hűtő maximuma")} text={max} negative={maxNeg} onToggle={(n) => { setMax(n.text); setMaxNeg(n.negative); }} />
        </span>
      </label>
      <button
        className="btn"
        type="button"
        disabled={busy || !name.trim() || !hasDigit(minSigned) || !hasDigit(maxSigned)}
        onClick={async () => {
          if (await save("/api/admin/fridges", "POST", { name: name.trim(), kind, min: dot(minSigned), max: dot(maxSigned) }, tr("Felvéve."))) {
            setName("");
            setMin("");
            setMax("");
            setMinNeg(startsNegative(kind));
            setMaxNeg(startsNegative(kind));
          }
        }}
      >
        {tr("Hűtő felvétele")}
      </button>
      <Msg msg={msg} />
    </div>
  );
}

export function FridgeSettings({ fridges }: { fridges: FridgeSetting[] }) {
  const tr = useTr();
  return (
    <>
      {fridges.length > 0 && (
        <div className="table-scroll">
          <table className="log-table" data-testid="fridges-table">
            <thead>
              <tr>
                <th>{tr("Név")}</th>
                <th>{tr("Fajta")}</th>
                <th>{tr("Minimum (°C)")}</th>
                <th>{tr("Maximum (°C)")}</th>
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
      <h3 style={{ marginTop: 20 }}>{tr("Új hűtő")}</h3>
      <NewFridgeForm />
    </>
  );
}
