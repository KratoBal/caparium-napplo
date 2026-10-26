"use client";

// Settings rows (Figma 25, 26): every save says whether it is a CHANGE (from now on, the past keeps
// the old value) or a CORRECTION (a typo, acts on the past too, reason required) — adatmodell K3.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useReasonsOn } from "./ReasonSwitch";

function requestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

async function post(url: string, method: string, body: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: requestId(), ...body }),
    });
    if (res.ok) return null;
    const b = (await res.json().catch(() => ({}))) as { error?: { message?: string; issues?: { message: string }[] } };
    return b.error?.issues?.[0]?.message ?? b.error?.message ?? "A mentés nem sikerült.";
  } catch {
    return "Nincs kapcsolat a szerverrel.";
  }
}

function useSave() {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  /** Resolves true when the save went through, so a form can empty itself only then. */
  async function save(url: string, method: string, body: Record<string, unknown>, okText = "Mentve."): Promise<boolean> {
    setBusy(true);
    const err = await post(url, method, body);
    setBusy(false);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: okText });
    if (!err) router.refresh();
    return err === null;
  }
  return { msg, busy, save };
}

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <span className={msg.ok ? "hint" : "err"} role="status">{msg.text}</span>;
}

function ModeSelect({ value, onChange, id }: { value: string; onChange: (v: "change" | "correction") => void; id: string }) {
  return (
    <select className="input" aria-label="A módosítás fajtája" data-testid={`mode-${id}`} value={value} onChange={(e) => onChange(e.target.value as "change" | "correction")}>
      <option value="change">Változás (mostantól)</option>
      <option value="correction">Helyesbítés (elírás, visszamenőleg)</option>
    </select>
  );
}

export function ReferenceRow(p: {
  parameterId: string;
  name: string;
  unit: string;
  min: string | null;
  max: string | null;
  /** a pool's own range (caparium-hibak-3); without it the common one */
  pool?: { id: string; name: string; inherited: boolean };
}) {
  const [min, setMin] = useState((p.min ?? "").replace(".", ","));
  const [max, setMax] = useState((p.max ?? "").replace(".", ","));
  const [mode, setMode] = useState<"change" | "correction">("change");
  const [reason, setReason] = useState("");
  const { msg, busy, save } = useSave();
  const reasonsOn = useReasonsOn();
  const label = p.pool ? `${p.pool.name} ${p.name}` : p.name;
  // an inherited range has no own version to correct: the first save of a pool is always a change
  const inherited = p.pool?.inherited ?? false;
  return (
    <tr data-testid={p.pool ? `ref-${p.pool.name}-${p.name}` : `ref-${p.name}`}>
      <td>
        <b>{p.name}</b>
        {inherited && <div className="hint">a közös érték</div>}
      </td>
      <td>{p.unit}</td>
      <td><input className="input small" aria-label={`${label} minimum`} inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} /></td>
      <td><input className="input small" aria-label={`${label} maximum`} inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} /></td>
      <td>{inherited ? <span className="hint">Változás (mostantól)</span> : <ModeSelect id={label} value={mode} onChange={setMode} />}</td>
      {reasonsOn && <td><input className="input" aria-label={`${label} indoklás`} placeholder={mode === "correction" && !inherited ? "indoklás (kötelező)" : "indoklás"} value={reason} onChange={(e) => setReason(e.target.value)} /></td>}
      <td>
        <button className="btn" type="button" disabled={busy} onClick={() => void save("/api/admin/reference", "POST", { parameterId: p.parameterId, ...(p.pool ? { poolId: p.pool.id } : {}), min: min || null, max: max || null, mode: inherited ? "change" : mode, ...(reason.trim() ? { reason: reason.trim() } : {}) })}>
          Mentés
        </button>{" "}
        <Msg msg={msg} />
      </td>
    </tr>
  );
}

/** caparium-hibak-3: a pool's volume in litres, the chemical calculator works with it. */
export function PoolVolumeForm(p: { poolId: string; name: string; volumeLiters: string | null }) {
  const [v, setV] = useState((p.volumeLiters ?? "").replace(".", ","));
  const { msg, busy, save } = useSave();
  const unchanged = v.trim() === (p.volumeLiters ?? "").replace(".", ",");
  return (
    <span className="toolbar" style={{ margin: 0 }}>
      <input className="input small" inputMode="decimal" aria-label={`${p.name} űrtartalma (liter)`} value={v} onChange={(e) => setV(e.target.value)} />
      <button className="btn btn-soft" type="button" disabled={busy || unchanged} onClick={() => void save("/api/admin/pool-volume", "POST", { poolId: p.poolId, volumeLiters: v.trim() ? v.trim().replace(",", ".") : null })}>
        Mentés
      </button>
      <Msg msg={msg} />
    </span>
  );
}

export function PoolRow(p: { poolId: string; name: string; groups: string }) {
  const [name, setName] = useState(p.name);
  const [mode, setMode] = useState<"change" | "correction">("change");
  const [reason, setReason] = useState("");
  const { msg, busy, save } = useSave();
  const reasonsOn = useReasonsOn();
  return (
    <tr data-testid={`pool-${p.name}`}>
      <td><input className="input" aria-label={`${p.name} új neve`} value={name} onChange={(e) => setName(e.target.value)} /></td>
      <td className="hint">{p.groups || "nincs vízmérés"}</td>
      <td><ModeSelect id={p.name} value={mode} onChange={setMode} /></td>
      {reasonsOn && <td><input className="input" aria-label={`${p.name} indoklás`} placeholder={mode === "correction" ? "indoklás (kötelező)" : "indoklás"} value={reason} onChange={(e) => setReason(e.target.value)} /></td>}
      <td>
        <button className="btn" type="button" disabled={busy || name.trim() === p.name} onClick={() => void save("/api/admin/pool-name", "POST", { poolId: p.poolId, name: name.trim(), mode, ...(reason.trim() ? { reason: reason.trim() } : {}) })}>
          Mentés
        </button>{" "}
        <Msg msg={msg} />
      </td>
    </tr>
  );
}

/** Lili 2026-10-26 (point 3): a new pool, admin only. Name, code, volume and at least one measurement group are needed; the icon is optional. */
export function NewPoolForm({ groups }: { groups: { id: string; name: string }[] }) {
  const empty = { name: "", code: "", volume: "", emoji: "", groupIds: [] as string[] };
  const [f, setF] = useState(empty);
  const { msg, busy, save } = useSave();
  const set = (k: "name" | "code" | "volume" | "emoji") => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const toggle = (id: string) => setF({ ...f, groupIds: f.groupIds.includes(id) ? f.groupIds.filter((g) => g !== id) : [...f.groupIds, id] });
  const ready = f.name.trim() !== "" && f.code.trim() !== "" && f.volume.trim() !== "" && f.groupIds.length > 0;
  return (
    <div data-testid="new-pool">
      <div className="toolbar">
        <input className="input" aria-label="Új medence neve" placeholder="név" value={f.name} onChange={set("name")} />
        <input className="input small" aria-label="Új medence kódja" placeholder="kód (pl. UJ_MEDENCE)" value={f.code} onChange={set("code")} />
        <input className="input small" inputMode="decimal" aria-label="Új medence űrtartalma (liter)" placeholder="liter" value={f.volume} onChange={set("volume")} />
        <input className="input" style={{ width: 90 }} aria-label="Új medence ikonja (nem kötelező)" placeholder="ikon" value={f.emoji} onChange={set("emoji")} />
      </div>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: "8px 0" }}>
        Mérési csoport (legalább egy)
        <span style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {groups.map((g) => (
            <label key={g.id} className="check">
              <input type="checkbox" checked={f.groupIds.includes(g.id)} onChange={() => toggle(g.id)} />
              {g.name}
            </label>
          ))}
        </span>
      </fieldset>
      <div className="toolbar">
        <button
          className="btn"
          type="button"
          disabled={busy || !ready}
          onClick={() =>
            void save(
              "/api/admin/pools",
              "POST",
              { name: f.name.trim(), code: f.code.trim(), volumeLiters: f.volume.trim().replace(",", "."), groupIds: f.groupIds, ...(f.emoji.trim() ? { emoji: f.emoji.trim() } : {}) },
              "Medence felvéve.",
            ).then((ok) => ok && setF(empty))
          }
        >
          Medence felvétele
        </button>
        <Msg msg={msg} />
      </div>
    </div>
  );
}

export function UserRow(p: { id: string; loginId: string; fullName: string; role: "AQUARIST" | "ADMIN"; active: boolean; monogram: string; zimsName: string; self: boolean }) {
  const [role, setRole] = useState(p.role);
  const [monogram, setMonogram] = useState(p.monogram);
  const [zimsName, setZimsName] = useState(p.zimsName);
  const [zimsNameMode, setZimsNameMode] = useState<"" | "CORRECTION" | "RENAME">("");
  const [password, setPassword] = useState("");
  const { msg, busy, save } = useSave();
  const body: Record<string, unknown> = {};
  if (role !== p.role) body.role = role;
  if (monogram.trim() !== p.monogram) body.monogram = monogram.trim();
  const zimsChanged = zimsName.trim() !== p.zimsName;
  // a meglévő név átírásakor el kell dönteni: elírás (visszamenőleg) vagy névváltozás (mostantól)
  const modeNeeded = zimsChanged && p.zimsName !== "";
  if (zimsChanged) body.zimsName = zimsName.trim();
  if (modeNeeded && zimsNameMode) body.zimsNameMode = zimsNameMode;
  if (password) body.password = password;
  return (
    <tr data-testid={`user-${p.loginId}`} className={p.active ? undefined : "invalid"}>
      <td className="keep"><b>{p.fullName}</b><div className="hint">{p.loginId}</div></td>
      <td className="keep">
        <select className="input" aria-label={`${p.loginId} szerep`} value={role} disabled={p.self} onChange={(e) => setRole(e.target.value as "AQUARIST" | "ADMIN")}>
          <option value="AQUARIST">Akvarista</option>
          <option value="ADMIN">Adminisztrátor</option>
        </select>
      </td>
      <td className="keep"><input className="input small" aria-label={`${p.loginId} monogram`} value={monogram} onChange={(e) => setMonogram(e.target.value)} /></td>
      <td className="keep">
        <input className="input" aria-label={`${p.loginId} ZIMS-név`} value={zimsName} onChange={(e) => setZimsName(e.target.value)} />
        {modeNeeded && (
          <select
            className="input"
            aria-label={`${p.loginId} ZIMS-név módosításának fajtája`}
            value={zimsNameMode}
            onChange={(e) => setZimsNameMode(e.target.value as "" | "CORRECTION" | "RENAME")}
          >
            <option value="">Elírás vagy névváltozás?</option>
            <option value="CORRECTION">Elírást javítok (a korábbi mérésekre is)</option>
            <option value="RENAME">A neve megváltozott (mostantól)</option>
          </select>
        )}
      </td>
      <td className="keep"><input className="input" type="password" autoComplete="new-password" aria-label={`${p.loginId} új jelszó`} placeholder="új jelszó" value={password} onChange={(e) => setPassword(e.target.value)} /></td>
      <td className="keep">
        <button
          className="btn"
          type="button"
          disabled={busy || Object.keys(body).length === 0 || (modeNeeded && !zimsNameMode)}
          onClick={() => void save(`/api/admin/users/${p.id}`, "PATCH", body).then(() => setPassword(""))}
        >
          Mentés
        </button>{" "}
        {!p.self && (
          <button className="btn btn-soft" type="button" disabled={busy} onClick={() => void save(`/api/admin/users/${p.id}`, "PATCH", { active: !p.active }, p.active ? "Inaktiválva." : "Újra aktív.")}>
            {p.active ? "Inaktiválás" : "Aktiválás"}
          </button>
        )}{" "}
        <Msg msg={msg} />
      </td>
    </tr>
  );
}

export function NewUserForm() {
  const [f, setF] = useState({ loginId: "", fullName: "", role: "AQUARIST", monogram: "", zimsName: "", password: "" });
  const { msg, busy, save } = useSave();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="toolbar" data-testid="new-user">
      <input className="input" aria-label="Új felhasználónév" placeholder="felhasználónév" value={f.loginId} onChange={set("loginId")} />
      <input className="input" aria-label="Teljes név" placeholder="teljes név" value={f.fullName} onChange={set("fullName")} />
      <select className="input" aria-label="Szerep" value={f.role} onChange={set("role")}>
        <option value="AQUARIST">Akvarista</option>
        <option value="ADMIN">Adminisztrátor</option>
      </select>
      <input className="input small" aria-label="Monogram" placeholder="monogram" value={f.monogram} onChange={set("monogram")} />
      <input className="input" aria-label="ZIMS-név" placeholder="ZIMS-név (betűre)" value={f.zimsName} onChange={set("zimsName")} />
      <input className="input" type="password" autoComplete="new-password" aria-label="Kezdő jelszó" placeholder="kezdő jelszó (min. 10)" value={f.password} onChange={set("password")} />
      <button className="btn" type="button" disabled={busy} onClick={() => void save("/api/admin/users", "POST", f, "Felhasználó létrehozva.")}>
        Felhasználó létrehozása
      </button>
      <Msg msg={msg} />
    </div>
  );
}

/** caparium-hibak-4: where "Vízmérés kiküldése" sends (one address). */
export function WaterReportRecipient({ email }: { email: string }) {
  const [v, setV] = useState(email);
  const { msg, busy, save } = useSave();
  return (
    <div className="toolbar" data-testid="water-report-recipient">
      {/* several recipients (Lili, card c2e15128): separated by commas; the server checks each one */}
      <input
        className="input"
        type="text"
        inputMode="email"
        aria-label="A vízmérés címzettjei"
        placeholder="nev@pelda.hu, masik@pelda.hu"
        value={v}
        onChange={(e) => setV(e.target.value)}
      />
      <button className="btn" type="button" disabled={busy || v.trim() === email} onClick={() => void save("/api/admin/water-report-recipient", "POST", { email: v.trim() })}>
        Mentés
      </button>
      <Msg msg={msg} />
      <span className="hint">Több címzett vesszővel elválasztva (legfeljebb 10).</span>
    </div>
  );
}
