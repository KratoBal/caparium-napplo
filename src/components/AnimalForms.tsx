"use client";

// Forms of the animal and feed master data (DAT-01, DAT-02, DAT-05). The server decides every
// permission; these only send what the user picked.
import { useKeepRow } from "./InactiveListFilter";
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
  async function call(url: string, method: string, body: Record<string, unknown>, okText = "Mentve.", onOk?: (answer: Record<string, unknown>) => void | Promise<void>) {
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
      await onOk?.(b as Record<string, unknown>);
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

/**
 * A group an event (or a members step) left without a member: the page asks whether to switch it off (Lili 2026-10-30, task
 * caparium-csoport-inaktiv; acrobot 38970); never by itself, and a "no" leaves the switch on the Állatok page.
 */
async function askAboutEmptied(answer: Record<string, unknown>) {
  const emptied = Array.isArray(answer.emptiedGroups) ? (answer.emptiedGroups as { id: string; name: string }[]) : [];
  for (const g of emptied) {
    if (window.confirm(`A(z) ${g.name} csoport kiürült. Inaktiválod?`)) {
      const res = await fetch(`/api/admin/animal-groups/${g.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: requestId(), active: false }),
      }).catch(() => null);
      if (!res?.ok) {
        const b = (await res?.json().catch(() => ({}))) as { error?: { message?: string } } | undefined;
        window.alert(b?.error?.message ?? `A(z) ${g.name} csoportot nem sikerült inaktiválni: az Állatok oldalon a Csoportok listában próbáld újra.`);
      }
    }
  }
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
          }, `${ACTION_LABEL[type]} rögzítve.`, askAboutEmptied)
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
  // the row stays in view after the switch (InactiveListFilter, as the pools of #107): its message is read
  const keep = useKeepRow();
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

/**
 * Lili 2026-11-01 (point 14): a feed's feeding periods, the admin's: from a day, to a day or open (empty "Meddig"), as many as
 * needed, corrected at any time. Saved together; overlapping periods are refused by the server with the reason.
 */
export function FeedPeriods({ id, name, periods }: { id: string; name: string; periods: { firstDay: string; lastDay: string | null }[] }) {
  const { msg, busy, call } = useApi();
  const keep = useKeepRow();
  const [rows, setRows] = useState(periods.map((p) => ({ from: p.firstDay, to: p.lastDay ?? "" })));
  const set = (i: number, k: "from" | "to", v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const shown = periods.length ? periods.map((p) => `${p.firstDay.replaceAll("-", ".")}. – ${p.lastDay ? `${p.lastDay.replaceAll("-", ".")}.` : ""}`).join(", ") : "nincs";
  return (
    <details className="feed-periods" data-testid={`feed-periods-${id}`}>
      <summary>Időszakok: {shown}</summary>
      {rows.map((r, i) => (
        <div className="toolbar" key={i}>
          <label className="field">
            Mettől
            <input className="input" type="date" aria-label={`${name} időszak ${i + 1} kezdete`} value={r.from} onChange={(e) => set(i, "from", e.target.value)} />
          </label>
          <label className="field">
            Meddig (üresen: nyitott)
            <input className="input" type="date" aria-label={`${name} időszak ${i + 1} vége`} value={r.to} onChange={(e) => set(i, "to", e.target.value)} />
          </label>
          <button className="btn btn-row" type="button" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
            Törlés
          </button>
        </div>
      ))}
      <div className="toolbar">
        <button className="btn btn-soft" type="button" onClick={() => setRows((x) => [...x, { from: "", to: "" }])}>
          + Időszak
        </button>
        <button
          className="btn"
          type="button"
          disabled={busy || rows.some((r) => !r.from)}
          onClick={() => {
            keep(id);
            void call(`/api/admin/feeds/${id}/periods`, "PUT", { periods: rows.map((r) => ({ firstDay: r.from, lastDay: r.to || null })) }, "Időszakok mentve.");
          }}
        >
          Időszakok mentése
        </button>
        <Msg msg={msg} />
      </div>
    </details>
  );
}

/** The switch of a group on the Állatok page (Lili 2026-10-30, task caparium-csoport-inaktiv): the feeds' button, with the server's answer when the group still has members. */
export function GroupActive({ id, active }: { id: string; active: boolean }) {
  const { msg, busy, call } = useApi();
  const keep = useKeepRow();
  return (
    <>
      <button
        className="btn btn-row"
        type="button"
        disabled={busy}
        onClick={() => {
          keep(id);
          void call(`/api/admin/animal-groups/${id}`, "PATCH", { active: !active }, active ? "Inaktiválva." : "Újra aktív.");
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

type MemberAnimal = { id: string; name: string; groupId: string | null; groupName: string | null };

/** One membership of the group, its two ends and the events that made them (`groupMemberships` in animals.ts). */
export type MembershipRow = {
  animalId: string;
  animalName: string;
  /** the moments, as the page shows them (Budapest) and as the date field takes them */
  fromText: string;
  fromLocal: string;
  toText: string | null;
  toLocal: string | null;
  start: { id: string; version: number; type: string };
  end: { id: string; version: number; type: string } | null;
};

/**
 * A membership's start or end moved (acrobot 45654): the moment of the group change that made it is corrected (an EVENT
 * correction on the server: the old one invalidated, the same one at the new moment). Only a group change: an arrival's moment is
 * the arrival's own, a death's or a release's is not changed here. A reason always.
 */
function MembershipTime({ event, local, label }: { event: { id: string; version: number }; local: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(local);
  const [reason, setReason] = useState("");
  const { msg, busy, call } = useApi();
  if (!open)
    return (
      <button className="btn btn-row" type="button" onClick={() => setOpen(true)} aria-label={label}>
        Módosítás
      </button>
    );
  return (
    <span className="toolbar">
      <input className="input" type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} aria-label={`${label}: új időpont`} />
      <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-label={`${label}: indoklás`} placeholder="Indoklás" />
      <button
        className="btn btn-row"
        type="button"
        disabled={busy || reason.trim().length < 3 || time === local}
        onClick={() =>
          void call(`/api/animals/events/${event.id}/correct-time`, "POST", { expectedVersion: event.version, occurredAtLocal: time, reason: reason.trim() }, "Időpont javítva.")
        }
      >
        Mentés
      </button>
      <Msg msg={msg} />
    </span>
  );
}

/**
 * A group's members in one place (Lili 2026-11-10, card b98016a1 S1): who is in it now, and several animals put in or taken out at ONE
 * moment, in one step (the server writes one group change per animal, as if each had been done on its own). The moment may be in the
 * past: the feeding sheets follow it. Admins only today (the server checks it again).
 */
export function GroupMembers({
  group,
  animals,
  memberships = [],
}: {
  group: { id: string; name: string; active: boolean };
  animals: MemberAnimal[];
  memberships?: MembershipRow[];
}) {
  const members = animals.filter((a) => a.groupId === group.id);
  const others = animals.filter((a) => a.groupId !== group.id);
  const [add, setAdd] = useState<Set<string>>(new Set());
  const [remove, setRemove] = useState<Set<string>>(new Set());
  const [time, setTime] = useState(nowLocal());
  const [reason, setReason] = useState("");
  const { msg, busy, call } = useApi();
  const reasonsOn = useReasonsOn();
  // the panel's content only while it is open: closed, the row reads as before (its text is the group's, not every animal's)
  const [open, setOpen] = useState(false);
  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };
  return (
    <details data-testid={`group-members-${group.id}`} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>Tagok ({members.length})</summary>
      {open && (
        <>
      <div className="table-scroll">
        <table className="log-table" data-testid={`group-memberships-${group.id}`}>
          <thead>
            <tr><th>Állat</th><th>Tagja ettől</th><th></th><th>Eddig</th><th></th></tr>
          </thead>
          <tbody>
            {memberships.map((m) => (
              <tr key={`${m.animalId}-${m.start.id}`}>
                <td>{m.animalName}</td>
                <td>{m.fromText}</td>
                <td className="keep">
                  {m.start.type === "GROUP_CHANGE" ? (
                    <MembershipTime event={m.start} local={m.fromLocal} label={`${m.animalName}: a tagság kezdete`} />
                  ) : (
                    <span className="hint">érkezéskor</span>
                  )}
                </td>
                <td>{m.toText ?? "most is"}</td>
                <td className="keep">
                  {m.end && m.toLocal && m.end.type === "GROUP_CHANGE" ? (
                    <MembershipTime event={m.end} local={m.toLocal} label={`${m.animalName}: a tagság vége`} />
                  ) : m.end ? (
                    <span className="hint">{m.end.type === "DEATH" ? "elhullás" : m.end.type === "RELEASE" ? "kiadás" : ""}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <fieldset className="field">
        <legend>Most a csoportban (pipáld, akit kiveszel)</legend>
        {members.length === 0 && <span className="hint">Nincs tagja.</span>}
        {members.map((a) => (
          <label key={a.id} className="check">
            <input type="checkbox" checked={remove.has(a.id)} onChange={() => toggle(remove, setRemove, a.id)} aria-label={`Kivesz: ${a.name}`} /> {a.name}
          </label>
        ))}
      </fieldset>
      {group.active && (
        <fieldset className="field">
          <legend>Betesz (élő állatok)</legend>
          {others.map((a) => (
            <label key={a.id} className="check">
              <input type="checkbox" checked={add.has(a.id)} onChange={() => toggle(add, setAdd, a.id)} aria-label={`Betesz: ${a.name}`} /> {a.name}
              {a.groupName ? <span className="hint"> (most: {a.groupName})</span> : null}
            </label>
          ))}
        </fieldset>
      )}
      <label className="field">
        Időpont
        <input className="input" type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} aria-label={`${group.name}: a változás időpontja`} />
      </label>
      {reasonsOn && (
        <label className="field">
          Indoklás (korábbi napnál)
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-label={`${group.name}: indoklás`} />
        </label>
      )}
      <button
        className="btn"
        type="button"
        disabled={busy || add.size + remove.size === 0}
        onClick={() =>
          void call(
            `/api/admin/animal-groups/${group.id}/members`,
            "POST",
            { add: [...add], remove: [...remove], occurredAtLocal: time, ...(reason.trim() ? { reason: reason.trim() } : {}) },
            `${add.size} állat be, ${remove.size} ki: rögzítve.`,
            async (answer) => {
              setAdd(new Set());
              setRemove(new Set());
              // the group card asks about an emptied group as the single group change does (card b98016a1)
              await askAboutEmptied(answer);
            },
          )
        }
      >
        Tagok mentése
      </button>
        </>
      )}
      <Msg msg={msg} />
    </details>
  );
}
