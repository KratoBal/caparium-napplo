"use client";

// Forms of the feeding log and the eating log (EGY-01..EGY-12, EVE-01..EVE-05). The server decides
// every permission; a confirmation (R-3, an empty list) or a reason (admin, an earlier or closed day)
// is asked only when the server says it is needed.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EAT_LABEL } from "@/lib/eating-labels";
import { askReason, useReasonsOn } from "./ReasonSwitch";
import { useLeaveWarning } from "./useLeaveWarning";

function requestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

type ErrorBody = { error?: { code?: string; message?: string; issues?: { message: string }[] } };

export function useSend() {
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

export function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg?.text) return null;
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
          void run("/api/feeding/selection", { day, animalIds: [animalId], selected: next }, "").then((ok) => {
            if (!ok) setShown(!next);
          });
        }}
      />
      {/* Lili 2026-10-26 (Caparium channel msg 1564356412946124921, item 2): no "Kiválasztva." / "Kivéve." beside the
          tick; only a refusal is said */}
      {msg && !msg.ok && <Msg msg={msg} />}
    </label>
  );
}

/**
 * A pool's one switch (Lili 2026-10-26, item 3, replacing the two buttons "Összes kijelölése" and "Egyik sem"): on =
 * every animal of the line is on the day's list, off = none. Switching it on selects the members one by one; off takes
 * them off, with the usual confirmation if an animal already has an item or a status that day.
 */
export function GroupSwitch({ day, name, memberIds, selectedCount }: { day: string; name: string; memberIds: string[]; selectedCount: number }) {
  const { msg, busy, run } = useSend();
  const allOn = memberIds.length > 0 && selectedCount === memberIds.length;
  // shown at once, rolled back when the server refuses (the refresh brings the stored state), as the animal's tick
  const [shown, setShown] = useState(allOn);
  useEffect(() => setShown(allOn), [allOn]);
  return (
    <span className="switch-wrap">
      <input
        className="switch"
        type="checkbox"
        role="switch"
        checked={shown}
        disabled={busy}
        aria-label={`${name}: mind kijelölve`}
        title={shown ? "Mind kijelölve: kikapcsolva egyik sem" : "Bekapcsolva mind kijelölve"}
        onChange={(e) => {
          const next = e.target.checked;
          setShown(next);
          void run("/api/feeding/selection", { day, animalIds: memberIds, selected: next }, "").then((ok) => {
            if (!ok) setShown(!next);
          });
        }}
      />
      {msg && !msg.ok && <Msg msg={msg} />}
    </span>
  );
}

export type FeedTypeOpt = { code: string; name: string; emoji: string | null; feeds: { id: string; name: string }[] };

/**
 * The list's second step (6fe63c9b): the feeds given that day, by type. Saved for the day; the item form and the
 * feeding sheet then offer only these (and "Egyéb"). Nothing chosen offers every feed, as before.
 */
export function DayFeeds({
  day,
  types,
  chosen,
  editable,
  finalized,
}: {
  day: string;
  types: FeedTypeOpt[];
  chosen: string[];
  editable: boolean;
  finalized: boolean;
}) {
  const [picked, setPicked] = useState<string[]>(chosen);
  // reset only when the SAVED choice changes: a refresh after another action brings a new array with the same
  // content, and resetting on it dropped a tick not saved yet (measured in the e2e)
  const chosenKey = [...chosen].sort().join();
  useEffect(() => setPicked(chosenKey ? chosenKey.split(",") : []), [chosenKey]);
  const { msg, busy, run } = useSend();
  const changed = [...picked].sort().join() !== [...chosen].sort().join();
  return (
    <div data-testid="day-feeds">
      {types.map((t) => (
        <div key={t.code} className="pick-block" data-testid={`feed-type-${t.name}`}>
          <div className="section-title">
            {t.emoji && <span aria-hidden="true">{t.emoji}</span>}
            {t.name}
          </div>
          <div className="pick-items">
          {t.feeds.map((f) => (
            <label key={f.id} className="check">
              <input
                type="checkbox"
                checked={picked.includes(f.id)}
                disabled={!editable || busy}
                aria-label={`A nap takarmánya: ${f.name}`}
                onChange={(e) => {
                  // functional: two quick ticks before a re-render must not overwrite each other (seen in the e2e)
                  const on = e.target.checked;
                  setPicked((cur) => (on ? [...new Set([...cur, f.id])] : cur.filter((x) => x !== f.id)));
                }}
              />
              {f.name}
            </label>
          ))}
          </div>
        </div>
      ))}
      {editable && (
        <div className="toolbar">
          {finalized ? (
            <>
              <FinalizeList day={day} finalized editable />
              {/* after the list is ready, a changed choice still needs a way in; the button shows only then */}
              {changed && (
                <button className="btn" type="button" disabled={busy} onClick={() => void run("/api/feeding/day-feeds", { day, feedIds: picked }, "A nap takarmányai mentve.")}>
                  A nap takarmányainak mentése
                </button>
              )}
            </>
          ) : (
            <button className="btn" type="button" disabled={busy} onClick={() => void ready()}>
              Takarmánylap kész
            </button>
          )}
          <Msg msg={msg} />
        </div>
      )}
    </div>
  );

  /**
   * Lili 2026-10-27 22:47 UTC: ONE button records the choice above and makes the feeding sheet. A changed choice is
   * saved first; when that fails, the list is not finalized (the ticks would be lost behind a finished sheet).
   */
  async function ready() {
    if (changed && !(await run("/api/feeding/day-feeds", { day, feedIds: picked }, ""))) return;
    if (await run("/api/feeding/finalize", { day }, "")) scrollToSheet();
  }
}

const scrollToSheet = () =>
  document.querySelector("[data-testid=feeding-sheet]")?.scrollIntoView({ behavior: "smooth", block: "start" });

/**
 * Lili 2026-10-27 12:18 and 12:23 UTC (item 5): one button at the bottom of the day's choice. Ticked animals and feeds, then
 * "Takarmánylap kész" finalizes the list and brings the feeding sheet into view. Once finalized, the same place shows the
 * state (the header's "Lista nincs kész" badge is gone).
 */
export function FinalizeList({ day, finalized, editable }: { day: string; finalized: boolean; editable: boolean }) {
  const { msg, busy, run } = useSend();
  if (finalized || !editable) {
    return (
      <span className={`badge ${finalized ? "badge-valid" : "badge-pending"}`} data-testid="list-state">
        {finalized ? "Takarmánylap kész" : "Takarmánylap nincs kész"}
      </span>
    );
  }
  async function finalize() {
    if (await run("/api/feeding/finalize", { day }, "")) scrollToSheet();
  }
  return (
    <span>
      <button className="btn" type="button" disabled={busy} onClick={() => void finalize()}>
        Takarmánylap kész
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
  /** a tick on the feeding sheet (given or not), no quantity there; the item form still takes one (6fe63c9b, 7) */
  tick?: true;
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

/**
 * Lili 2026-10-27 12:42 UTC (item 8): a saved item loaded into its form by the row's "Módosítás" button. Saving sends the item's
 * id and version, so the same item is updated (the server checks the version and writes the audit entry), not a new one added.
 */
export type EditItem = {
  id: string;
  version: number;
  feedId: string;
  otherName: string | null;
  quantities: { value: string; unitId: string; dimension: string }[];
  /** the feeding item's recipient key (animal id or g:<group id>) */
  recipient?: string;
  /** the withdrawal item's use day */
  useDay?: string;
};

/** The form's fields from an item: the amounts with a decimal comma, as typed elsewhere. */
function editFields(item: EditItem) {
  return {
    values: Object.fromEntries(item.quantities.map((q) => [q.dimension, q.value.replace(".", ",")])),
    units: Object.fromEntries(item.quantities.map((q) => [q.dimension, q.unitId])),
  };
}

/** "Módosítás" in a list row: quiet, beside "Érvénytelenítés" (item 8). */
export function EditButton({ label, onEdit }: { label: string; onEdit: () => void }) {
  return (
    <button className="btn btn-row" type="button" onClick={onEdit} aria-label={`${label}: módosítás`}>
      Módosítás
    </button>
  );
}

function EditBar({ busy, onCancel }: { busy: boolean; onCancel: () => void }) {
  return (
    <button className="btn btn-soft" type="button" disabled={busy} onClick={onCancel}>
      Mégse
    </button>
  );
}

/** Brings a form being loaded with an item into view. */
function showForm(testId: string) {
  document.querySelector(`[data-testid=${testId}]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

export function ItemForm({
  day,
  recipients,
  feeds,
  otherNames,
  active,
  onActive,
  onDraft,
  editing,
  onEditDone,
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
  /** item 8: the item loaded by a row's "Módosítás" */
  editing?: EditItem | null;
  onEditDone?: () => void;
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
  useEffect(() => {
    if (!editing) return;
    if (editing.recipient) setRec(editing.recipient);
    setFeedId(editing.feedId);
    setOther(editing.otherName ?? "");
    const f = editFields(editing);
    setValues(f.values);
    setUnits(f.units);
    showForm("item-form");
    // the load runs once per chosen item
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  if (recipients.length === 0) return <p className="hint">Tételt csak a listán kiválasztott állat vagy csoport kaphat.</p>;
  async function save() {
    if (!feed || !r) return;
    const quantities = feed.dims
      .filter((d) => (values[d.dimension] ?? "").trim())
      .map((d) => ({ value: values[d.dimension].trim(), unitId: units[d.dimension] ?? d.units[0].id }));
    const ok = await run(
      "/api/feeding/items",
      {
        day,
        feedId: feed.id,
        quantities,
        ...(r.animalId ? { animalId: r.animalId } : { groupId: r.groupId }),
        ...(feed.isOther ? { otherName: other.trim() } : {}),
        ...(editing ? { itemId: editing.id, expectedVersion: editing.version } : {}),
      },
      editing ? "Tétel módosítva." : "Tétel mentve.",
    );
    if (ok) {
      setValues({});
      onEditDone?.();
    }
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
        {editing ? "Módosítás mentése" : "Tétel mentése"}
      </button>
      {editing && <EditBar busy={busy} onCancel={() => { setValues({}); onEditDone?.(); }} />}
      <Msg msg={msg} />
    </div>
  );
}

export function InvalidateButton({ url, version, label = "Érvénytelenítés", row = false }: { url: string; version: number; label?: string; row?: boolean }) {
  const { msg, busy, run } = useSend();
  const reasonsOn = useReasonsOn();
  return (
    <span>
      <button
        className={row ? "btn btn-row" : "btn btn-soft"}
        type="button"
        disabled={busy}
        onClick={() => {
          const asked = askReason(reasonsOn, "Az érvénytelenítés oka:", "Érvényteleníted ezt a tételt?");
          if (asked) void run(url, { expectedVersion: version, ...asked }, "Érvénytelenítve.");
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
export function WithdrawalForm({
  day,
  useDay,
  feeds,
  otherNames,
  editing,
  onEditDone,
}: {
  day: string;
  useDay: string;
  feeds: FeedOpt[];
  otherNames?: string[];
  /** item 8: the item loaded by a row's "Módosítás" */
  editing?: EditItem | null;
  onEditDone?: () => void;
}) {
  const [feedId, setFeedId] = useState(feeds[0]?.id ?? "");
  const [other, setOther] = useState("");
  const [use, setUse] = useState(useDay);
  const [values, setValues] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<Record<string, string>>({});
  const { msg, busy, run } = useSend();
  const feed = feeds.find((x) => x.id === feedId);
  useEffect(() => {
    if (!editing) return;
    setFeedId(editing.feedId);
    setOther(editing.otherName ?? "");
    if (editing.useDay) setUse(editing.useDay);
    const f = editFields(editing);
    setValues(f.values);
    setUnits(f.units);
    showForm("withdrawal-form");
  }, [editing]);
  function reset() {
    setValues({});
    setUse(useDay);
    onEditDone?.();
  }
  async function save() {
    if (!feed) return;
    const quantities = feed.dims
      .filter((d) => (values[d.dimension] ?? "").trim())
      .map((d) => ({ value: values[d.dimension].trim(), unitId: units[d.dimension] ?? d.units[0].id }));
    const ok = await run(
      "/api/withdrawals/items",
      {
        day,
        useDay: use,
        feedId: feed.id,
        quantities,
        ...(feed.isOther ? { otherName: other.trim() } : {}),
        ...(editing ? { itemId: editing.id, expectedVersion: editing.version } : {}),
      },
      editing ? "Kivétel módosítva." : "Kivétel mentve.",
    );
    if (ok) {
      if (editing) reset();
      else setValues({});
    }
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
        {editing ? "Módosítás mentése" : "Kivétel mentése"}
      </button>
      {editing && <EditBar busy={busy} onCancel={reset} />}
      <Msg msg={msg} />
    </div>
  );
}

export type WithdrawalRow = {
  id: string;
  version: number;
  type: string;
  feedId: string;
  feed: string;
  otherName: string | null;
  quantities: { value: string; unit: string; unitId: string; dimension: string }[];
  useDay: string;
};

/**
 * KIV-01 and item 8 (Lili 2026-10-27 12:42 UTC): the day's withdrawal items and the form under them. A row's "Módosítás" loads the
 * item into the form; saving updates that item. A feed no longer active cannot be chosen in the form, so its row has no "Módosítás".
 */
export function WithdrawalItems({ day, useDay, feeds, otherNames, items, editable }: { day: string; useDay: string; feeds: FeedOpt[]; otherNames?: string[]; items: WithdrawalRow[]; editable: boolean }) {
  const [editing, setEditing] = useState<EditItem | null>(null);
  return (
    <>
      <div className="table-scroll">
        <table className="log-table" data-testid="withdrawal-list">
          <thead>
            <tr><th>Típus</th><th>Takarmány</th><th>Mennyiség</th><th>Felhasználás napja</th><th></th></tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const name = i.otherName ? `${i.feed}: ${i.otherName}` : i.feed;
              return (
                <tr key={i.id} className={editing?.id === i.id ? "active-row" : undefined}>
                  <td>{i.type}</td>
                  <td>{name}</td>
                  <td>{i.quantities.map((q) => `${q.value.replace(".", ",")} ${q.unit}`).join(" + ")}</td>
                  <td>{i.useDay}</td>
                  <td className="keep">
                    {editable && (
                      <span className="row-actions">
                        {feeds.some((f) => f.id === i.feedId) && <EditButton label={name} onEdit={() => setEditing({ id: i.id, version: i.version, feedId: i.feedId, otherName: i.otherName, quantities: i.quantities, useDay: i.useDay })} />}
                        <InvalidateButton url={`/api/withdrawals/items/${i.id}/invalidate`} version={i.version} row />
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editable && <WithdrawalForm day={day} useDay={useDay} feeds={feeds} otherNames={otherNames} editing={editing} onEditDone={() => setEditing(null)} />}
    </>
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
  // Lili 2026-10-27 (item 4): the plain success says nothing in the header bar; the ticked boxes show it
  if (skipped.length === 0) return "";
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
const EATING_LEAVE_WARNING = "Van még nem mentett sor az evési naplóban. Ha most továbblépsz, elveszik. Továbblépsz mentés nélkül?";

export function EatingTable({ day, rows, editable }: { day: string; rows: EatingRowView[]; editable: boolean }) {
  const router = useRouter();
  const initial = (r: EatingRowView): RowDraft => {
    const manual = r.status?.source === "MANUAL" ? r.status : null;
    // a manual state the row no longer offers (the animal left the list) is not carried into the draft
    const states = r.selected ? ["EATEN", "PARTIAL", "NOT_EATEN"] : ["FASTING"];
    return {
      state: manual && states.includes(manual.state) ? manual.state : "",
      vitamin: manual?.vitamin ?? false,
      medicine: manual?.medicine ?? false,
      note: manual?.medicineNote ?? "",
    };
  };
  // what the server says about a row: a change of it (a save, an invalidation, someone else) restarts that row's draft
  const serverKey = (r: EatingRowView) => `${r.selected}|${r.status?.id ?? ""}|${r.status?.version ?? ""}|${r.status?.source ?? ""}`;
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>(() => Object.fromEntries(rows.map((r) => [r.animalId, initial(r)])));
  const seen = useRef<Record<string, string>>(Object.fromEntries(rows.map((r) => [r.animalId, serverKey(r)])));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // after a refresh only the rows whose server state changed start again; every other filled-in row keeps its draft
  // (review of #31: a refresh from an invalidation or a partly refused save must not drop the rest)
  useEffect(() => {
    const changedRows = rows.filter((r) => seen.current[r.animalId] !== serverKey(r));
    seen.current = Object.fromEntries(rows.map((r) => [r.animalId, serverKey(r)]));
    if (changedRows.length) setDrafts((d) => ({ ...d, ...Object.fromEntries(changedRows.map((r) => [r.animalId, initial(r)])) }));
  }, [rows]);
  const set = (id: string, patch: Partial<RowDraft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id]!, ...patch } }));
  const changed = (r: EatingRowView) => {
    const d = drafts[r.animalId];
    if (!d || !d.state) return false;
    const i = initial(r);
    return !i.state || d.state !== i.state || d.vitamin !== i.vitamin || d.medicine !== i.medicine || (d.medicine && d.note.trim() !== i.note);
  };
  const toSave = rows.filter(changed);
  // Lili (acrobot 34629, 2026-10-21): the fasting rows invited a click on every row, although the close makes them
  // fasting days by itself. There a row shows its state only; the recording controls open per row on request
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  // acrobot 34710 (barracuda on #50): unsaved rows ask before the page or an in-app link (the day navigation too) is
  // left, as the feeding sheet and the measurement page do; the browser's back button is neither, so it is not asked
  useLeaveWarning(editable ? toSave.length : 0, EATING_LEAVE_WARNING);

  async function saveAll() {
    setBusy(true);
    setMsg(null);
    let reason: string | undefined;
    let stopped = false;
    const failed: string[] = [];
    let saved = 0;
    try {
      for (const r of toSave) {
        if (stopped) break;
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
            // no reason given: the rest is not asked again one by one, the save stops here
            stopped = true;
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
        ? { ok: false, text: `${saved} sor mentve, ${failed.length} nem: ${failed.join("; ")}${stopped ? " (a mentés indoklás nélkül megállt)" : ""}` }
        : { ok: true, text: `${saved} sor mentve.` },
    );
    if (saved) router.refresh();
  }

  const fed = rows.filter((r) => r.selected);
  const fasting = rows.filter((r) => !r.selected);
  const head = (
    <thead>
      <tr><th>Állat</th><th>Csoport</th><th>Medence</th><th>Állapot</th><th>Jelölés</th>{editable && <th>Rögzítés</th>}</tr>
    </thead>
  );
  const row = (r: EatingRowView) => {
    const s = r.status;
    const d = drafts[r.animalId] ?? initial(r);
    const states = r.selected ? ["EATEN", "PARTIAL", "NOT_EATEN"] : ["FASTING"];
    const manual = s?.source === "MANUAL" ? s : null;
    // a fasting row keeps its controls folded unless asked for, or unless something is recorded or typed on it
    const folded = !r.selected && !opened.has(r.animalId) && !manual && !changed(r);
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
        {editable && folded && (
          <td className="keep">
            <button
              className="btn btn-soft small"
              type="button"
              onClick={() => setOpened((cur) => new Set(cur).add(r.animalId))}
              aria-label={`${r.name}: kivétel rögzítése`}
            >
              Kivétel rögzítése
            </button>
          </td>
        )}
        {editable && !folded && (
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
  };
  // caparium-hibak-5 (Balázs 2026-10-20 11:32 UTC, msg 1562065965305298957): the log is about who was fed (today's
  // list); everyone else gets the automatic fasting day at the close, nothing to fill in. They stay one click away,
  // folded, for a vitamin or medicine mark on a fasting day.
  return (
    <>
      <div className="table-scroll">
        <table className="log-table" data-testid="eating-table">
          {head}
          <tbody>{fed.map(row)}</tbody>
        </table>
      </div>
      {fed.length === 0 && <p className="hint">Ma még senki nincs a napi etetési listán.</p>}
      {fasting.length > 0 && (
        <details style={{ marginTop: 12 }} data-testid="eating-fasting">
          <summary>
            Koplalónapos állatok ({fasting.length}): nincsenek a napi listán, a lista lezárásakor automatikusan koplalónapot kapnak; csak a kivételt kell rögzíteni (például vitamin vagy gyógyszer)
          </summary>
          <div className="table-scroll">
            <table className="log-table" data-testid="eating-fasting-table">
              {head}
              <tbody>{fasting.map(row)}</tbody>
            </table>
          </div>
        </details>
      )}
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
