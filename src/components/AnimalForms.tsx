"use client";

// Forms of the animal and feed master data (DAT-01, DAT-02, DAT-05). The server decides every
// permission; these only send what the user picked.
import { useRouter } from "next/navigation";
import { useState } from "react";

type Opt = { id: string; name: string };

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

function useApi() {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function call(url: string, method: string, body: Record<string, unknown>, okText = "Mentve.") {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: requestId(), clientTimestamp: new Date().toISOString(), ...body }),
      });
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
  return { msg, busy, call };
}

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <span className={msg.ok ? "hint" : "err"} role="status">
      {msg.text}
    </span>
  );
}

const ACTION_LABEL = { TRANSFER: "Áthelyezés", GROUP_CHANGE: "Csoportváltás", DEATH: "Elhullás", RELEASE: "Kiadás" } as const;

/** One lifecycle event for an existing animal: transfer, group change, death, release. */
export function AnimalActions({ animalId, pools, groups }: { animalId: string; pools: Opt[]; groups: Opt[] }) {
  const [type, setType] = useState<keyof typeof ACTION_LABEL>("TRANSFER");
  const [pool, setPool] = useState(pools[0]?.id ?? "");
  const [group, setGroup] = useState("");
  const [time, setTime] = useState(nowLocal());
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const { msg, busy, call } = useApi();
  return (
    <div className="toolbar" data-testid="animal-actions">
      <label className="field">
        Esemény
        <select className="input" value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="Esemény">
          {Object.entries(ACTION_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      {type === "TRANSFER" && (
        <label className="field">
          Hova
          <select className="input" value={pool} onChange={(e) => setPool(e.target.value)} aria-label="Cél medence">
            {pools.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {type === "GROUP_CHANGE" && (
        <label className="field">
          Csoport
          <select className="input" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Cél csoport">
            <option value="">nincs csoport</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        Időpont
        <input className="input" type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Az esemény időpontja" />
      </label>
      <label className="field">
        Megjegyzés
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Megjegyzés" />
      </label>
      <label className="field">
        Indoklás (korábbi napnál)
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Indoklás" />
      </label>
      <button
        className="btn"
        type="button"
        disabled={busy}
        onClick={() =>
          void call("/api/animals/events", "POST", {
            type,
            animalId,
            occurredAtLocal: time,
            ...(type === "TRANSFER" ? { toPoolId: pool } : {}),
            ...(type === "GROUP_CHANGE" ? { toGroupId: group || null } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
            ...(reason.trim() ? { reason: reason.trim() } : {}),
          }, `${ACTION_LABEL[type]} rögzítve.`)
        }
      >
        Rögzítés
      </button>
      <Msg msg={msg} />
    </div>
  );
}

export function InvalidateEvent({ eventId, version }: { eventId: string; version: number }) {
  const { msg, busy, call } = useApi();
  return (
    <>
      <button
        className="btn btn-soft"
        type="button"
        disabled={busy}
        onClick={() => {
          const r = window.prompt("Az érvénytelenítés oka:");
          if (r && r.trim().length >= 3) void call(`/api/animals/events/${eventId}/invalidate`, "POST", { expectedVersion: version, reason: r.trim() }, "Érvénytelenítve.");
        }}
      >
        Érvénytelenítés
      </button>{" "}
      <Msg msg={msg} />
    </>
  );
}

/** Admin: a new animal is an arrival event. */
export function NewArrival({ species, pools, groups }: { species: Opt[]; pools: Opt[]; groups: Opt[] }) {
  const [f, setF] = useState({ name: "", speciesId: species[0]?.id ?? "", sex: "UNKNOWN", pool: pools[0]?.id ?? "", group: "", time: nowLocal(), reason: "" });
  const { msg, busy, call } = useApi();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="toolbar" data-testid="new-arrival">
      <input className="input" placeholder="név" aria-label="Az új állat neve" value={f.name} onChange={set("name")} />
      <select className="input" aria-label="Faj" value={f.speciesId} onChange={set("speciesId")}>
        {species.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <select className="input" aria-label="Nem" value={f.sex} onChange={set("sex")}>
        <option value="UNKNOWN">ismeretlen</option>
        <option value="MALE">hím</option>
        <option value="FEMALE">nőstény</option>
      </select>
      <select className="input" aria-label="Medence" value={f.pool} onChange={set("pool")}>
        {pools.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select className="input" aria-label="Csoport" value={f.group} onChange={set("group")}>
        <option value="">nincs csoport</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <input className="input" type="datetime-local" aria-label="Érkezés időpontja" value={f.time} onChange={set("time")} />
      <input className="input" placeholder="indoklás (korábbi napnál)" aria-label="Indoklás az érkezéshez" value={f.reason} onChange={set("reason")} />
      <button
        className="btn"
        type="button"
        disabled={busy}
        onClick={() =>
          void call("/api/animals/events", "POST", {
            type: "ARRIVAL",
            newAnimal: { name: f.name, speciesId: f.speciesId, sex: f.sex },
            toPoolId: f.pool,
            toGroupId: f.group || null,
            occurredAtLocal: f.time,
            ...(f.reason.trim() ? { reason: f.reason.trim() } : {}),
          }, "Az állat felvéve.")
        }
      >
        Érkezés rögzítése
      </button>
      <Msg msg={msg} />
    </div>
  );
}

export function SimpleCreate({ url, label, field, testId }: { url: string; label: string; field: string; testId: string }) {
  const [v, setV] = useState("");
  const { msg, busy, call } = useApi();
  return (
    <div className="toolbar" data-testid={testId}>
      <input className="input" aria-label={label} placeholder={label} value={v} onChange={(e) => setV(e.target.value)} />
      <button className="btn btn-soft" type="button" disabled={busy || !v.trim()} onClick={() => void call(url, "POST", { [field]: v.trim() })}>
        Felvétel
      </button>
      <Msg msg={msg} />
    </div>
  );
}

export function NewFeed({ types, units }: { types: Opt[]; units: { id: string; symbol: string; dimension: string }[] }) {
  const usable = units.filter((u) => ["MASS", "COUNT", "VOLUME"].includes(u.dimension));
  const [f, setF] = useState({ typeId: types[0]?.id ?? "", name: "", unit: usable[0]?.id ?? "", count: false });
  const { msg, busy, call } = useApi();
  const unit = usable.find((u) => u.id === f.unit);
  if (types.length === 0)
    return (
      <p className="banner banner-warn" data-testid="new-feed">
        Még nincs egyetlen takarmánytípus sem, ezért takarmány sem vehető fel. A típusokat az alapadatok betöltése hozza létre.
      </p>
    );
  return (
    <div className="toolbar" data-testid="new-feed">
      <select className="input" aria-label="Takarmánytípus" value={f.typeId} onChange={(e) => setF({ ...f, typeId: e.target.value })}>
        {types.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <input className="input" aria-label="Takarmány neve" placeholder="takarmány neve" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <select className="input" aria-label="Alapértelmezett egység" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
        {usable.map((u) => (
          <option key={u.id} value={u.id}>
            {u.symbol}
          </option>
        ))}
      </select>
      <label className="check">
        <input type="checkbox" checked={f.count} onChange={(e) => setF({ ...f, count: e.target.checked })} />
        darabban is
      </label>
      <button
        className="btn"
        type="button"
        disabled={busy || !unit || !f.typeId || !f.name.trim()}
        onClick={() =>
          void call("/api/admin/feeds", "POST", {
            typeId: f.typeId,
            name: f.name,
            defaultUnitId: f.unit,
            dimensions: [...new Set([unit!.dimension, ...(f.count ? ["COUNT"] : [])])],
          }, "Takarmány felvéve.")
        }
      >
        Felvétel
      </button>
      <Msg msg={msg} />
    </div>
  );
}

export function FeedActive({ id, active }: { id: string; active: boolean }) {
  const { msg, busy, call } = useApi();
  return (
    <>
      <button className="btn btn-soft" type="button" disabled={busy} onClick={() => void call(`/api/admin/feeds/${id}`, "PATCH", { active: !active }, active ? "Inaktiválva." : "Újra aktív.")}>
        {active ? "Inaktiválás" : "Aktiválás"}
      </button>{" "}
      <Msg msg={msg} />
    </>
  );
}

/**
 * The description's starting animals by one admin click (acrobot 33380). The status line says how many are in and,
 * when the start did not load them, which condition was false, so the next fault is visible, not guessed.
 */
export function InitialAnimalsLoader(p: { total: number; loaded: number; switchOn: boolean; markOn: boolean }) {
  const { msg, busy, call } = useApi();
  const why =
    p.loaded >= p.total
      ? "mind bent van."
      : p.switchOn || p.markOn
        ? `az induláskori betöltés feltétele igaz (${p.switchOn ? "CAPARIUM_SEED_SZINTETIKUS=1" : "van szintetikus seed-érkezés"}), mégis hiányzik ${p.total - p.loaded}.`
        : "induláskor nem töltött be magától, mert a CAPARIUM_SEED_SZINTETIKUS nem 1, és az adatbázisban nincs szintetikus seed-érkezés (seed-arrival-1).";
  return (
    <div data-testid="initial-animals">
      <p className="hint" data-testid="initial-animals-status">
        A leírás kezdő állatlistájából {p.loaded} / {p.total} állat van bent; {why}
      </p>
      {p.loaded < p.total && (
        <p className="toolbar">
          <button className="btn" type="button" disabled={busy} onClick={() => void call("/api/admin/initial-animals", "POST", {}, "Kezdő állatlista betöltve.")}>
            Kezdő állatlista betöltése a leírásból
          </button>{" "}
          <Msg msg={msg} />
        </p>
      )}
      <p className="hint">
        A hiányzókat a medencéjükbe és csoportjukba veszi fel, 2026-01-01-i érkezéssel (a leírás kezdőállapota). Kétszer
        nem tölt be semmit; egy azonos nevű, kézzel felvett állat másik állatnak számít. Éles rendszerben az állatokat a
        valódi érkezéssel kell felvenni.
      </p>
    </div>
  );
}
