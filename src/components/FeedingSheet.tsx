"use client";

// THE FEEDING SHEET (6fe63c9b, Lili's request; Balázs 2026-10-21 10:38 UTC "mehet"): the day's two steps as one
// table. Rows: the recipients chosen in step 1 (animals, and groups with a chosen member); columns: the feeds chosen
// in step 2. A click on a row makes it active, as on the measurement page; the active row takes amounts in each
// feed's base unit, and "Sor mentése" records one item per filled cell through the same endpoint as the item form,
// so the eating log and the exports read the same data. Totals per row and per column, per unit (g, ml and db are
// never added together). Printable alone.
import { useState } from "react";

function newRequestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
import { Msg, parseAmount, useSend, type FeedOpt, type Recipient } from "./FeedingForms";

type SheetItem = {
  animalId: string | null;
  groupId: string | null;
  feedId: string;
  baseQuantities: { unit: string; value: number }[];
};

const num = (v: number) => String(Math.round(v * 10000) / 10000).replace(".", ",");
const fmt = (t: Record<string, number>) =>
  Object.entries(t)
    .filter(([, v]) => v !== 0)
    .map(([u, v]) => `${num(v)} ${u}`)
    .join(", ");
const add = (t: Record<string, number>, unit: string, v: number) => {
  t[unit] = (t[unit] ?? 0) + v;
};

/** The unit a sheet cell is typed in: the base unit of the feed's first dimension. */
function cellUnit(feed: FeedOpt) {
  const d = feed.dims[0];
  if (!d) return null;
  const u = d.units.find((x) => x.symbol === d.base) ?? d.units.find((x) => x.factor === 1) ?? d.units[0];
  return u ? { id: u.id, symbol: u.symbol } : null;
}

export function FeedingSheet({
  day,
  editable,
  recipients,
  feeds,
  items,
  active,
  onActive,
}: {
  day: string;
  editable: boolean;
  recipients: Recipient[];
  /** the columns: the day's feeds (step 2), or the feeds already given that day if none were chosen */
  feeds: FeedOpt[];
  items: SheetItem[];
  active: string;
  onActive: (key: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  // barracuda #41: a cell keeps ONE request id until it is saved, so a lost answer and a second "Sor mentése" replay
  // the same item instead of recording it twice (the measurement grid's rule); a new value is a new request
  const [requestIds, setRequestIds] = useState<Record<string, string>>({});
  const [bad, setBad] = useState<string[]>([]);
  const [localMsg, setLocalMsg] = useState<string | null>(null);
  const { msg, busy, run } = useSend();
  const keyOf = (i: SheetItem) => i.animalId ?? `g:${i.groupId}`;
  const cell = (rec: string, feedId: string) => {
    const t: Record<string, number> = {};
    for (const i of items) if (keyOf(i) === rec && i.feedId === feedId) for (const q of i.baseQuantities) add(t, q.unit, q.value);
    return t;
  };
  const rowTotal = (rec: string) => {
    const t: Record<string, number> = {};
    for (const i of items) if (keyOf(i) === rec && feeds.some((f) => f.id === i.feedId)) for (const q of i.baseQuantities) add(t, q.unit, q.value);
    return t;
  };
  const colTotal = (feedId: string) => {
    const t: Record<string, number> = {};
    for (const i of items) if (i.feedId === feedId && recipients.some((r) => r.key === keyOf(i))) for (const q of i.baseQuantities) add(t, q.unit, q.value);
    return t;
  };
  const grand: Record<string, number> = {};
  for (const f of feeds) for (const [u, v] of Object.entries(colTotal(f.id))) add(grand, u, v);

  async function saveRow() {
    const r = recipients.find((x) => x.key === active);
    if (!r) return;
    // a filled cell that is not a number is never skipped silently (barracuda #41): it is marked, and nothing of the
    // row is sent until it is fixed
    const invalid = feeds.filter((f) => {
      const raw = (values[f.id] ?? "").trim();
      return raw !== "" && (!cellUnit(f) || parseAmount(raw) === null);
    });
    setBad(invalid.map((f) => f.id));
    if (invalid.length) {
      setLocalMsg(`${invalid.length} cella nem menthető: érvénytelen mennyiség (${invalid.map((f) => f.name).join(", ")}).`);
      return;
    }
    setLocalMsg(null);
    for (const f of feeds) {
      const raw = (values[f.id] ?? "").trim();
      if (!raw) continue;
      const unit = cellUnit(f)!;
      const key = `${r.key}|${f.id}|${raw}`;
      const id = requestIds[key] ?? newRequestId();
      if (!requestIds[key]) setRequestIds((m) => ({ ...m, [key]: id }));
      const ok = await run(
        "/api/feeding/items",
        { requestId: id, day, feedId: f.id, quantities: [{ value: raw, unitId: unit.id }], ...(r.animalId ? { animalId: r.animalId } : { groupId: r.groupId }) },
        "Sor mentve.",
      );
      if (!ok) return;
      setValues((v) => ({ ...v, [f.id]: "" }));
      setRequestIds((m) => {
        const next = { ...m };
        delete next[key];
        return next;
      });
    }
  }
  function printSheet() {
    document.body.classList.add("print-sheet");
    window.print();
    document.body.classList.remove("print-sheet");
  }
  const filled = feeds.some((f) => (values[f.id] ?? "").trim() !== "");
  // "Egyéb" needs its real name per item: it stays on the item form, not in a sheet column
  return (
    <div className="card feeding-sheet" data-testid="feeding-sheet">
      <div className="toolbar">
        <h2>Takarmánylap, {day}</h2>
        <span className="spacer" />
        <button className="btn btn-soft no-print" type="button" onClick={printSheet}>
          Takarmánylap nyomtatása
        </button>
      </div>
      {feeds.length === 0 ? (
        <p className="hint">Válaszd ki fent a nap takarmányait: a takarmánylap oszlopai ezek lesznek.</p>
      ) : recipients.length === 0 ? (
        <p className="hint">Előbb jelöld ki az aznap evő állatokat.</p>
      ) : (
        <>
          {editable && <p className="hint no-print">Kattints egy sorra, írd be a mennyiségeket, és mentsd a sort. Az összegek egységenként adódnak: a gramm, a ml és a darab sosem adódik össze.</p>}
          <div className="table-scroll">
            <table className="log-table" data-testid="feeding-sheet-table">
              <thead>
                <tr>
                  <th>Állat</th>
                  {feeds.map((f) => (
                    <th key={f.id}>
                      {f.name}
                      {cellUnit(f) ? ` (${cellUnit(f)!.symbol})` : ""}
                    </th>
                  ))}
                  <th>Összesen</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((r) => {
                  const isActive = editable && r.key === active;
                  return (
                    <tr
                      key={r.key}
                      className={editable ? `clickable${isActive ? " active-row" : ""}` : undefined}
                      aria-selected={isActive}
                      onClick={editable ? () => onActive(r.key) : undefined}
                    >
                      <td>{r.label}</td>
                      {feeds.map((f) => (
                        <td key={f.id} className="keep">
                          {fmt(cell(r.key, f.id))}
                          {isActive && cellUnit(f) && (
                            <input
                              className={`input small no-print${bad.includes(f.id) ? " input-invalid" : ""}`}
                              aria-invalid={bad.includes(f.id)}
                              inputMode="decimal"
                              value={values[f.id] ?? ""}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setValues({ ...values, [f.id]: e.target.value })}
                              aria-label={`${r.label}: ${f.name} (${cellUnit(f)!.symbol})`}
                            />
                          )}
                        </td>
                      ))}
                      <td>{fmt(rowTotal(r.key))}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>Összesen</td>
                  {feeds.map((f) => (
                    <td key={f.id} data-testid={`sheet-total-${f.id}`}>
                      {fmt(colTotal(f.id))}
                    </td>
                  ))}
                  <td data-testid="sheet-grand-total">{fmt(grand)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {editable && (
            <div className="toolbar no-print">
              <button className="btn" type="button" disabled={busy || !filled} onClick={() => void saveRow()}>
                Sor mentése
              </button>
              {localMsg ? (
                <span className="err" role="status">
                  {localMsg}
                </span>
              ) : (
                <Msg msg={msg} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
