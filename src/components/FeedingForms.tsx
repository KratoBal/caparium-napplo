"use client";

// Forms of the feeding log and the eating log (EGY-01..EGY-12, EVE-01..EVE-05). The server decides
// every permission; a confirmation (R-3, an empty list) or a reason (admin, an earlier or closed day)
// is asked only when the server says it is needed.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EAT_LABEL } from "@/lib/eating-labels";

function requestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

type ErrorBody = { error?: { code?: string; message?: string; issues?: { message: string }[] } };

function useSend() {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(url: string, body: Record<string, unknown>, okText: string | ((res: Record<string, unknown>) => string) = "Mentve.") {
    setBusy(true);
    setMsg(null);
    let extra: Record<string, unknown> = {};
    try {
      for (let i = 0; i < 3; i++) {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: requestId(), clientTimestamp: new Date().toISOString(), ...body, ...extra }),
        });
        if (res.ok) {
          setMsg({ ok: true, text: typeof okText === "string" ? okText : okText((await res.json().catch(() => ({}))) as Record<string, unknown>) });
          router.refresh();
          return true;
        }
        const b = (await res.json().catch(() => ({}))) as ErrorBody;
        const code = b.error?.code;
        const message = b.error?.issues?.[0]?.message ?? b.error?.message ?? "Nem sikerült.";
        if (code === "HAS_RECORDS" && !extra.confirmCascade && window.confirm(message)) {
          extra = { ...extra, confirmCascade: true };
          continue;
        }
        if (code === "EMPTY_LIST" && !extra.confirmEmpty && window.confirm(message)) {
          extra = { ...extra, confirmEmpty: true };
          continue;
        }
        if (code === "REASON_REQUIRED" && !extra.reason) {
          const r = window.prompt(`${message} Indoklás:`);
          if (r && r.trim().length >= 3) {
            extra = { ...extra, reason: r.trim() };
            continue;
          }
        }
        setMsg({ ok: false, text: message });
        return false;
      }
      return false;
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

/** One animal on the daily list (EGY-01; the list is common, R-7). */
export function SelectBox({ day, animalId, name, selected, disabled }: { day: string; animalId: string; name: string; selected: boolean; disabled: boolean }) {
  const { msg, busy, run } = useSend();
  // shown at once, rolled back when the server refuses (the refresh brings the stored state)
  const [shown, setShown] = useState(selected);
  useEffect(() => setShown(selected), [selected]);
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={shown}
        disabled={disabled || busy}
        aria-label={`${name} a mai listán`}
        onChange={(e) => {
          const next = e.target.checked;
          setShown(next);
          void run("/api/feeding/selection", { day, animalIds: [animalId], selected: next }, next ? "Kiválasztva." : "Kivéve.").then((ok) => {
            if (!ok) setShown(!next);
          });
        }}
      />
      <Msg msg={msg} />
    </label>
  );
}

/** Selecting a group selects its members of the day one by one; a member can be taken out later. */
export function GroupSelect({ day, name, memberIds }: { day: string; name: string; memberIds: string[] }) {
  const { msg, busy, run } = useSend();
  return (
    <span>
      <button className="btn btn-soft" type="button" disabled={busy} onClick={() => void run("/api/feeding/selection", { day, animalIds: memberIds, selected: true }, "Csoport kiválasztva.")}>
        {name}: mind a listára
      </button>
      <Msg msg={msg} />
    </span>
  );
}

export function FinalizeList({ day }: { day: string }) {
  const { msg, busy, run } = useSend();
  return (
    <span>
      <button className="btn" type="button" disabled={busy} onClick={() => void run("/api/feeding/finalize", { day }, "A lista kész.")}>
        Lista kész
      </button>
      <Msg msg={msg} />
    </span>
  );
}

export type Recipient = { key: string; label: string; animalId?: string; groupId?: string };
export type FeedOpt = {
  id: string;
  name: string;
  isOther: boolean;
  /** per dimension: the base unit's symbol and the units with their factor to it */
  dims: { dimension: string; base: string; units: { id: string; symbol: string; factor: number }[] }[];
};

/** "42,5" or "42.5" -> 42.5; anything else -> null */
export function parseAmount(v: string): number | null {
  const t = v.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

const DIM: Record<string, string> = { MASS: "tömeg", COUNT: "darab", VOLUME: "térfogat" };

/** A feeding item: one recipient, one feed, at most one quantity per dimension (T-08). */
/** EGY-03: the other feed names used before, offered while typing (a suggestion, not a list to pick from). */
function OtherNames({ id, names }: { id: string; names?: string[] }) {
  if (!names?.length) return null;
  return (
    <datalist id={id}>
      {names.map((n) => (
        <option key={n} value={n} />
      ))}
    </datalist>
  );
}

export function ItemForm({
  day,
  recipients,
  feeds,
  otherNames,
  active,
  onActive,
  onDraft,
}: {
  day: string;
  recipients: Recipient[];
  feeds: FeedOpt[];
  otherNames?: string[];
  /** EGY-07: the recipient follows the clicked row when the parent holds it */
  active?: string;
  onActive?: (key: string) => void;
  /** EGY-06: what is typed but not saved yet, in base units */
  onDraft?: (draft: Record<string, number>) => void;
}) {
  const [ownRec, setOwnRec] = useState(recipients[0]?.key ?? "");
  const rec = active ?? ownRec;
  const setRec = (k: string) => (onActive ? onActive(k) : setOwnRec(k));
  const [feedId, setFeedId] = useState(feeds[0]?.id ?? "");
  const [other, setOther] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<Record<string, string>>({});
  const { msg, busy, run } = useSend();
  const feed = feeds.find((x) => x.id === feedId);
  const r = recipients.find((x) => x.key === rec);
  useEffect(() => {
    if (!onDraft || !feed) return;
    const draft: Record<string, number> = {};
    for (const d of feed.dims) {
      const v = parseAmount(values[d.dimension] ?? "");
      const u = d.units.find((x) => x.id === (units[d.dimension] ?? d.units[0]?.id));
      if (v !== null && u) draft[d.base] = (draft[d.base] ?? 0) + v * u.factor;
    }
    onDraft(draft);
  }, [feed, values, units, onDraft]);
  if (recipients.length === 0) return <p className="hint">Tételt csak a listán kiválasztott állat vagy csoport kaphat.</p>;
  async function save() {
    if (!feed || !r) return;
    const quantities = feed.dims
      .filter((d) => (values[d.dimension] ?? "").trim())
      .map((d) => ({ value: values[d.dimension].trim(), unitId: units[d.dimension] ?? d.units[0].id }));
    const ok = await run(
      "/api/feeding/items",
      { day, feedId: feed.id, quantities, ...(r.animalId ? { animalId: r.animalId } : { groupId: r.groupId }), ...(feed.isOther ? { otherName: other.trim() } : {}) },
      "Tétel mentve.",
    );
    if (ok) setValues({});
  }
  return (
    <div className="toolbar" data-testid="item-form">
      <label className="field">
        Kinek
        <select className="input" value={rec} onChange={(e) => setRec(e.target.value)} aria-label="Kinek">
          {recipients.map((x) => (
            <option key={x.key} value={x.key}>
              {x.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Takarmány
        <select className="input" value={feedId} onChange={(e) => setFeedId(e.target.value)} aria-label="Takarmány">
          {feeds.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      {feed?.isOther && (
        <label className="field">
          Az egyéb takarmány neve
          <input className="input" list="egyeb-nevek-etetes" value={other} onChange={(e) => setOther(e.target.value)} aria-label="Az egyéb takarmány neve" />
          <OtherNames id="egyeb-nevek-etetes" names={otherNames} />
        </label>
      )}
      {feed?.dims.map((d) => (
        <label className="field" key={d.dimension}>
          Mennyiség ({DIM[d.dimension] ?? d.dimension})
          <span style={{ display: "flex", gap: 6 }}>
            <input
              className="input"
              inputMode="decimal"
              style={{ width: 110 }}
              value={values[d.dimension] ?? ""}
              onChange={(e) => setValues({ ...values, [d.dimension]: e.target.value })}
              aria-label={`Mennyiség (${DIM[d.dimension] ?? d.dimension})`}
            />
            <select className="input" value={units[d.dimension] ?? d.units[0]?.id} onChange={(e) => setUnits({ ...units, [d.dimension]: e.target.value })} aria-label={`Egység (${DIM[d.dimension] ?? d.dimension})`}>
              {d.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.symbol}
                </option>
              ))}
            </select>
          </span>
        </label>
      ))}
      <button className="btn" type="button" disabled={busy} onClick={() => void save()}>
        Tétel mentése
      </button>
      <Msg msg={msg} />
    </div>
  );
}

export function InvalidateButton({ url, version, label = "Érvénytelenítés" }: { url: string; version: number; label?: string }) {
  const { msg, busy, run } = useSend();
  return (
    <span>
      <button
        className="btn btn-soft"
        type="button"
        disabled={busy}
        onClick={() => {
          const reason = window.prompt("Az érvénytelenítés oka:");
          if (reason && reason.trim().length >= 3) void run(url, { expectedVersion: version, reason: reason.trim() }, "Érvénytelenítve.");
        }}
      >
        {label}
      </button>
      <Msg msg={msg} />
    </span>
  );
}

export type StatusView = { id: string; version: number; state: string; source: string; vitamin: boolean; medicine: boolean; medicineNote: string | null };

/** KIV-01, KIV-04: one withdrawal item; the use day defaults to the next day (T-10). */
export function WithdrawalForm({ day, useDay, feeds, otherNames }: { day: string; useDay: string; feeds: FeedOpt[]; otherNames?: string[] }) {
  const [feedId, setFeedId] = useState(feeds[0]?.id ?? "");
  const [other, setOther] = useState("");
  const [use, setUse] = useState(useDay);
  const [values, setValues] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<Record<string, string>>({});
  const { msg, busy, run } = useSend();
  const feed = feeds.find((x) => x.id === feedId);
  async function save() {
    if (!feed) return;
    const quantities = feed.dims
      .filter((d) => (values[d.dimension] ?? "").trim())
      .map((d) => ({ value: values[d.dimension].trim(), unitId: units[d.dimension] ?? d.units[0].id }));
    const ok = await run("/api/withdrawals/items", { day, useDay: use, feedId: feed.id, quantities, ...(feed.isOther ? { otherName: other.trim() } : {}) }, "Kivétel mentve.");
    if (ok) setValues({});
  }
  return (
    <div className="toolbar" data-testid="withdrawal-form">
      <label className="field">
        Takarmány
        <select className="input" value={feedId} onChange={(e) => setFeedId(e.target.value)} aria-label="Takarmány">
          {feeds.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      {feed?.isOther && (
        <label className="field">
          Az egyéb takarmány neve
          <input className="input" list="egyeb-nevek-kivetel" value={other} onChange={(e) => setOther(e.target.value)} aria-label="Az egyéb takarmány neve" />
          <OtherNames id="egyeb-nevek-kivetel" names={otherNames} />
        </label>
      )}
      {feed?.dims.map((d) => (
        <label className="field" key={d.dimension}>
          Mennyiség ({DIM[d.dimension] ?? d.dimension})
          <span style={{ display: "flex", gap: 6 }}>
            <input
              className="input"
              inputMode="decimal"
              style={{ width: 110 }}
              value={values[d.dimension] ?? ""}
              onChange={(e) => setValues({ ...values, [d.dimension]: e.target.value })}
              aria-label={`Mennyiség (${DIM[d.dimension] ?? d.dimension})`}
            />
            <select className="input" value={units[d.dimension] ?? d.units[0]?.id} onChange={(e) => setUnits({ ...units, [d.dimension]: e.target.value })} aria-label={`Egység (${DIM[d.dimension] ?? d.dimension})`}>
              {d.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.symbol}
                </option>
              ))}
            </select>
          </span>
        </label>
      ))}
      <label className="field">
        Felhasználás napja
        <input className="input" type="date" value={use} onChange={(e) => setUse(e.target.value)} aria-label="Felhasználás napja" />
      </label>
      <button className="btn" type="button" disabled={busy} onClick={() => void save()}>
        Kivétel mentése
      </button>
      <Msg msg={msg} />
    </div>
  );
}

/** KIV-03 "Lezárás": closes the day's input; reopening is admin work. */
export function CloseWithdrawalDay({ day }: { day: string }) {
  const { msg, busy, run } = useSend();
  return (
    <span>
      <button
        className="btn btn-soft"
        type="button"
        disabled={busy}
        onClick={() => {
          if (window.confirm("Lezárod a mai kivételt? Utána csak adminisztrátor nyithatja újra.")) void run("/api/withdrawals/close", { day }, "A nap lezárva.");
        }}
      >
        Lezárás
      </button>
      <Msg msg={msg} />
    </span>
  );
}

const WEEKDAYS = ["H", "K", "Sze", "Cs", "P", "Szo", "V"];

/** JAV-08: the weekdays an animal is planned to be fed (1 = Monday). */
export function PlanForm({ animalId, weekdays }: { animalId: string; weekdays: number[] }) {
  const [days, setDays] = useState<number[]>(weekdays);
  const { msg, busy, run } = useSend();
  return (
    <div className="toolbar" data-testid="plan-form">
      <span className="hint">Etetési napok:</span>
      {WEEKDAYS.map((label, i) => (
        <label key={label} className="check">
          <input
            type="checkbox"
            checked={days.includes(i + 1)}
            onChange={(e) => setDays(e.target.checked ? [...days, i + 1] : days.filter((d) => d !== i + 1))}
            aria-label={`Etetési nap: ${label}`}
          />
          {label}
        </label>
      ))}
      <button className="btn btn-soft" type="button" disabled={busy} onClick={() => void run("/api/feeding/plan", { animalId, weekdays: days }, "Terv mentve.")}>
        Terv mentése
      </button>
      <Msg msg={msg} />
    </div>
  );
}

/** JAV-08: selects the animals planned for the day's weekday; it only adds to the common list. */
function planText(res: Record<string, unknown>): string {
  const skipped = Array.isArray(res.skipped) ? (res.skipped as string[]) : [];
  if (skipped.length === 0) return "A terv szerinti állatok a listán.";
  return `A terv szerinti állatok a listán, kivéve, akinek ma kézi koplalónapja van: ${skipped.join(", ")}. Őket kézzel lehet felvenni.`;
}

export function ApplyPlan({ day }: { day: string }) {
  const { msg, busy, run } = useSend();
  return (
    <span>
      <button className="btn btn-soft" type="button" disabled={busy} onClick={() => void run("/api/feeding/plan/apply", { day }, planText)}>
        Lista a terv szerint
      </button>
      <Msg msg={msg} />
    </span>
  );
}

/** DAT-03: an admin sets the icon of a pool or a feed type (empty clears it). */
export function IconForm({ target, id, name, emoji }: { target: "pool" | "feedType"; id: string; name: string; emoji: string | null }) {
  const [value, setValue] = useState(emoji ?? "");
  const { msg, busy, run } = useSend();
  return (
    <span className="toolbar" style={{ margin: 0 }}>
      <input className="input" style={{ width: 70 }} value={value} onChange={(e) => setValue(e.target.value)} aria-label={`${name} ikonja`} />
      <button className="btn btn-soft" type="button" disabled={busy} onClick={() => void run("/api/admin/icon", { target, id, emoji: value.trim() }, "Ikon mentve.")}>
        Mentés
      </button>
      <Msg msg={msg} />
    </span>
  );
}

export type EatingRowView = {
  animalId: string;
  name: string;
  groupName: string | null;
  poolName: string | null;
  selected: boolean;
  pendingFasting: boolean;
  status: StatusView | null;
};

type RowDraft = { state: string; vitamin: boolean; medicine: boolean; note: string };

/**
 * The eating log with ONE save for every filled-in row (caparium-hibak-4, Balázs 2026-10-20 09:35 UTC, msg
 * 1562036548856447068: "ne egyenként kelljen menteni"). A row is sent when it has no manual status yet and a state is
 * picked, or when its manual status was changed; each row stays its own audited write on the server (its own
 * version check and request id), so one refused row does not undo the others, and it is named in the result.
 * A new row has no preselected state: the save records only what someone actually filled in.
 */
export function EatingTable({ day, rows, editable }: { day: string; rows: EatingRowView[]; editable: boolean }) {
  const router = useRouter();
  const initial = (r: EatingRowView): RowDraft => {
    const manual = r.status?.source === "MANUAL" ? r.status : null;
    return { state: manual?.state ?? "", vitamin: manual?.vitamin ?? false, medicine: manual?.medicine ?? false, note: manual?.medicineNote ?? "" };
  };
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>(() => Object.fromEntries(rows.map((r) => [r.animalId, initial(r)])));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // after a save the server's rows come back: start the drafts from them again
  useEffect(() => setDrafts(Object.fromEntries(rows.map((r) => [r.animalId, initial(r)]))), [rows]);
  const set = (id: string, patch: Partial<RowDraft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id]!, ...patch } }));
  const changed = (r: EatingRowView) => {
    const d = drafts[r.animalId];
    if (!d || !d.state) return false;
    const i = initial(r);
    return !i.state || d.state !== i.state || d.vitamin !== i.vitamin || d.medicine !== i.medicine || (d.medicine && d.note.trim() !== i.note);
  };
  const toSave = rows.filter(changed);

  async function saveAll() {
    setBusy(true);
    setMsg(null);
    let reason: string | undefined;
    const failed: string[] = [];
    let saved = 0;
    try {
      for (const r of toSave) {
        const d = drafts[r.animalId]!;
        const manual = r.status?.source === "MANUAL" ? r.status : null;
        const body = {
          day,
          animalId: r.animalId,
          state: d.state,
          vitamin: d.vitamin,
          medicine: d.medicine,
          ...(d.medicine && d.note.trim() ? { medicineNote: d.note.trim() } : {}),
          ...(manual ? { statusId: manual.id, expectedVersion: manual.version } : {}),
        };
        for (let attempt = 0; attempt < 2; attempt++) {
          const res = await fetch("/api/feeding/eating", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requestId: requestId(), clientTimestamp: new Date().toISOString(), ...body, ...(reason ? { reason } : {}) }),
          });
          if (res.ok) {
            saved += 1;
            break;
          }
          const b = (await res.json().catch(() => ({}))) as ErrorBody;
          const message = b.error?.issues?.[0]?.message ?? b.error?.message ?? "Nem sikerült.";
          // an earlier day: one reason for the whole save, asked once
          if (b.error?.code === "REASON_REQUIRED" && !reason && attempt === 0) {
            const given = window.prompt(`${message} Indoklás (minden mentett sorra):`);
            if (given && given.trim().length >= 3) {
              reason = given.trim();
              continue;
            }
          }
          failed.push(`${r.name}: ${message}`);
          break;
        }
      }
    } catch {
      failed.push("Nincs kapcsolat a szerverrel.");
    } finally {
      setBusy(false);
    }
    setMsg(
      failed.length
        ? { ok: false, text: `${saved} sor mentve, ${failed.length} nem: ${failed.join("; ")}` }
        : { ok: true, text: `${saved} sor mentve.` },
    );
    if (saved) router.refresh();
  }

  return (
    <>
      <div className="table-scroll">
        <table className="log-table" data-testid="eating-table">
          <thead>
            <tr><th>Állat</th><th>Csoport</th><th>Medence</th><th>Állapot</th><th>Jelölés</th>{editable && <th>Rögzítés</th>}</tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = r.status;
              const d = drafts[r.animalId] ?? initial(r);
              const states = r.selected ? ["EATEN", "PARTIAL", "NOT_EATEN"] : ["FASTING"];
              const manual = s?.source === "MANUAL" ? s : null;
              return (
                <tr key={r.animalId} className={changed(r) ? "active-row" : undefined}>
                  <td>{r.name}</td>
                  <td>{r.groupName ?? "–"}</td>
                  <td>{r.poolName ?? "–"}</td>
                  <td className="keep">
                    {s ? (
                      <span className={`badge eat-${s.state}`} data-testid={`state-${r.name}`}>
                        {EAT_LABEL[s.state]}
                        {s.source === "AUTOMATIC" ? " (automatikus)" : ""}
                      </span>
                    ) : r.pendingFasting ? (
                      <span className="badge eat-pending" data-testid={`state-${r.name}`}>koplal, még nem végleges</span>
                    ) : (
                      <span className="hint" data-testid={`state-${r.name}`}>{r.selected ? "nincs rögzítve" : "–"}</span>
                    )}
                  </td>
                  <td>
                    {s?.vitamin ? "V " : ""}
                    {s?.medicine ? `Gy${s.medicineNote ? `: ${s.medicineNote}` : ""}` : ""}
                  </td>
                  {editable && (
                    <td className="keep">
                      <div className="toolbar" style={{ margin: 0 }} data-testid={`eating-${r.name}`}>
                        <select className="input" value={d.state} onChange={(e) => set(r.animalId, { state: e.target.value })} aria-label={`${r.name} evési állapota`}>
                          <option value="">– válassz –</option>
                          {states.map((x) => (
                            <option key={x} value={x}>
                              {EAT_LABEL[x]}
                            </option>
                          ))}
                        </select>
                        <label className="check">
                          <input type="checkbox" checked={d.vitamin} onChange={(e) => set(r.animalId, { vitamin: e.target.checked })} aria-label={`${r.name} vitamin`} />V
                        </label>
                        <label className="check">
                          <input type="checkbox" checked={d.medicine} onChange={(e) => set(r.animalId, { medicine: e.target.checked })} aria-label={`${r.name} gyógyszer`} />Gy
                        </label>
                        {d.medicine && (
                          <input className="input" value={d.note} onChange={(e) => set(r.animalId, { note: e.target.value })} placeholder="Gyógyszer megjegyzés" aria-label={`${r.name} gyógyszer megjegyzés`} />
                        )}
                        {manual && <InvalidateButton url={`/api/feeding/eating/${manual.id}/invalidate`} version={manual.version} label="Törlés (érvénytelenítés)" />}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button className="btn" type="button" disabled={busy || toSave.length === 0} onClick={() => void saveAll()} data-testid="eating-save-all">
            {toSave.length ? `Mentés (${toSave.length} sor)` : "Mentés"}
          </button>
          {msg && (
            <span className={msg.ok ? "hint" : "err"} role="status" data-testid="eating-save-result">
              {msg.text}
            </span>
          )}
        </div>
      )}
    </>
  );
}
