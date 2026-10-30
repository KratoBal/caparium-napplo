"use client";

// ADA-01..ADA-03, ADA-06, JAV-09: a dosing (the form stays for the next line of the day, ADA-03), and the
// admin's intake, correction and new chemical. The server decides every permission.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useKeepRow } from "./InactiveListFilter";
import { askReason, useReasonsOn } from "./ReasonSwitch";

type Opt = { id: string; name: string };
export type ChemicalOpt = { id: string; name: string; units: { id: string; symbol: string }[] };

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

function useSend() {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(url: string, body: Record<string, unknown>, okText: string, method = "POST") {
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

export function DosingForm({ pools, chemicals }: { pools: Opt[]; chemicals: ChemicalOpt[] }) {
  const [pool, setPool] = useState(pools[0]?.id ?? "");
  const [chemId, setChemId] = useState(chemicals[0]?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [unitId, setUnitId] = useState("");
  const [time, setTime] = useState(nowLocal());
  const { msg, busy, run } = useSend();
  const chem = chemicals.find((c) => c.id === chemId);
  const unit = chem?.units.find((u) => u.id === unitId)?.id ?? chem?.units[0]?.id ?? "";
  return (
    <div className="toolbar" data-testid="dosing-form">
      <label className="field">
        Időpont
        <input className="input" type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Időpont" />
      </label>
      <label className="field">
        Medence
        <select className="input" value={pool} onChange={(e) => setPool(e.target.value)} aria-label="Medence">
          {pools.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Szer
        <select className="input" value={chemId} onChange={(e) => setChemId(e.target.value)} aria-label="Szer">
          {chemicals.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Mennyiség
        <span style={{ display: "flex", gap: 6 }}>
          <input className="input" inputMode="decimal" style={{ width: 110 }} value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-label="Mennyiség" />
          <select className="input" value={unit} onChange={(e) => setUnitId(e.target.value)} aria-label="Egység">
            {chem?.units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.symbol}
              </option>
            ))}
          </select>
        </span>
      </label>
      <button
        className="btn"
        type="button"
        disabled={busy}
        onClick={() =>
          void run("/api/dosings", { performedAtLocal: time, poolId: pool, chemicalId: chemId, quantity: quantity.replace(",", "."), unitId: unit }, "Adagolás mentve.").then((ok) => ok && setQuantity(""))
        }
      >
        + Adagolás mentése
      </button>
      <Msg msg={msg} />
    </div>
  );
}

export type DosingRowEdit = { id: string; version: number; atLocal: string; poolId: string; chemicalId: string; quantity: string; unitId: string };

/**
 * "Javítás" in a dosing log row (Lili 2026-10-30 19:34 UTC, msg 1565811224229453956, card f5f97479: "csak érvényteleníteni lehet, azt nem ha
 * elírta, az értéket"): the amount, the unit, the chemical and the pool of a row can be corrected. It is the server's own change of a dosing
 * (saveDosing with its id and version: the row is updated in place, its stock movement with it in the same transaction, the audit row says
 * before and after), the same way a feeding sheet cell is corrected; the time stays. Offered only where the row's chemical and pool are
 * still active (the server refuses an inactive one).
 */
export function DosingEdit({ row, pools, chemicals }: { row: DosingRowEdit; pools: Opt[]; chemicals: ChemicalOpt[] }) {
  const [open, setOpen] = useState(false);
  const [pool, setPool] = useState(row.poolId);
  const [chemId, setChemId] = useState(row.chemicalId);
  const [quantity, setQuantity] = useState(row.quantity.replace(".", ","));
  const [unitId, setUnitId] = useState(row.unitId);
  const [reason, setReason] = useState("");
  const { msg, busy, run } = useSend();
  const reasonsOn = useReasonsOn();
  const chem = chemicals.find((c) => c.id === chemId);
  const unit = chem?.units.find((u) => u.id === unitId)?.id ?? chem?.units[0]?.id ?? "";
  if (!pools.some((p) => p.id === row.poolId) || !chemicals.some((c) => c.id === row.chemicalId)) return null;
  if (!open) {
    return (
      <span>
        <button className="btn btn-row" type="button" onClick={() => setOpen(true)}>
          Javítás
        </button>
        <Msg msg={msg} />
      </span>
    );
  }
  return (
    <div className="toolbar" data-testid={`dosing-edit-${row.id}`} style={{ margin: 0 }}>
      <select className="input" value={pool} onChange={(e) => setPool(e.target.value)} aria-label="Medence (javítás)">
        {pools.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select className="input" value={chemId} onChange={(e) => setChemId(e.target.value)} aria-label="Szer (javítás)">
        {chemicals.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <input className="input" inputMode="decimal" style={{ width: 100 }} value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-label="Mennyiség (javítás)" />
      <select className="input" value={unit} onChange={(e) => setUnitId(e.target.value)} aria-label="Egység (javítás)">
        {chem?.units.map((u) => (
          <option key={u.id} value={u.id}>
            {u.symbol}
          </option>
        ))}
      </select>
      {reasonsOn && <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Indoklás" aria-label="Indoklás (javítás)" />}
      <button
        className="btn"
        type="button"
        disabled={busy}
        onClick={() =>
          void run(
            "/api/dosings",
            {
              dosingId: row.id,
              expectedVersion: row.version,
              performedAtLocal: row.atLocal,
              poolId: pool,
              chemicalId: chemId,
              quantity: quantity.replace(",", "."),
              unitId: unit,
              ...(reason.trim() ? { reason: reason.trim() } : {}),
            },
            "Javítva.",
          ).then((ok) => ok && setOpen(false))
        }
      >
        Mentés
      </button>
      <button className="btn btn-soft" type="button" disabled={busy} onClick={() => setOpen(false)}>
        Mégse
      </button>
      <Msg msg={msg} />
    </div>
  );
}

export function MovementForm({ chemicals }: { chemicals: ChemicalOpt[] }) {
  const [chemId, setChemId] = useState(chemicals[0]?.id ?? "");
  const [kind, setKind] = useState<"INTAKE" | "PLUS" | "MINUS">("INTAKE");
  const [quantity, setQuantity] = useState("");
  const [unitId, setUnitId] = useState("");
  const [note, setNote] = useState("");
  const { msg, busy, run } = useSend();
  const chem = chemicals.find((c) => c.id === chemId);
  const unit = chem?.units.find((u) => u.id === unitId)?.id ?? chem?.units[0]?.id ?? "";
  return (
    <div className="toolbar" data-testid="movement-form">
      <select className="input" value={chemId} onChange={(e) => setChemId(e.target.value)} aria-label="Vegyszer (készlet)">
        {chemicals.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select className="input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Mozgás">
        <option value="INTAKE">Bevételezés</option>
        <option value="PLUS">Leltárkorrekció +</option>
        <option value="MINUS">Leltárkorrekció −</option>
      </select>
      <input className="input" inputMode="decimal" style={{ width: 110 }} value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-label="Készlet mennyiség" />
      <select className="input" value={unit} onChange={(e) => setUnitId(e.target.value)} aria-label="Készlet egység">
        {chem?.units.map((u) => (
          <option key={u.id} value={u.id}>
            {u.symbol}
          </option>
        ))}
      </select>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Megjegyzés" aria-label="Készlet megjegyzés" />
      <button
        className="btn btn-soft"
        type="button"
        disabled={busy}
        onClick={() =>
          void run(
            "/api/stock-movements",
            { chemicalId: chemId, quantity: quantity.replace(",", "."), unitId: unit, type: kind === "INTAKE" ? "INTAKE" : "CORRECTION", negative: kind === "MINUS", ...(note.trim() ? { note: note.trim() } : {}) },
            "Készlet rögzítve.",
          ).then((ok) => ok && setQuantity(""))
        }
      >
        Rögzítés
      </button>
      <Msg msg={msg} />
    </div>
  );
}

export type ChemicalRow = { id: string; name: string; unitId: string; active: boolean; uses: number };

/** Lili 2026-10-28 16:06 UTC: an inactive chemical is not offered for a dosing or a stock line; its history stays. */
export function ChemicalActive({ chem }: { chem: ChemicalRow }) {
  const { msg, busy, run } = useSend();
  // the row stays in view after the switch (InactiveListFilter, package item 16): its message is read
  const keep = useKeepRow();
  return (
    <>
      <button
        className="btn btn-row"
        type="button"
        disabled={busy}
        aria-label={`${chem.name}: ${chem.active ? "inaktiválás" : "aktiválás"}`}
        onClick={() => {
          keep(chem.id);
          void run(`/api/admin/chemicals/${chem.id}`, { active: !chem.active }, chem.active ? "Inaktiválva." : "Újra aktív.", "PATCH");
        }}
      >
        {chem.active ? "Inaktiválás" : "Aktiválás"}
      </button>
      <Msg msg={msg} />
    </>
  );
}

/**
 * A chemical of the list changed, the feeds' way (FeedEdit): the name is a CORRECTION, it shows on the earlier days too;
 * the stock unit only while nothing was recorded with the chemical, and the server checks it again.
 */
export function ChemicalEdit({ chem, units }: { chem: ChemicalRow; units: Opt[] }) {
  const start = { name: chem.name, unit: chem.unitId };
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(start);
  const { msg, busy, run } = useSend();
  const reasonsOn = useReasonsOn();
  const locked = chem.uses > 0;
  if (!open)
    return (
      <button
        className="btn btn-row"
        type="button"
        aria-label={`${chem.name}: módosítás`}
        onClick={() => {
          setF(start);
          setOpen(true);
        }}
      >
        Módosítás
      </button>
    );
  const renamed = f.name.trim() !== chem.name;
  const unitChanged = f.unit !== chem.unitId;
  async function save() {
    const body: Record<string, unknown> = {};
    if (renamed) {
      const asked = askReason(
        reasonsOn,
        "Az átnevezés oka (a korábbi napokon is az új név áll):",
        `Átnevezed: ${chem.name} -> ${f.name.trim()}? A korábbi napokon is az új név fog állni.`,
      );
      if (!asked) return;
      Object.assign(body, { name: f.name.trim(), mode: "correction" }, asked);
    }
    if (unitChanged) body.stockUnitId = f.unit;
    if (await run(`/api/admin/chemicals/${chem.id}`, body, "Vegyszer módosítva.", "PATCH")) setOpen(false);
  }
  return (
    <div className="toolbar" data-testid={`chemical-edit-${chem.id}`}>
      <input className="input" aria-label="Vegyszer új neve" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <select className="input" aria-label="Készlet egysége" value={f.unit} disabled={locked} onChange={(e) => setF({ ...f, unit: e.target.value })}>
        {units.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
      {locked && <span className="hint">Tétel van rá, a készlet egysége nem változtatható.</span>}
      <button className="btn" type="button" disabled={busy || !f.name.trim() || (!renamed && !unitChanged)} onClick={() => void save()}>
        Mentés
      </button>
      <button className="btn btn-soft" type="button" disabled={busy} onClick={() => setOpen(false)}>
        Mégse
      </button>
      <Msg msg={msg} />
    </div>
  );
}

export function NewChemical({ units }: { units: Opt[] }) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState(units[0]?.id ?? "");
  const { msg, busy, run } = useSend();
  return (
    <div className="toolbar" data-testid="new-chemical">
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Új vegyszer neve" aria-label="Új vegyszer neve" />
      <select className="input" value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Készlet egysége">
        {units.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
      <button className="btn btn-soft" type="button" disabled={busy} onClick={() => void run("/api/admin/chemicals", { name: name.trim(), stockUnitId: unit }, "Vegyszer felvéve.").then((ok) => ok && setName(""))}>
        Felvétel
      </button>
      <Msg msg={msg} />
    </div>
  );
}
