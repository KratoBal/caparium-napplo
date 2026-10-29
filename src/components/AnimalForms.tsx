"use client";

// Forms of the animal and feed master data (DAT-01, DAT-02, DAT-05). The server decides every
// permission; these only send what the user picked.
import { useKeepFeedRow } from "./FeedListFilter";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { askReason, useReasonsOn } from "./ReasonSwitch";

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
  const reasonsOn = useReasonsOn();
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
      {reasonsOn && (
        <label className="field">
          Indoklás (korábbi napnál)
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Indoklás" />
        </label>
      )}
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
  const reasonsOn = useReasonsOn();
  return (
    <>
      <button
        className="btn btn-soft"
        type="button"
        disabled={busy}
        onClick={() => {
          const asked = askReason(reasonsOn, "Az érvénytelenítés oka:", "Érvényteleníted ezt az eseményt?");
          if (asked) void call(`/api/animals/events/${eventId}/invalidate`, "POST", { expectedVersion: version, ...asked }, "Érvénytelenítve.");
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
  const reasonsOn = useReasonsOn();
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
      {reasonsOn && (
        <input className="input" placeholder="indoklás (korábbi napnál)" aria-label="Indoklás az érkezéshez" value={f.reason} onChange={set("reason")} />
      )}
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
  // the row stays in view after the switch (FeedListFilter, as the pools of #107): its message is read
  const keep = useKeepFeedRow();
  return (
    <>
      <button
        className="btn btn-row"
        type="button"
        disabled={busy}
        onClick={() => {
          keep(id);
          void call(`/api/admin/feeds/${id}`, "PATCH", { active: !active }, active ? "Inaktiválva." : "Újra aktív.");
        }}
      >
        {active ? "Inaktiválás" : "Aktiválás"}
      </button>
      <Msg msg={msg} />
    </>
  );
}

export type FeedRow = { id: string; name: string; dimensions: string[]; defaultUnitId: string; uses: number; dose?: { value: string; unitId: string } | null };

/**
 * Lili 2026-10-27 22:42 and 22:45 UTC: a feed of the list can be changed, a small quiet "Módosítás" beside the
 * activation, as on the withdrawal rows. The name is a CORRECTION: it shows on every day, the earlier ones too (the
 * ZIMS export does not carry feed names, Lili 22:48 UTC). The unit and the dimensions only while nothing was recorded
 * with the feed; the server checks it again.
 */
export function FeedEdit({ feed, units }: { feed: FeedRow; units: { id: string; symbol: string; dimension: string }[] }) {
  const usable = units.filter((u) => ["MASS", "COUNT", "VOLUME"].includes(u.dimension));
  // package item 3: the base amount the feeding sheet's tick records, in one of the feed's own dimensions
  const doseUnits = usable.filter((u) => feed.dimensions.includes(u.dimension));
  const start = {
    name: feed.name,
    unit: feed.defaultUnitId,
    count: feed.dimensions.includes("COUNT"),
    dose: feed.dose ? feed.dose.value.replace(".", ",") : "",
    doseUnit: feed.dose?.unitId ?? feed.defaultUnitId,
  };
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(start);
  const { msg, busy, call } = useApi();
  const reasonsOn = useReasonsOn();
  const unit = usable.find((u) => u.id === f.unit);
  const locked = feed.uses > 0;
  if (!open)
    return (
      <button
        className="btn btn-row"
        type="button"
        aria-label={`${feed.name}: módosítás`}
        onClick={() => {
          setF(start);
          setOpen(true);
        }}
      >
        Módosítás
      </button>
    );
  const renamed = f.name.trim() !== feed.name;
  const dimensions = unit ? [...new Set([unit.dimension, ...(f.count ? ["COUNT"] : [])])] : [];
  const unitChanged = f.unit !== feed.defaultUnitId || [...dimensions].sort().join() !== [...feed.dimensions].sort().join();
  const doseChanged = f.dose.trim() !== start.dose || (f.dose.trim() !== "" && f.doseUnit !== start.doseUnit);
  async function save() {
    const body: Record<string, unknown> = {};
    if (renamed) {
      const asked = askReason(
        reasonsOn,
        "Az átnevezés oka (a korábbi napokon is az új név áll):",
        `Átnevezed: ${feed.name} -> ${f.name.trim()}? A korábbi napokon is az új név fog állni.`,
      );
      if (!asked) return;
      Object.assign(body, { name: f.name.trim(), mode: "correction" }, asked);
    }
    if (unitChanged) Object.assign(body, { defaultUnitId: f.unit, dimensions });
    if (doseChanged) body.dose = f.dose.trim() ? { value: f.dose.trim(), unitId: f.doseUnit } : null;
    if (await call(`/api/admin/feeds/${feed.id}`, "PATCH", body, "Takarmány módosítva.")) setOpen(false);
  }
  return (
    <div className="toolbar toolbar-end" data-testid={`feed-edit-${feed.id}`}>
      <input className="input" aria-label="Takarmány új neve" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <select className="input" aria-label="Alapértelmezett egység" value={f.unit} disabled={locked} onChange={(e) => setF({ ...f, unit: e.target.value })}>
        {usable.map((u) => (
          <option key={u.id} value={u.id}>
            {u.symbol}
          </option>
        ))}
      </select>
      <label className="check">
        <input type="checkbox" checked={f.count} disabled={locked} onChange={(e) => setF({ ...f, count: e.target.checked })} />
        darabban is
      </label>
      {locked && <span className="hint">Tétel van rá, a mértékegysége nem változtatható.</span>}
      <label className="field">
        Pipa = alapmennyiség
        <input className="input" inputMode="decimal" aria-label="Alapmennyiség a pipához" placeholder="nincs" value={f.dose} onChange={(e) => setF({ ...f, dose: e.target.value })} />
      </label>
      <select className="input" aria-label="Az alapmennyiség egysége" value={f.doseUnit} onChange={(e) => setF({ ...f, doseUnit: e.target.value })}>
        {doseUnits.map((u) => (
          <option key={u.id} value={u.id}>
            {u.symbol}
          </option>
        ))}
      </select>
      <button className="btn" type="button" disabled={busy || !f.name.trim() || !unit || (!renamed && !unitChanged && !doseChanged)} onClick={() => void save()}>
        Mentés
      </button>
      <button className="btn btn-soft" type="button" disabled={busy} onClick={() => setOpen(false)}>
        Mégse
      </button>
      <Msg msg={msg} />
    </div>
  );
}

/**
 * The description's starting animals by one admin click (acrobot 33380). The status line says how many are in and,
 * when the start did not load them, which condition was false, so the next fault is visible, not guessed.
 */
export function InitialAnimalsLoader(p: { total: number; loaded: number; switchOn: boolean; markOn: boolean }) {
  const { msg, busy, call } = useApi();
  // the arrival day is the admin's (acrobot 33395): today by default, never a made-up date
  const [day, setDay] = useState(() => nowLocal().slice(0, 10));
  const missing = p.total - p.loaded;
  const load = () => {
    if (!day) return;
    if (!window.confirm(`${missing} állatot veszel fel a leírás kezdő listájából, ${day} napi érkezéssel, a medencéjükbe és csoportjukba. Folytatod?`)) return;
    void call("/api/admin/initial-animals", "POST", { arrivalDay: day }, "Kezdő állatlista betöltve.");
  };
  const why =
    p.loaded >= p.total
      ? "mind bent van."
      : p.switchOn || p.markOn
        ? `az induláskori betöltés feltétele most igaz (${p.switchOn ? "CAPARIUM_SEED_SZINTETIKUS=1" : "van szintetikus seed-érkezés"}), de a legutóbbi indulás óta nem futott le: a következő induláskor magától betöltődik, a gomb most tölti be.`
        : "induláskor nem töltött be magától, mert a CAPARIUM_SEED_SZINTETIKUS nem 1, és az adatbázisban nincs szintetikus seed-érkezés (seed-arrival-1).";
  return (
    <div data-testid="initial-animals">
      <p className="hint" data-testid="initial-animals-status">
        A leírás kezdő állatlistájából {p.loaded} / {p.total} állat van bent; {why}
      </p>
      <p className="toolbar">
        {p.loaded < p.total && (
          <>
            <label className="field">
              Érkezés napja
              <input className="input" type="date" required aria-label="Érkezés napja" value={day} onChange={(e) => setDay(e.target.value)} />
            </label>
            <button className="btn" type="button" disabled={busy || !day} onClick={load}>
              Kezdő állatlista betöltése a leírásból
            </button>
          </>
        )}{" "}
        {/* outside the button's condition: after the refresh the button is gone, the result stays readable */}
        <Msg msg={msg} />
      </p>
    </div>
  );
}

export type AnimalEditView = {
  id: string;
  name: string;
  speciesId: string;
  sex: string;
  arrival: { version: number; local: string; poolId: string | null; groupId: string | null; note: string } | null;
};

/**
 * Editing an animal (caparium-hibak-5): every field given at the arrival. The name as a CHANGE (from now on) or a
 * CORRECTION (a typo, the past too); species and sex in place; the arrival (time, pool, group, note) corrected as a
 * past fact. A correction needs a reason. Where the animal is NOW stays a transfer or a group change.
 */
export function AnimalEditForm({ a, species, pools, groups }: { a: AnimalEditView; species: Opt[]; pools: Opt[]; groups: Opt[] }) {
  const init = {
    name: a.name,
    nameMode: "correction",
    speciesId: a.speciesId,
    sex: a.sex,
    time: a.arrival?.local ?? "",
    pool: a.arrival?.poolId ?? "",
    group: a.arrival?.groupId ?? "",
    note: a.arrival?.note ?? "",
    reason: "",
  };
  const [f, setF] = useState(init);
  const { msg, busy, call } = useApi();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const arrivalChanged = !!a.arrival && (f.time !== init.time || f.pool !== init.pool || f.group !== init.group || f.note !== init.note);
  const nameChanged = f.name.trim() !== a.name;
  const changed = nameChanged || f.speciesId !== a.speciesId || f.sex !== a.sex || arrivalChanged;
  const reasonsOn = useReasonsOn();
  const needsReason = reasonsOn && (arrivalChanged || (nameChanged && f.nameMode === "correction"));
  function save() {
    const body: Record<string, unknown> = {};
    if (nameChanged) {
      body.name = f.name.trim();
      body.nameMode = f.nameMode;
    }
    if (f.speciesId !== a.speciesId) body.speciesId = f.speciesId;
    if (f.sex !== a.sex) body.sex = f.sex;
    if (arrivalChanged && a.arrival) {
      body.arrival = {
        expectedVersion: a.arrival.version,
        ...(f.time !== init.time ? { occurredAtLocal: f.time } : {}),
        ...(f.pool !== init.pool ? { toPoolId: f.pool } : {}),
        ...(f.group !== init.group ? { toGroupId: f.group || null } : {}),
        ...(f.note !== init.note ? { note: f.note.trim() || null } : {}),
      };
    }
    if (f.reason.trim()) body.reason = f.reason.trim();
    void call(`/api/animals/${a.id}`, "PATCH", body, "Az állat adatai mentve.").then((ok) => ok && setF((x) => ({ ...x, reason: "" })));
  }
  return (
    <div data-testid="animal-edit">
      <h3 style={{ marginTop: 20 }}>Adatok módosítása</h3>
      <div className="toolbar">
        <label className="field">
          Név
          <input className="input" aria-label="Név (módosítás)" value={f.name} onChange={set("name")} />
        </label>
        {nameChanged && (
          <label className="field">
            A névváltozás
            <select className="input" aria-label="A névváltozás fajtája" value={f.nameMode} onChange={set("nameMode")}>
              <option value="correction">Helyesbítés (elírás, visszamenőleg)</option>
              <option value="change">Változás (mostantól)</option>
            </select>
          </label>
        )}
        <label className="field">
          Faj
          <select className="input" aria-label="Faj (módosítás)" value={f.speciesId} onChange={set("speciesId")}>
            {species.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Nem
          <select className="input" aria-label="Nem (módosítás)" value={f.sex} onChange={set("sex")}>
            <option value="UNKNOWN">ismeretlen</option>
            <option value="MALE">hím</option>
            <option value="FEMALE">nőstény</option>
          </select>
        </label>
      </div>
      {a.arrival && (
        <div className="toolbar">
          <label className="field">
            Érkezés időpontja
            <input className="input" type="datetime-local" aria-label="Érkezés időpontja (módosítás)" value={f.time} onChange={set("time")} />
          </label>
          <label className="field">
            Érkezési medence
            <select className="input" aria-label="Érkezési medence (módosítás)" value={f.pool} onChange={set("pool")}>
              {pools.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Érkezési csoport
            <select className="input" aria-label="Érkezési csoport (módosítás)" value={f.group} onChange={set("group")}>
              <option value="">nincs csoport</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Megjegyzés
            <input className="input" aria-label="Érkezési megjegyzés (módosítás)" value={f.note} onChange={set("note")} />
          </label>
        </div>
      )}
      <p className="hint">
        {reasonsOn
          ? "Az érkezés adatai és a név helyesbítése a múltra is hatnak, ezért indoklás kell. "
          : "Az érkezés adatai és a név helyesbítése a múltra is hatnak. "}
        Ahol az állat most van, azt áthelyezéssel vagy csoportváltással rögzítsd, nem az érkezés javításával.
      </p>
      <div className="toolbar">
        {reasonsOn && (
          <input
            className="input"
            aria-label="Indoklás a módosításhoz"
            placeholder={needsReason ? "indoklás (kötelező)" : "indoklás"}
            value={f.reason}
            onChange={set("reason")}
          />
        )}
        <button className="btn" type="button" disabled={busy || !changed || (needsReason && f.reason.trim().length < 3)} onClick={save}>
          Módosítás mentése
        </button>
        <Msg msg={msg} />
      </div>
    </div>
  );
}
