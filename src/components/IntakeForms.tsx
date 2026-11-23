"use client";

// The Takarmányhűtő page's form and list (Lili 2026-10-29, package item 9): what arrives in the freezer. The form is the
// withdrawal form's (feed, amounts, units) with a note and a "Visszaküldve" tick instead of the use day. The server
// decides every permission and writes the audit entry.
import { useEffect, useState } from "react";
import { intakeDefaultUnit } from "@/lib/intake-unit";
import { formatDay } from "@/lib/time";
import { useTr } from "./LangProvider";
import { DIM, EditBar, EditButton, InvalidateButton, Msg, OtherNames, editFields, showForm, useSend, type EditItem, type FeedOpt } from "./FeedingForms";

export type IntakeRow = {
  id: string;
  version: number;
  type: string;
  feedId: string;
  feed: string;
  otherName: string | null;
  note: string | null;
  returned: boolean;
  quantities: { value: string; unit: string; unitId: string; dimension: string }[];
};

type IntakeEdit = EditItem & { note: string | null; returned: boolean };

/** One intake item: feed, amounts, a note, "Visszaküldve", then "Mentés". */
export function IntakeForm({ day, feeds, otherNames, editing, onEditDone }: { day: string; feeds: FeedOpt[]; otherNames?: string[]; editing?: IntakeEdit | null; onEditDone?: () => void }) {
  const tr = useTr();
  const [feedId, setFeedId] = useState(feeds[0]?.id ?? "");
  const [other, setOther] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [returned, setReturned] = useState(false);
  const { msg, busy, run } = useSend();
  const feed = feeds.find((x) => x.id === feedId);
  useEffect(() => {
    if (!editing) return;
    setFeedId(editing.feedId);
    setOther(editing.otherName ?? "");
    setNote(editing.note ?? "");
    setReturned(editing.returned);
    const f = editFields(editing);
    setValues(f.values);
    setUnits(f.units);
    showForm("intake-form");
  }, [editing]);
  function clear() {
    setValues({});
    setNote("");
    setReturned(false);
  }
  async function save() {
    if (!feed) return;
    const quantities = feed.dims
      .filter((d) => (values[d.dimension] ?? "").trim())
      .map((d) => ({ value: values[d.dimension].trim(), unitId: units[d.dimension] ?? intakeDefaultUnit(d.units)! }));
    const ok = await run(
      "/api/feed-intake/items",
      {
        day,
        feedId: feed.id,
        quantities,
        returned,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(feed.isOther ? { otherName: other.trim() } : {}),
        ...(editing ? { itemId: editing.id, expectedVersion: editing.version } : {}),
      },
      editing ? tr("Tétel módosítva.") : tr("Tétel mentve."),
    );
    if (ok) {
      clear();
      if (editing) onEditDone?.();
    }
  }
  return (
    <div className="toolbar" data-testid="intake-form">
      <label className="field">
        {tr("Takarmány")}
        <select className="input" value={feedId} onChange={(e) => setFeedId(e.target.value)} aria-label={tr("Takarmány")}>
          {feeds.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      {feed?.isOther && (
        <label className="field">
          {tr("Az egyéb takarmány neve")}
          <input className="input" list="egyeb-nevek-huto" value={other} onChange={(e) => setOther(e.target.value)} aria-label={tr("Az egyéb takarmány neve")} />
          <OtherNames id="egyeb-nevek-huto" names={otherNames} />
        </label>
      )}
      {feed?.dims.map((d) => (
        <label className="field" key={d.dimension}>
          {tr("Mennyiség ({x})", { x: tr(DIM[d.dimension] ?? d.dimension) })}
          <span style={{ display: "flex", gap: 6 }}>
            <input
              className="input"
              inputMode="decimal"
              style={{ width: 110 }}
              value={values[d.dimension] ?? ""}
              onChange={(e) => setValues({ ...values, [d.dimension]: e.target.value })}
              aria-label={tr("Mennyiség ({x})", { x: tr(DIM[d.dimension] ?? d.dimension) })}
            />
            <select className="input" value={units[d.dimension] ?? intakeDefaultUnit(d.units)} onChange={(e) => setUnits({ ...units, [d.dimension]: e.target.value })} aria-label={tr("Egység ({x})", { x: tr(DIM[d.dimension] ?? d.dimension) })}>
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
        {tr("Megjegyzés")}
        <input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} aria-label={tr("Megjegyzés")} />
      </label>
      <label className="field">
        {tr("Visszaküldve")}
        <input type="checkbox" checked={returned} onChange={(e) => setReturned(e.target.checked)} aria-label={tr("Visszaküldve")} />
      </label>
      <button className="btn" type="button" disabled={busy} onClick={() => void save()}>
        {editing ? tr("Módosítás mentése") : tr("Mentés")}
      </button>
      {editing && (
        <EditBar
          busy={busy}
          onCancel={() => {
            clear();
            onEditDone?.();
          }}
        />
      )}
      <Msg msg={msg} />
    </div>
  );
}

/** The day's intake items and the form under them. A returned one shows, marked, and does not count in the stock. */
export function IntakeItems({ day, feeds, otherNames, items, editable }: { day: string; feeds: FeedOpt[]; otherNames?: string[]; items: IntakeRow[]; editable: boolean }) {
  const tr = useTr();
  const [editing, setEditing] = useState<IntakeEdit | null>(null);
  return (
    <>
      {/* no item yet: no table, only the form (a header alone stood above the form as if its column heads, Lili's picture 5, 2026-11-18) */}
      {items.length > 0 && (
        <div className="table-scroll">
          <table className="log-table" data-testid="intake-list">
            <thead>
              <tr><th>{tr("Típus")}</th><th>{tr("Takarmány")}</th><th>{tr("Mennyiség")}</th><th>{tr("Megjegyzés")}</th><th>{tr("Visszaküldve")}</th><th></th></tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const name = i.otherName ? `${i.feed}: ${i.otherName}` : i.feed;
                return (
                  <tr key={i.id} className={editing?.id === i.id ? "active-row" : undefined} data-returned={i.returned ? "yes" : "no"}>
                    <td>{tr(i.type)}</td>
                    <td>{name}</td>
                    <td>{i.quantities.map((q) => `${q.value.replace(".", ",")} ${q.unit}`).join(" + ")}</td>
                    <td>{i.note ?? ""}</td>
                    <td>{i.returned ? tr("igen") : ""}</td>
                    <td className="keep">
                      {editable && (
                        <span className="row-actions">
                          {feeds.some((f) => f.id === i.feedId) && (
                            <EditButton label={name} onEdit={() => setEditing({ id: i.id, version: i.version, feedId: i.feedId, otherName: i.otherName, quantities: i.quantities, note: i.note, returned: i.returned })} />
                          )}
                          <InvalidateButton url={`/api/feed-intake/items/${i.id}/invalidate`} version={i.version} row />
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editable && <IntakeForm day={day} feeds={feeds} otherNames={otherNames} editing={editing} onEditDone={() => setEditing(null)} />}
    </>
  );
}

/**
 * The stock's first day (Lili 2026-10-30, acrobot 38592): what is dated before it is archive. It stays in the logs, the
 * reports and the exports at full value and is not in the stock, so old data can be entered back in time without
 * touching the stock, and nothing has to be deleted. Everyone sees the day; only an admin sets it.
 */
export function StockStart({ start, today, canSet }: { start: string | null; today: string; canSet: boolean }) {
  const tr = useTr();
  const [value, setValue] = useState(start ?? "");
  const { msg, busy, run } = useSend();
  return (
    <div data-testid="stock-start">
      <p className="hint">
        {start
          ? tr("A készlet kezdete: {formatDay}. Ami ennél korábbi, az archívum: a naplóban, a kimutatásokban és az exportban teljes értékű, a készletbe nem számít.", { formatDay: formatDay(start).replace(/\.$/, "") })
          : tr("A készlet kezdete: takarmányonként az első be nem küldött bevételezés napja. Egy kifejezett kezdőnapot adminisztrátor állíthat.")}
      </p>
      {canSet && (
        <div className="toolbar">
          <label className="field">
            {tr("A készlet kezdőnapja")}
            <input className="input" type="date" max={today} value={value} onChange={(e) => setValue(e.target.value)} aria-label={tr("A készlet kezdőnapja")} />
          </label>
          <button className="btn" type="button" disabled={busy || !value} onClick={() => void run("/api/feed-intake/stock-start", { start: value }, tr("A készlet kezdete beállítva."))}>
            {tr("Kezdőnap mentése")}
          </button>
          <button
            className="btn btn-soft"
            type="button"
            disabled={busy || !start}
            onClick={() => {
              setValue("");
              void run("/api/feed-intake/stock-start", { start: "" }, tr("A kezdőnap törölve: az első bevételezéstől számít."));
            }}
          >
            {tr("Alaphelyzet")}
          </button>
          <Msg msg={msg} />
        </div>
      )}
    </div>
  );
}
