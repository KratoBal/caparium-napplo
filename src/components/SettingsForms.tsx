"use client";

// Settings rows (Figma 25, 26): every save says whether it is a CHANGE (from now on, the past keeps
// the old value) or a CORRECTION (a typo, acts on the past too, reason required) — adatmodell K3.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SHEET_COLORS, sheetColorBg } from "@/lib/sheet-color-palette";
import { useReasonsOn } from "./ReasonSwitch";
import { useTr } from "./LangProvider";
import type { TrVars } from "@/lib/i18n/translate";

type Tr = (text: string, vars?: TrVars) => string;

function requestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

async function post(url: string, method: string, body: Record<string, unknown>, tr: Tr): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: requestId(), ...body }),
    });
    if (res.ok) return null;
    const b = (await res.json().catch(() => ({}))) as { error?: { message?: string; issues?: { message: string }[] } };
    return b.error?.issues?.[0]?.message ?? b.error?.message ?? tr("A mentés nem sikerült.");
  } catch {
    return tr("Nincs kapcsolat a szerverrel.");
  }
}

export function useSave() {
  const router = useRouter();
  const tr = useTr();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  /** Resolves true when the save went through, so a form can empty itself only then. */
  async function save(url: string, method: string, body: Record<string, unknown>, okText?: string): Promise<boolean> {
    setBusy(true);
    const err = await post(url, method, body, tr);
    setBusy(false);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: okText ?? tr("Mentve.") });
    if (!err) router.refresh();
    return err === null;
  }
  return { msg, busy, save };
}

export function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <span className={msg.ok ? "hint" : "err"} role="status">{msg.text}</span>;
}

function ModeSelect({ value, onChange, id }: { value: string; onChange: (v: "change" | "correction") => void; id: string }) {
  const tr = useTr();
  return (
    <select className="input" aria-label={tr("A módosítás fajtája")} data-testid={`mode-${id}`} value={value} onChange={(e) => onChange(e.target.value as "change" | "correction")}>
      <option value="change">{tr("Változás (mostantól)")}</option>
      <option value="correction">{tr("Helyesbítés (elírás, visszamenőleg)")}</option>
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
  const tr = useTr();
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
        {/* Lili 2026-11-02 (acrobot 39956): the rows stand under one measurement on the Vízmérések card: the pool's name,
            or "Közös" for the common one */}
        <b>{p.pool ? p.pool.name : tr("Közös")}</b>
        {inherited && <div className="hint">{tr("a közös érték")}</div>}
      </td>
      <td>{p.unit}</td>
      <td><input className="input small" aria-label={tr("{label} minimum", { label })} inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} /></td>
      <td><input className="input small" aria-label={tr("{label} maximum", { label })} inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} /></td>
      <td>{inherited ? <span className="hint">{tr("Változás (mostantól)")}</span> : <ModeSelect id={label} value={mode} onChange={setMode} />}</td>
      {reasonsOn && <td><input className="input" aria-label={tr("{label} indoklás", { label })} placeholder={mode === "correction" && !inherited ? tr("indoklás (kötelező)") : tr("indoklás")} value={reason} onChange={(e) => setReason(e.target.value)} /></td>}
      <td>
        <button className="btn" type="button" disabled={busy} onClick={() => void save("/api/admin/reference", "POST", { parameterId: p.parameterId, ...(p.pool ? { poolId: p.pool.id } : {}), min: min || null, max: max || null, mode: inherited ? "change" : mode, ...(reason.trim() ? { reason: reason.trim() } : {}) })}>
          {tr("Mentés")}
        </button>{" "}
        <Msg msg={msg} />
      </td>
    </tr>
  );
}

/** caparium-hibak-3: a pool's volume in litres, the chemical calculator works with it. */
export function PoolVolumeForm(p: { poolId: string; name: string; volumeLiters: string | null }) {
  const tr = useTr();
  const [v, setV] = useState((p.volumeLiters ?? "").replace(".", ","));
  const { msg, busy, save } = useSave();
  const unchanged = v.trim() === (p.volumeLiters ?? "").replace(".", ",");
  return (
    <span className="toolbar" style={{ margin: 0 }}>
      <input className="input small" inputMode="decimal" aria-label={tr("{name} űrtartalma (liter)", { name: p.name })} value={v} onChange={(e) => setV(e.target.value)} />
      <button className="btn btn-soft" type="button" disabled={busy || unchanged} onClick={() => void save("/api/admin/pool-volume", "POST", { poolId: p.poolId, volumeLiters: v.trim() ? v.trim().replace(",", ".") : null })}>
        {tr("Mentés")}
      </button>
      <Msg msg={msg} />
    </span>
  );
}

/** Lili 2026-10-29 (package item 5b): a pool's system, coral or fish; the chemical calculator's daily limit follows it. */
export function PoolSystemForm(p: { poolId: string; name: string; systemType: "CORAL" | "FISH" | null }) {
  const tr = useTr();
  const [v, setV] = useState<string>(p.systemType ?? "");
  const { msg, busy, save } = useSave();
  return (
    <span className="toolbar" style={{ margin: 0 }}>
      <select className="input" aria-label={tr("{name} rendszere", { name: p.name })} value={v} onChange={(e) => setV(e.target.value)}>
        <option value="">{tr("nincs megadva")}</option>
        <option value="CORAL">{tr("korallos")}</option>
        <option value="FISH">{tr("halas")}</option>
      </select>
      <button className="btn btn-soft" type="button" disabled={busy || v === (p.systemType ?? "")} onClick={() => void save("/api/admin/pool-system", "POST", { poolId: p.poolId, systemType: v || null })}>
        {tr("Mentés")}
      </button>
      <Msg msg={msg} />
    </span>
  );
}

/** The feeding sheet's row colour of an animal or a group: none, or one of the narrow palette; the sample shows it. */
export function SheetColorForm(p: { target: "animal" | "group"; id: string; name: string; color: string | null }) {
  const tr = useTr();
  const [v, setV] = useState(sheetColorBg(p.color) ? p.color! : "");
  const { msg, busy, save } = useSave();
  const bg = sheetColorBg(v);
  return (
    <span className="toolbar" style={{ margin: 0 }}>
      <select className="input" aria-label={tr("{name} sorszíne", { name: p.name })} value={v} onChange={(e) => setV(e.target.value)}>
        <option value="">{tr("Nincs szín")}</option>
        {SHEET_COLORS.map((c) => (
          <option key={c.key} value={c.key}>
            {tr(c.label)}
          </option>
        ))}
      </select>
      <span className="sheet-color-sample" style={{ background: bg ?? undefined }} data-testid={`sheet-color-sample-${p.id}`}>
        {p.name}
      </span>
      <button className="btn btn-soft" type="button" disabled={busy || v === (p.color ?? "")} onClick={() => void save("/api/admin/sheet-color", "POST", { target: p.target, id: p.id, color: v })}>
        {tr("Mentés")}
      </button>
      <Msg msg={msg} />
    </span>
  );
}

type PoolItem = { poolId: string; name: string; groups: string; active: boolean; periods: { firstDay: string; lastDay: string | null }[] };

/**
 * The settings' pool list (Lili 2026-10-29, acrobot 37943): an inactive pool (a renovation) is shown only here, and only with
 * the "Inaktívak mutatása" switch on, to be activated again. A row switched in this view stays until the page is left, so its
 * message is read and an inactivation undone at once.
 */
export function PoolList({ pools, reasons }: { pools: PoolItem[]; reasons: boolean }) {
  const tr = useTr();
  const [showInactive, setShowInactive] = useState(false);
  const [kept, setKept] = useState<string[]>([]);
  const inactive = pools.filter((x) => !x.active).length;
  return (
    <>
      {inactive > 0 && (
        <label className="toolbar" style={{ margin: "8px 0" }}>
          <input className="switch" type="checkbox" role="switch" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          {tr("Inaktívak mutatása ({n})", { n: inactive })}
        </label>
      )}
      <div className="table-scroll">
        <table className="log-table" data-testid="pools-table">
          <thead><tr><th>{tr("Név")}</th><th>{tr("Mérési csoport")}</th><th>{tr("Fajta")}</th>{reasons && <th>{tr("Indoklás")}</th>}<th></th></tr></thead>
          <tbody>
            {pools
              .filter((x) => x.active || showInactive || kept.includes(x.poolId))
              .map((x) => (
                <PoolRow key={x.poolId} {...x} onSwitch={() => setKept((k) => (k.includes(x.poolId) ? k : [...k, x.poolId]))} />
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function PoolRow(p: PoolItem & { onSwitch?: () => void }) {
  const tr = useTr();
  const [name, setName] = useState(p.name);
  const [mode, setMode] = useState<"change" | "correction">("change");
  const [reason, setReason] = useState("");
  const { msg, busy, save } = useSave();
  const reasonsOn = useReasonsOn();
  return (
    <tr data-testid={`pool-${p.name}`} className={p.active ? undefined : "invalid"}>
      <td><input className="input" aria-label={tr("{name} új neve", { name: p.name })} value={name} onChange={(e) => setName(e.target.value)} /></td>
      <td className="hint">{p.groups || tr("nincs vízmérés")}</td>
      <td><ModeSelect id={p.name} value={mode} onChange={setMode} /></td>
      {reasonsOn && <td><input className="input" aria-label={tr("{name} indoklás", { name: p.name })} placeholder={mode === "correction" ? tr("indoklás (kötelező)") : tr("indoklás")} value={reason} onChange={(e) => setReason(e.target.value)} /></td>}
      <td>
        <button className="btn" type="button" disabled={busy || name.trim() === p.name} onClick={() => void save("/api/admin/pool-name", "POST", { poolId: p.poolId, name: name.trim(), mode, ...(reason.trim() ? { reason: reason.trim() } : {}) })}>
          {tr("Mentés")}
        </button>{" "}
        {/* Lili 2026-10-29 (caparium-finomitas-1): off for a renovation and back, nothing lost */}
        <button
          className="btn btn-row"
          type="button"
          disabled={busy}
          aria-label={p.active ? tr("{name}: inaktiválás", { name: p.name }) : tr("{name}: aktiválás", { name: p.name })}
          onClick={() => {
            if (p.active && !window.confirm(tr("Inaktiválod: {name}? Felújítás idejére: új mérés nem rögzíthető rá, és lekerül a mérési táblából és a felhasználói oldalakról, csak itt látszik az „Inaktívak mutatása” kapcsolóval; a korábbi mérései megmaradnak, és aktiválva minden visszajön.", { name: p.name }))) return;
            p.onSwitch?.();
            void save("/api/admin/pool-active", "POST", { poolId: p.poolId, active: !p.active }, p.active ? tr("Inaktiválva.") : tr("Újra aktív."));
          }}
        >
          {p.active ? tr("Inaktiválás (felújítás)") : tr("Aktiválás")}
        </button>{" "}
        <Msg msg={msg} />
        <PoolPeriods poolId={p.poolId} name={p.name} periods={p.periods} />
      </td>
    </tr>
  );
}

/**
 * Lili 2026-11-01 (point 16): the pool's periods of use, the admin's: from a day, to a day or open, a renovation is the gap between
 * two. Saved together; overlaps are refused by the server with the reason. The pool and its measurements and animals stay one.
 */
function PoolPeriods({ poolId, name, periods }: { poolId: string; name: string; periods: { firstDay: string; lastDay: string | null }[] }) {
  const tr = useTr();
  const { msg, busy, save } = useSave();
  const [rows, setRows] = useState(periods.map((p) => ({ from: p.firstDay, to: p.lastDay ?? "" })));
  const set = (i: number, k: "from" | "to", v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const dotted = (d: string) => `${d.replaceAll("-", ".")}.`;
  const shown = periods.length ? periods.map((p) => `${dotted(p.firstDay)} – ${p.lastDay ? dotted(p.lastDay) : ""}`).join(", ") : tr("nincs");
  return (
    <details className="pool-periods" data-testid={`pool-periods-${name}`}>
      <summary>{tr("Használati időszakok: {periods}", { periods: shown })}</summary>
      {rows.map((r, i) => (
        <div className="toolbar" key={i}>
          <label className="field">
            {tr("Mettől")}
            <input className="input" type="date" aria-label={tr("{name} időszak {n} kezdete", { name, n: i + 1 })} value={r.from} onChange={(e) => set(i, "from", e.target.value)} />
          </label>
          <label className="field">
            {tr("Meddig (üresen: nyitott)")}
            <input className="input" type="date" aria-label={tr("{name} időszak {n} vége", { name, n: i + 1 })} value={r.to} onChange={(e) => set(i, "to", e.target.value)} />
          </label>
          <button className="btn btn-row" type="button" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
            {tr("Törlés")}
          </button>
        </div>
      ))}
      <div className="toolbar">
        <button className="btn btn-soft" type="button" onClick={() => setRows((x) => [...x, { from: "", to: "" }])}>
          {tr("+ Időszak")}
        </button>
        <button
          className="btn"
          type="button"
          disabled={busy || rows.some((r) => !r.from)}
          onClick={() => void save(`/api/admin/pools/${poolId}/periods`, "PUT", { periods: rows.map((r) => ({ firstDay: r.from, lastDay: r.to || null })) }, tr("Időszakok mentve."))}
        >
          {tr("Időszakok mentése")}
        </button>
        <Msg msg={msg} />
      </div>
    </details>
  );
}

/** Lili 2026-10-26 (point 3): a new pool, admin only. Name, code, volume and at least one measurement group are needed; the icon is optional. */
export function NewPoolForm({ groups }: { groups: { id: string; name: string }[] }) {
  const tr = useTr();
  const empty = { name: "", code: "", volume: "", emoji: "", groupIds: [] as string[], noWater: false };
  const [f, setF] = useState(empty);
  const { msg, busy, save } = useSave();
  const set = (k: "name" | "code" | "volume" | "emoji") => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const toggle = (id: string) => setF({ ...f, groupIds: f.groupIds.includes(id) ? f.groupIds.filter((g) => g !== id) : [...f.groupIds, id] });
  const ready = f.name.trim() !== "" && f.code.trim() !== "" && f.volume.trim() !== "" && (f.noWater || f.groupIds.length > 0);
  return (
    <div data-testid="new-pool">
      <div className="toolbar">
        <input className="input" aria-label={tr("Új medence neve")} placeholder={tr("név")} value={f.name} onChange={set("name")} />
        <input className="input small" aria-label={tr("Új medence kódja")} placeholder={tr("kód (pl. UJ_MEDENCE)")} value={f.code} onChange={set("code")} />
        <input className="input small" inputMode="decimal" aria-label={tr("Új medence űrtartalma (liter)")} placeholder={tr("liter")} value={f.volume} onChange={set("volume")} />
        <input className="input" style={{ width: 90 }} aria-label={tr("Új medence ikonja (nem kötelező)")} placeholder={tr("ikon")} value={f.emoji} onChange={set("emoji")} />
      </div>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: "8px 0" }}>
        {tr("Mérési csoport (legalább egy, vagy nincs vízmérés)")}
        <span style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {groups.map((g) => (
            <label key={g.id} className="check">
              <input type="checkbox" checked={f.groupIds.includes(g.id)} disabled={f.noWater} onChange={() => toggle(g.id)} />
              {g.name}
            </label>
          ))}
          {/* Lili 2026-10-26 (msg 1564364366844006430): registered, but no water measurement (as the salt pools); no group then */}
          <label className="check">
            <input type="checkbox" checked={f.noWater} onChange={(e) => setF({ ...f, noWater: e.target.checked, groupIds: e.target.checked ? [] : f.groupIds })} />
            {tr("Nincs vízmérés")}
          </label>
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
              { name: f.name.trim(), code: f.code.trim(), volumeLiters: f.volume.trim().replace(",", "."), groupIds: f.groupIds, ...(f.noWater ? { noWaterMeasurement: true } : {}), ...(f.emoji.trim() ? { emoji: f.emoji.trim() } : {}) },
              tr("Medence felvéve."),
            ).then((ok) => ok && setF(empty))
          }
        >
          {tr("Medence felvétele")}
        </button>
        <Msg msg={msg} />
      </div>
    </div>
  );
}

export function UserRow(p: { id: string; loginId: string; fullName: string; role: "AQUARIST" | "ADMIN"; active: boolean; monogram: string; zimsName: string; email: string; self: boolean }) {
  const tr = useTr();
  const [role, setRole] = useState(p.role);
  const [email, setEmail] = useState(p.email);
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
  if (email.trim().toLowerCase() !== p.email) body.email = email.trim();
  return (
    <tr data-testid={`user-${p.loginId}`} className={p.active ? undefined : "invalid"}>
      <td className="keep"><b>{p.fullName}</b><div className="hint">{p.loginId}</div></td>
      <td className="keep">
        <select className="input" aria-label={tr("{login} szerep", { login: p.loginId })} value={role} disabled={p.self} onChange={(e) => setRole(e.target.value as "AQUARIST" | "ADMIN")}>
          <option value="AQUARIST">{tr("Akvarista")}</option>
          <option value="ADMIN">{tr("Adminisztrátor")}</option>
        </select>
      </td>
      <td className="keep"><input className="input small" aria-label={tr("{login} monogram", { login: p.loginId })} value={monogram} onChange={(e) => setMonogram(e.target.value)} /></td>
      <td className="keep">
        <input className="input" aria-label={tr("{login} ZIMS-név", { login: p.loginId })} value={zimsName} onChange={(e) => setZimsName(e.target.value)} />
        {modeNeeded && (
          <select
            className="input"
            aria-label={tr("{login} ZIMS-név módosításának fajtája", { login: p.loginId })}
            value={zimsNameMode}
            onChange={(e) => setZimsNameMode(e.target.value as "" | "CORRECTION" | "RENAME")}
          >
            <option value="">{tr("Elírás vagy névváltozás?")}</option>
            <option value="CORRECTION">{tr("Elírást javítok (a korábbi mérésekre is)")}</option>
            <option value="RENAME">{tr("A neve megváltozott (mostantól)")}</option>
          </select>
        )}
      </td>
      <td className="keep"><input className="input" type="email" aria-label={tr("{login} e-mail cím", { login: p.loginId })} placeholder={tr("nincs")} value={email} onChange={(e) => setEmail(e.target.value)} /></td>
      <td className="keep"><input className="input" type="password" autoComplete="new-password" aria-label={tr("{login} új jelszó", { login: p.loginId })} placeholder={tr("új jelszó")} value={password} onChange={(e) => setPassword(e.target.value)} /></td>
      <td className="keep">
        <button
          className="btn"
          type="button"
          disabled={busy || Object.keys(body).length === 0 || (modeNeeded && !zimsNameMode)}
          onClick={() => void save(`/api/admin/users/${p.id}`, "PATCH", body).then(() => setPassword(""))}
        >
          {tr("Mentés")}
        </button>{" "}
        {!p.self && (
          <button className="btn btn-soft" type="button" disabled={busy} onClick={() => void save(`/api/admin/users/${p.id}`, "PATCH", { active: !p.active }, p.active ? tr("Inaktiválva.") : tr("Újra aktív."))}>
            {p.active ? tr("Inaktiválás") : tr("Aktiválás")}
          </button>
        )}{" "}
        {p.active && <ResetLinkButton id={p.id} loginId={p.loginId} />}{" "}
        <Msg msg={msg} />
      </td>
    </tr>
  );
}

export function NewUserForm() {
  const tr = useTr();
  const [f, setF] = useState({ loginId: "", fullName: "", role: "AQUARIST", monogram: "", zimsName: "", password: "" });
  const { msg, busy, save } = useSave();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="toolbar" data-testid="new-user">
      <input className="input" aria-label={tr("Új felhasználónév")} placeholder={tr("felhasználónév")} value={f.loginId} onChange={set("loginId")} />
      <input className="input" aria-label={tr("Teljes név")} placeholder={tr("teljes név")} value={f.fullName} onChange={set("fullName")} />
      <select className="input" aria-label={tr("Szerep")} value={f.role} onChange={set("role")}>
        <option value="AQUARIST">{tr("Akvarista")}</option>
        <option value="ADMIN">{tr("Adminisztrátor")}</option>
      </select>
      <input className="input small" aria-label={tr("Monogram")} placeholder={tr("monogram")} value={f.monogram} onChange={set("monogram")} />
      <input className="input" aria-label={tr("ZIMS-név")} placeholder={tr("ZIMS-név (betűre)")} value={f.zimsName} onChange={set("zimsName")} />
      <input className="input" type="password" autoComplete="new-password" aria-label={tr("Kezdő jelszó")} placeholder={tr("kezdő jelszó (min. 10)")} value={f.password} onChange={set("password")} />
      <button className="btn" type="button" disabled={busy} onClick={() => void save("/api/admin/users", "POST", f, tr("Felhasználó létrehozva."))}>
        {tr("Felhasználó létrehozása")}
      </button>
      <Msg msg={msg} />
    </div>
  );
}

/** The recipients of one mail kind in Beállítások: the water report's (caparium-hibak-4) or the monthly ZIMS package's. */
function RecipientForm({ email, endpoint, label, testId }: { email: string; endpoint: string; label: string; testId: string }) {
  const tr = useTr();
  const [v, setV] = useState(email);
  const { msg, busy, save } = useSave();
  return (
    <div className="toolbar" data-testid={testId}>
      {/* several recipients (Lili, card c2e15128): separated by commas; the server checks each one */}
      <input
        className="input"
        type="text"
        inputMode="email"
        aria-label={label}
        placeholder={tr("nev@pelda.hu, masik@pelda.hu")}
        value={v}
        onChange={(e) => setV(e.target.value)}
      />
      <button className="btn" type="button" disabled={busy || v.trim() === email} onClick={() => void save(endpoint, "POST", { email: v.trim() })}>
        {tr("Mentés")}
      </button>
      <Msg msg={msg} />
      <span className="hint">{tr("Több címzett vesszővel elválasztva (legfeljebb 10).")}</span>
    </div>
  );
}

export function WaterReportRecipient({ email }: { email: string }) {
  const tr = useTr();
  return <RecipientForm email={email} endpoint="/api/admin/water-report-recipient" label={tr("A vízmérés címzettjei")} testId="water-report-recipient" />;
}

/** Card 0d617f0c: the helper's "Ne felejtsd el menteni!" on a filled, unsaved form; saved as soon as it is switched. */
export function SaveReminderSwitch({ on }: { on: boolean }) {
  const tr = useTr();
  const { msg, busy, save } = useSave();
  // the switch moves at once and goes back if the save fails; after the refresh it follows the stored value. Bound to the
  // prop alone it stood still until the refresh (the e2e of #142: "Clicking the checkbox did not change its state").
  const [checked, setChecked] = useState(on);
  useEffect(() => setChecked(on), [on]);
  return (
    <label className="toolbar" data-testid="save-reminder">
      <input
        className="switch"
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={busy}
        onChange={async (e) => {
          const next = e.target.checked;
          setChecked(next);
          if (!(await save("/api/admin/save-reminder", "POST", { on: next }))) setChecked(!next);
        }}
      />
      {tr("A segítő szól, ha egy kitöltött űrlap nincs mentve")}
      <Msg msg={msg} />
    </label>
  );
}

/** Lili's package, item 1: where the monthly ZIMS package's mail goes; empty = no mail. */
export function MonthlyZimsRecipient({ email }: { email: string }) {
  const tr = useTr();
  return <RecipientForm email={email} endpoint="/api/admin/monthly-zims-recipient" label={tr("A havi ZIMS-csomag címzettjei")} testId="monthly-zims-recipient" />;
}

/**
 * Lili 2026-11-01 (point 13): a tester whose reading is converted to the value (Hanna HI755 for KH: x 0,056, 1 decimal;
 * HI736 for PO4: x 0,003066, 3 decimals), per parameter, from a day on. In force, the grid takes the reading, shows the
 * value, and keeps the reading. "Lezárás" ends it from the day given: typed values are the values again.
 */
export function ConversionRow(p: {
  parameterId: string;
  name: string;
  unit: string;
  current: { label: string; factor: string; decimals: number; from: string } | null;
  today: string;
}) {
  const tr = useTr();
  const { msg, busy, save } = useSave();
  const [label, setLabel] = useState(p.current?.label ?? "");
  const [factor, setFactor] = useState(p.current ? p.current.factor.replace(".", ",") : "");
  const [decimals, setDecimals] = useState(p.current ? String(p.current.decimals) : "");
  const [from, setFrom] = useState(p.today);
  const ready = label.trim().length >= 2 && factor.trim() !== "" && decimals !== "" && from !== "";
  return (
    <tr data-testid={`conversion-${p.name}`}>
      <td className="keep">
        <b>{p.name}</b>
        <div className="hint">{p.unit}</div>
      </td>
      <td className="keep">
        {p.current ? (
          <span>
            {tr("{tester}: leolvasás × {factor}, {decimals} tizedes, {from}.-tól", {
              tester: p.current.label,
              factor: p.current.factor.replace(".", ","),
              decimals: p.current.decimals,
              from: p.current.from.replaceAll("-", "."),
            })}
          </span>
        ) : (
          <span className="hint">{tr("nincs (a beírt érték maga a mérés)")}</span>
        )}
      </td>
      <td className="keep"><input className="input" aria-label={tr("{name} mérőeszköz", { name: p.name })} placeholder={tr("pl. Hanna HI755")} value={label} onChange={(e) => setLabel(e.target.value)} /></td>
      <td className="keep"><input className="input small" inputMode="decimal" aria-label={tr("{name} szorzó", { name: p.name })} value={factor} onChange={(e) => setFactor(e.target.value)} /></td>
      <td className="keep">
        <select className="input small" aria-label={tr("{name} tizedesjegy", { name: p.name })} value={decimals} onChange={(e) => setDecimals(e.target.value)}>
          <option value="">–</option>
          {[0, 1, 2, 3, 4].map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </td>
      <td className="keep"><input className="input" type="date" aria-label={tr("{name} mettől", { name: p.name })} value={from} onChange={(e) => setFrom(e.target.value)} /></td>
      <td className="keep">
        <button
          className="btn"
          type="button"
          disabled={busy || !ready}
          onClick={() => void save("/api/admin/conversions", "POST", { parameterId: p.parameterId, label: label.trim(), factor: factor.trim(), decimals: Number(decimals), from })}
        >
          {tr("Mentés")}
        </button>{" "}
        {p.current && (
          <button
            className="btn btn-soft"
            type="button"
            disabled={busy || from === ""}
            onClick={() => void save("/api/admin/conversions", "POST", { parameterId: p.parameterId, label: null, factor: null, decimals: null, from }, tr("Lezárva."))}
          >
            {tr("Lezárás")}
          </button>
        )}{" "}
        <Msg msg={msg} />
      </td>
    </tr>
  );
}

/**
 * Lili 2026-11-01 (point 9, msg 1566532615530352863): a new measurement type, as a new animal: name, unit, decimals, the plausible
 * range (outside it the grid asks "biztos?"), the reference, the ZIMS name and unit, the daily or weekly table it goes into, the
 * pools it is measured in, from a day. The table gets a new column, filled in the chosen pools only.
 */
export function NewMeasurementForm({ units, groups, today }: { units: { id: string; symbol: string }[]; groups: { id: string; name: string; pools: { id: string; name: string }[] }[]; today: string }) {
  const tr = useTr();
  // Lili 2026-11-01 22:21 UTC: several tables at once (the daily Korallos and the daily Nagymedence table), each with its own pools
  const empty = { name: "", unitId: "", decimals: "1", pMin: "", pMax: "", rMin: "", rMax: "", zimsName: "", zimsUnit: "", tables: {} as Record<string, string[]>, from: today, to: "" };
  const [f, setF] = useState(empty);
  const { msg, busy, save } = useSave();
  const set = (k: keyof typeof empty, v: string) => setF((x) => ({ ...x, [k]: v }));
  const chosen = Object.entries(f.tables);
  const ready = f.name.trim().length >= 2 && f.unitId && f.zimsName.trim() && f.zimsUnit.trim() && chosen.length > 0 && chosen.every(([, p]) => p.length > 0) && f.from;
  const setTable = (id: string, on: boolean) =>
    setF((x) => {
      const tables = { ...x.tables };
      if (on) tables[id] = tables[id] ?? [];
      else delete tables[id];
      return { ...x, tables };
    });
  const setPool = (table: string, pool: string, on: boolean) =>
    setF((x) => ({ ...x, tables: { ...x.tables, [table]: on ? [...(x.tables[table] ?? []), pool] : (x.tables[table] ?? []).filter((p) => p !== pool) } }));
  const text = (k: keyof typeof empty, label: string, opts: { small?: boolean; decimal?: boolean } = {}) => (
    <label className="field">
      {label}
      <input className={`input${opts.small ? " small" : ""}`} aria-label={label} inputMode={opts.decimal ? "decimal" : undefined} value={f[k] as string} onChange={(e) => set(k, e.target.value)} />
    </label>
  );
  return (
    <div data-testid="new-measurement">
      <div className="form-grid">
        {text("name", tr("Név (például Nitrit)"))}
        <label className="field">
          {tr("Mértékegység")}
          <select className="input" aria-label={tr("Mértékegység")} value={f.unitId} onChange={(e) => set("unitId", e.target.value)}>
            <option value="">{tr("Válassz")}</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.symbol}</option>
            ))}
          </select>
        </label>
        <label className="field">
          {tr("Tizedesjegyek")}
          <select className="input small" aria-label={tr("Tizedesjegyek")} value={f.decimals} onChange={(e) => set("decimals", e.target.value)}>
            {[0, 1, 2, 3, 4].map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        {text("pMin", tr("Hihető tartomány alja"), { small: true, decimal: true })}
        {text("pMax", tr("Hihető tartomány teteje"), { small: true, decimal: true })}
        {text("rMin", tr("Referencia alja"), { small: true, decimal: true })}
        {text("rMax", tr("Referencia teteje"), { small: true, decimal: true })}
        {text("zimsName", tr("ZIMS-név"))}
        {text("zimsUnit", tr("ZIMS-mértékegység"))}
        <label className="field">
          {tr("Mettől")}
          <input className="input" type="date" aria-label={tr("Mettől")} value={f.from} onChange={(e) => set("from", e.target.value)} />
        </label>
        {/* Lili 2026-11-01 22:54 UTC: an optional last day, for a measurement of the past (the density in SG) */}
        <label className="field">
          {tr("Meddig (ha lezárt)")}
          <input className="input" type="date" aria-label={tr("Meddig")} value={f.to} min={f.from} onChange={(e) => set("to", e.target.value)} />
        </label>
      </div>
      <fieldset className="field" style={{ border: 0, padding: 0, marginTop: 12 }} data-testid="new-measurement-tables">
        {tr("Melyik napi vagy heti táblákba, és ott melyik medencékben")}
        {groups.map((g) => (
          <div key={g.id} style={{ marginTop: 6 }}>
            <label className="check">
              <input type="checkbox" aria-label={tr("Tábla: {name}", { name: g.name })} checked={g.id in f.tables} onChange={(e) => setTable(g.id, e.target.checked)} />
              {g.name}
            </label>
            {g.id in f.tables && (
              <span style={{ display: "flex", gap: 12, flexWrap: "wrap", marginLeft: 28 }}>
                {g.pools.map((p) => (
                  <label key={p.id} className="check">
                    <input type="checkbox" aria-label={`${g.name}: ${p.name}`} checked={(f.tables[g.id] ?? []).includes(p.id)} onChange={(e) => setPool(g.id, p.id, e.target.checked)} />
                    {p.name}
                  </label>
                ))}
              </span>
            )}
          </div>
        ))}
      </fieldset>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <button
          className="btn"
          type="button"
          disabled={busy || !ready}
          onClick={async () => {
            const ok = await save(
              "/api/admin/measurement-types",
              "POST",
              {
                name: f.name.trim(),
                unitId: f.unitId,
                decimals: Number(f.decimals),
                plausibleMin: f.pMin || null,
                plausibleMax: f.pMax || null,
                referenceMin: f.rMin || null,
                referenceMax: f.rMax || null,
                zimsName: f.zimsName.trim(),
                zimsUnit: f.zimsUnit.trim(),
                tables: Object.entries(f.tables).map(([groupId, poolIds]) => ({ groupId, poolIds })),
                from: f.from,
                to: f.to || null,
              },
              tr("Mérésfajta felvéve."),
            );
            if (ok) setF(empty);
          }}
        >
          {tr("Mérésfajta felvétele")}
        </button>
        <Msg msg={msg} />
      </div>
    </div>
  );
}

/**
 * A one-time reset link for a user who forgot their password (task e7f9e84d, slice 3): the admin hands it over; it works without
 * e-mail, once, for a day. Shown once here; a new one ends the earlier.
 */
function ResetLinkButton({ id, loginId }: { id: string; loginId: string }) {
  const tr = useTr();
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <span data-testid={`reset-link-${loginId}`}>
      <button
        className="btn btn-soft"
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const res = await fetch(`/api/admin/users/${id}/reset-link`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ requestId: crypto.randomUUID() }),
            });
            const body = (await res.json().catch(() => null)) as { path?: string; expiresAt?: string; error?: { message?: string } } | null;
            if (res.ok && body?.path && body.expiresAt) setLink({ url: `${window.location.origin}${body.path}`, expiresAt: body.expiresAt });
            else setError(body?.error?.message ?? tr("A link nem készült el."));
          } catch {
            setError(tr("Nincs kapcsolat a szerverrel."));
          } finally {
            setBusy(false);
          }
        }}
      >
        {tr("Visszaállító link")}
      </button>
      {link && (
        <span className="hint">
          {" "}
          <input className="input" readOnly aria-label={tr("{login} visszaállító linkje", { login: loginId })} value={link.url} onFocus={(e) => e.currentTarget.select()} />{" "}
          {tr("Egyszer használható, lejár: {at}. Add át a dolgozónak.", {
            at: new Date(link.expiresAt).toLocaleString("hu-HU", { timeZone: "Europe/Budapest" }),
          })}
        </span>
      )}
      {error && <span role="alert"> {error}</span>}
    </span>
  );
}
