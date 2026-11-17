"use client";

// The "Hűtők" card (Lili 2026-11-02, task caparium-hutok), since 2026-11-03 on its own page behind the "Fagyasztók
// hőmérséklete" tile (task caparium-fagyaszto-csempe), content and layout unchanged: one row per fridge to
// record a reading (temperature, date and time, now by default, the defrost tick and a short note), and the day's readings
// under it. A temperature outside the fridge's range is red, already while it is typed. A reading is corrected by recording
// it again ("Javítás": the old one is invalidated, the new one saved together) or invalidated; nothing is overwritten. The
// server decides every permission; this card only hides what the user cannot do anyway.
import { hasDigit, signedTemperature, startsNegative } from "@/lib/fridge-sign";
import { SignButton } from "./SignButton";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTr } from "./LangProvider";
import { askReason, useReasonsOn } from "./ReasonSwitch";

export type FridgeRow = { id: string; name: string; kind: "FRIDGE" | "FREEZER"; min: string; max: string; active: boolean };
export type FridgeReadingRow = {
  id: string;
  fridgeId: string;
  measuredAt: string;
  temperature: string;
  /** the range the reading was taken with */
  min: string;
  max: string;
  outOfRange: boolean;
  defrost: boolean;
  note: string | null;
  version: number;
  by: string;
};

// translated where shown (tr(KIND[kind]))
const KIND = { FRIDGE: "hűtő", FREEZER: "fagyasztó" } as const;
const hu = (v: string) => v.replace(".", ",");

function requestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function nowLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("hu-HU", { timeZone: "Europe/Budapest", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/** Out of the range as typed; a text that is not a number yet is not red. */
export function typedOutOfRange(text: string, min: string, max: string): boolean {
  const t = text.trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return false;
  const v = Number(t);
  return v < Number(min) || v > Number(max);
}

function useSend() {
  const router = useRouter();
  const tr = useTr();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(url: string, body: Record<string, unknown>, okText: string): Promise<boolean> {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: requestId(), clientTimestamp: new Date().toISOString(), ...body }),
      });
      const b = (await res.json().catch(() => ({}))) as { error?: { message?: string; issues?: { message: string }[] } };
      if (!res.ok) {
        setMsg({ ok: false, text: b.error?.issues?.[0]?.message ?? b.error?.message ?? tr("A mentés nem sikerült.") });
        return false;
      }
      setMsg({ ok: true, text: okText });
      router.refresh();
      return true;
    } catch {
      setMsg({ ok: false, text: tr("Nincs kapcsolat a szerverrel.") });
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

type Common = { day: string; today: string; isAdmin: boolean; nowAt: string };

/** The date and time field: on today it follows the clock until it is touched, so a page opened earlier still saves "now". */
function useAt({ day, today, nowAt }: Common) {
  const [touched, setTouched] = useState<string | null>(null);
  const [clock, setClock] = useState(day === today ? nowAt : `${day}T${nowAt.slice(11)}`);
  useEffect(() => {
    if (day !== today) return;
    const t = window.setInterval(() => setClock(nowLocal()), 30_000);
    return () => window.clearInterval(t);
  }, [day, today]);
  return { value: touched ?? clock, touched: touched !== null, set: setTouched, reset: () => setTouched(null) };
}

function Entry({ fridge, c }: { fridge: FridgeRow; c: Common }) {
  const [temp, setTemp] = useState("");
  // a freezer starts on minus (its range is negative), a fridge on plus; the sign button flips it (the phone keypad has no minus)
  const [negative, setNegative] = useState(startsNegative(fridge.kind));
  const [defrost, setDefrost] = useState(false);
  const [note, setNote] = useState("");
  const at = useAt(c);
  const { msg, busy, run } = useSend();
  const reasonsOn = useReasonsOn();
  const tr = useTr();
  const signed = signedTemperature(temp, negative);
  const out = typedOutOfRange(signed, fridge.min, fridge.max);
  async function save() {
    const body: Record<string, unknown> = { fridgeId: fridge.id, temperature: signed, defrost, ...(note.trim() ? { note: note.trim() } : {}) };
    // today and untouched: the server's now; otherwise the time set
    if (c.day !== c.today || at.touched) body.measuredAtLocal = at.value;
    if (at.value.slice(0, 10) !== c.today && reasonsOn) {
      const asked = askReason(true, tr("Korábbi napra rögzítés oka:"), "");
      if (!asked) return;
      Object.assign(body, asked);
    }
    if (await run("/api/fridge-readings", body, tr(out ? "Mentve; a hőmérséklet a tartományon kívül van." : "Mentve."))) {
      setTemp("");
      setNegative(startsNegative(fridge.kind));
      setDefrost(false);
      setNote("");
      at.reset();
    }
  }
  return (
    <tr data-testid={`fridge-${fridge.name}`}>
      <td>
        <strong>{fridge.name}</strong> <span className="hint">({tr(KIND[fridge.kind])})</span>
      </td>
      <td className="hint keep">
        {hu(fridge.min)} – {hu(fridge.max)} °C
      </td>
      <td data-label={tr("Hőmérséklet (°C)")}>
        <span className="temp-field">
          <SignButton name={fridge.name} text={temp} negative={negative} onToggle={(next) => { setTemp(next.text); setNegative(next.negative); }} />
          <input
            className={`input small${out ? " out" : ""}`}
            inputMode="decimal"
            aria-label={tr("{name} hőmérséklete (°C)", { name: fridge.name })}
            aria-invalid={out || undefined}
            value={temp}
            onChange={(e) => setTemp(e.target.value)}
          />
        </span>
      </td>
      <td data-label={tr("Dátum és idő")}>
        <input
          className="input"
          type="datetime-local"
          aria-label={tr("{name}: a leolvasás ideje", { name: fridge.name })}
          value={at.value}
          // an aquarist records on today only; an admin on an earlier day too
          min={c.isAdmin ? undefined : `${c.today}T00:00`}
          max={c.isAdmin ? undefined : `${c.today}T23:59`}
          onChange={(e) => at.set(e.target.value)}
        />
      </td>
      <td>
        <label className="check">
          <input type="checkbox" aria-label={tr("{name}: leolvasztás", { name: fridge.name })} checked={defrost} onChange={(e) => setDefrost(e.target.checked)} />
          {tr("Leolvasztás")}
        </label>
      </td>
      <td data-label={tr("Megjegyzés")}>
        <input className="input" maxLength={200} aria-label={tr("{name}: megjegyzés", { name: fridge.name })} placeholder={tr("megjegyzés")} value={note} onChange={(e) => setNote(e.target.value)} />
      </td>
      <td className="keep">
        <button className="btn" type="button" disabled={busy || !hasDigit(signed) || !at.value} onClick={() => void save()}>
          {tr("Mentés")}
        </button>{" "}
        <Msg msg={msg} />
      </td>
    </tr>
  );
}

function Reading({ fridge, r, c, canWrite }: { fridge: FridgeRow; r: FridgeReadingRow; c: Common; canWrite: boolean }) {
  const [open, setOpen] = useState(false);
  const [temp, setTemp] = useState(hu(r.temperature));
  // the text carries its sign here (no default minus on a correction); the sign button flips it
  const [negative, setNegative] = useState(false);
  const [when, setWhen] = useState(`${c.day}T${localTime(r.measuredAt)}`);
  const [defrost, setDefrost] = useState(r.defrost);
  const [note, setNote] = useState(r.note ?? "");
  const { msg, busy, run } = useSend();
  const reasonsOn = useReasonsOn();
  const tr = useTr();
  const mayChange = canWrite && (c.isAdmin || c.day === c.today);
  // a correction keeps the range the reading was taken with (the server does the same)
  const signed = signedTemperature(temp, negative);
  const out = typedOutOfRange(signed, r.min, r.max);
  async function correct() {
    const body: Record<string, unknown> = {
      fridgeId: fridge.id,
      replacesId: r.id,
      expectedVersion: r.version,
      temperature: signed,
      measuredAtLocal: when,
      defrost,
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    if (reasonsOn && (c.day !== c.today || when.slice(0, 10) !== c.today)) {
      const asked = askReason(true, tr("A javítás oka:"), "");
      if (!asked) return;
      Object.assign(body, asked);
    }
    if (await run("/api/fridge-readings", body, tr("Javítva."))) setOpen(false);
  }
  async function invalidate() {
    const asked = askReason(reasonsOn, tr("Az érvénytelenítés oka:"), tr("Érvényteleníted ezt a leolvasást: {name}, {time}, {temp} °C?", { name: fridge.name, time: localTime(r.measuredAt), temp: hu(r.temperature) }));
    if (!asked) return;
    await run(`/api/fridge-readings/${r.id}/invalidate`, { expectedVersion: r.version, ...asked }, tr("Érvénytelenítve."));
  }
  if (open) {
    return (
      <tr className="fridge-reading" data-testid="fridge-reading-edit">
        <td className="hint">{tr("javítás")}</td>
        <td className="fridge-gap" />
        <td>
          <span className="temp-field"><SignButton name={fridge.name} text={temp} negative={negative} onToggle={(next) => { setTemp(next.text); setNegative(next.negative); }} /><input className={`input small${out ? " out" : ""}`} inputMode="decimal" aria-label={tr("{name}: javított hőmérséklet (°C)", { name: fridge.name })} value={temp} onChange={(e) => setTemp(e.target.value)} /></span>
        </td>
        <td>
          <input className="input" type="datetime-local" aria-label={tr("{name}: javított idő", { name: fridge.name })} value={when} onChange={(e) => setWhen(e.target.value)} />
        </td>
        <td>
          <label className="check">
            <input type="checkbox" checked={defrost} onChange={(e) => setDefrost(e.target.checked)} />
            {tr("Leolvasztás")}
          </label>
        </td>
        <td>
          <input className="input" maxLength={200} aria-label={tr("{name}: javított megjegyzés", { name: fridge.name })} value={note} onChange={(e) => setNote(e.target.value)} />
        </td>
        <td className="keep">
          <button className="btn" type="button" disabled={busy || !hasDigit(signed) || !when} onClick={() => void correct()}>
            {tr("Mentés")}
          </button>{" "}
          <button className="btn btn-soft" type="button" disabled={busy} onClick={() => setOpen(false)}>
            {tr("Mégse")}
          </button>{" "}
          <Msg msg={msg} />
        </td>
      </tr>
    );
  }
  return (
    <tr className="fridge-reading" data-testid="fridge-reading">
      <td className="fridge-gap" />
      <td className="fridge-gap" />
      <td className={r.outOfRange ? "fridge-out" : undefined} data-out={r.outOfRange || undefined}>
        {hu(r.temperature)} °C
      </td>
      <td className="hint">
        {localTime(r.measuredAt)} · {r.by}
      </td>
      <td>{r.defrost ? tr("Leolvasztás") : ""}</td>
      <td>{r.note ?? ""}</td>
      <td className="keep">
        {mayChange && (
          <>
            <button className="btn btn-row" type="button" disabled={busy} aria-label={tr("{name} {time}: javítás", { name: fridge.name, time: localTime(r.measuredAt) })} onClick={() => setOpen(true)}>
              {tr("Javítás")}
            </button>{" "}
            <button className="btn btn-row" type="button" disabled={busy} aria-label={tr("{name} {time}: érvénytelenítés", { name: fridge.name, time: localTime(r.measuredAt) })} onClick={() => void invalidate()}>
              {tr("Érvénytelenítés")}
            </button>{" "}
          </>
        )}
        <Msg msg={msg} />
      </td>
    </tr>
  );
}

export function FridgeCard({
  fridges,
  readings,
  canWrite,
  ...c
}: Common & { fridges: FridgeRow[]; readings: FridgeReadingRow[]; canWrite: boolean }) {
  // an aquarist records on today only; on an earlier day the card shows the book
  const mayRecord = canWrite && (c.isAdmin || c.day === c.today);
  const tr = useTr();
  return (
    <div className="card" data-testid="fridge-card">
      <h2>{tr("Hűtők")}</h2>
      {fridges.length === 0 ? (
        <p className="hint">{tr("Nincs felvett hűtő. Az adminisztrátor a Beállítások „Hűtők” részében veheti fel.")}</p>
      ) : (
        <div className="table-scroll">
          <table className="log-table fridge-table">
            <thead>
              <tr>
                <th>{tr("Hűtő")}</th>
                <th>{tr("Tartomány")}</th>
                <th>{tr("Hőmérséklet")}</th>
                <th>{tr("Dátum és idő")}</th>
                <th>{tr("Leolvasztás")}</th>
                <th>{tr("Megjegyzés")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {fridges.map((f) => (
                <FridgeRows key={f.id} fridge={f} readings={readings.filter((r) => r.fridgeId === f.id)} c={c} canWrite={canWrite} mayRecord={mayRecord && f.active} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FridgeRows({ fridge, readings, c, canWrite, mayRecord }: { fridge: FridgeRow; readings: FridgeReadingRow[]; c: Common; canWrite: boolean; mayRecord: boolean }) {
  const tr = useTr();
  return (
    <>
      {mayRecord ? (
        <Entry fridge={fridge} c={c} />
      ) : (
        <tr data-testid={`fridge-${fridge.name}`}>
          <td>
            <strong>{fridge.name}</strong> <span className="hint">({tr(KIND[fridge.kind])}{fridge.active ? "" : tr(", lezárva")})</span>
          </td>
          <td className="hint keep">
            {hu(fridge.min)} – {hu(fridge.max)} °C
          </td>
          <td colSpan={5} className="hint">
            {readings.length === 0 ? tr("Ezen a napon nincs leolvasás.") : ""}
          </td>
        </tr>
      )}
      {readings.map((r) => (
        <Reading key={r.id} fridge={fridge} r={r} c={c} canWrite={canWrite} />
      ))}
    </>
  );
}
