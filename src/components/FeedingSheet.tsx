"use client";

// THE FEEDING SHEET (6fe63c9b, Lili's request; Balázs 2026-10-21 10:38 UTC "mehet"): the day's two steps as one
// table. Rows: the recipients chosen in step 1 (animals, and groups with a chosen member); columns: the feeds chosen
// in step 2. A click on a row makes it active, as on the measurement page.
//
// Lili's second round (2026-10-21 11:44 UTC): "nem soronként mentjük, hanem állapotként menti a sort ha kikattintok
// belőle, így átírható, és ha minden ki van töltve akkor egy mentés/lezárás gombot teszünk oda"; an empty cell is 0;
// and a feed weighed in grams AND counted in pieces (Litopenaeus vannamei) takes both. So:
//   - every cell has one input per dimension of its feed (g, ml, db), prefilled with what is saved;
//   - what is typed stays as a draft when the row is left, shown on the row, and can be changed again;
//   - ONE "Takarmánylap mentése" saves every changed cell: a new cell is a new item, a changed saved cell updates
//     its item (its version), a saved cell emptied is invalidated; each through the existing endpoints, so the list,
//     the eating log and the exports read the same data;
//   - an empty cell shows 0 and records nothing.
// A cell keeps one request id per change until it is saved (#42): a lost answer is replayed, never a second item.
import { useState } from "react";
import { Msg, parseAmount, useSend, type FeedOpt, type Recipient } from "./FeedingForms";
import { askReason, useReasonsOn } from "./ReasonSwitch";

function newRequestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

type SheetItem = {
  id: string;
  version: number;
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

/** The units a cell is typed in: the base unit of each of the feed's dimensions (g, ml, db). */
function cellUnits(feed: FeedOpt) {
  return feed.dims.flatMap((d) => {
    const u = d.units.find((x) => x.symbol === d.base) ?? d.units.find((x) => x.factor === 1) ?? d.units[0];
    return u ? [{ dimension: d.dimension, id: u.id, symbol: u.symbol }] : [];
  });
}

/** A draft cell: the typed text per dimension. */
type Draft = Record<string, string>;

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
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [requestIds, setRequestIds] = useState<Record<string, string>>({});
  const [bad, setBad] = useState<string[]>([]);
  const [localMsg, setLocalMsg] = useState<string | null>(null);
  const { msg, busy, run } = useSend();
  const reasonsOn = useReasonsOn();
  const keyOf = (i: SheetItem) => i.animalId ?? `g:${i.groupId}`;
  const cellKey = (rec: string, feedId: string) => `${rec}|${feedId}`;
  // one item per recipient and feed a day (the server's rule): the cell's saved item
  const savedItem = (rec: string, feedId: string) => items.find((i) => keyOf(i) === rec && i.feedId === feedId) ?? null;
  const savedText = (rec: string, f: FeedOpt): Draft => {
    const item = savedItem(rec, f.id);
    const out: Draft = {};
    for (const u of cellUnits(f)) {
      const v = item?.baseQuantities.filter((q) => q.unit === u.symbol).reduce((s, q) => s + q.value, 0) ?? 0;
      out[u.dimension] = v ? num(v) : "";
    }
    return out;
  };
  const shown = (rec: string, f: FeedOpt): Draft => drafts[cellKey(rec, f.id)] ?? savedText(rec, f);
  const isDirty = (rec: string, f: FeedOpt) => {
    const d = drafts[cellKey(rec, f.id)];
    if (!d) return false;
    const s = savedText(rec, f);
    return cellUnits(f).some((u) => (d[u.dimension] ?? "").trim() !== (s[u.dimension] ?? "").trim());
  };
  // the totals read what the sheet shows: saved values, or the draft where one was typed
  const cellTotals = (rec: string, f: FeedOpt): Record<string, number> => {
    const t: Record<string, number> = {};
    const d = shown(rec, f);
    for (const u of cellUnits(f)) {
      const v = parseAmount(d[u.dimension] ?? "");
      if (v) add(t, u.symbol, v);
    }
    return t;
  };
  const rowTotal = (rec: string) => {
    const t: Record<string, number> = {};
    for (const f of feeds) for (const [u, v] of Object.entries(cellTotals(rec, f))) add(t, u, v);
    return t;
  };
  const colTotal = (f: FeedOpt) => {
    const t: Record<string, number> = {};
    for (const r of recipients) for (const [u, v] of Object.entries(cellTotals(r.key, f))) add(t, u, v);
    return t;
  };
  const grand: Record<string, number> = {};
  for (const f of feeds) for (const [u, v] of Object.entries(colTotal(f))) add(grand, u, v);
  const changed = recipients.flatMap((r) => feeds.filter((f) => isDirty(r.key, f)).map((f) => ({ r, f })));

  function type(rec: string, f: FeedOpt, dimension: string, value: string) {
    const key = cellKey(rec, f.id);
    setDrafts((cur) => ({ ...cur, [key]: { ...(cur[key] ?? savedText(rec, f)), [dimension]: value } }));
    // a new value is a new request
    setRequestIds((cur) => {
      const next = { ...cur };
      delete next[key];
      return next;
    });
  }

  async function saveAll() {
    // a typed cell that is not an amount is never skipped silently (#42): marked, and nothing is sent
    const invalid = changed.filter(({ r, f }) => cellUnits(f).some((u) => {
      const raw = (shown(r.key, f)[u.dimension] ?? "").trim();
      return raw !== "" && parseAmount(raw) === null;
    }));
    setBad(invalid.map(({ r, f }) => cellKey(r.key, f.id)));
    if (invalid.length) {
      setLocalMsg(`${invalid.length} cella nem menthető: érvénytelen mennyiség (${invalid.map(({ r, f }) => `${r.label}: ${f.name}`).join("; ")}).`);
      return;
    }
    const clearing = changed.filter(({ r, f }) => savedItem(r.key, f.id) && cellUnits(f).every((u) => !parseAmount(shown(r.key, f)[u.dimension] ?? "")));
    let why: { reason?: string } | null = {};
    if (clearing.length) {
      why = askReason(reasonsOn, "A kiürített cellák tételeinek érvénytelenítési oka:", `${clearing.length} kiürített cella tétele érvénytelenítődik. Folytatod?`);
      if (!why) return;
    }
    setLocalMsg(null);
    let saved = 0;
    for (const { r, f } of changed) {
      const key = cellKey(r.key, f.id);
      const d = shown(r.key, f);
      const item = savedItem(r.key, f.id);
      const quantities = cellUnits(f)
        .map((u) => ({ raw: (d[u.dimension] ?? "").trim(), unitId: u.id }))
        .filter((q) => q.raw !== "" && parseAmount(q.raw))
        .map((q) => ({ value: q.raw, unitId: q.unitId }));
      const id = requestIds[key] ?? newRequestId();
      if (!requestIds[key]) setRequestIds((m) => ({ ...m, [key]: id }));
      let ok: boolean;
      if (quantities.length === 0) {
        // an emptied saved cell: its item is invalidated (an empty cell is 0, nothing to keep)
        if (!item) ok = true;
        else ok = await run(`/api/feeding/items/${item.id}/invalidate`, { requestId: id, expectedVersion: item.version, ...why }, "Takarmánylap mentve.");
      } else {
        ok = await run(
          "/api/feeding/items",
          {
            requestId: id,
            day,
            feedId: f.id,
            quantities,
            ...(item ? { itemId: item.id, expectedVersion: item.version } : {}),
            ...(r.animalId ? { animalId: r.animalId } : { groupId: r.groupId }),
          },
          "Takarmánylap mentve.",
        );
      }
      if (!ok) return;
      saved++;
      setDrafts((cur) => {
        const next = { ...cur };
        delete next[key];
        return next;
      });
      setRequestIds((m) => {
        const next = { ...m };
        delete next[key];
        return next;
      });
    }
    if (saved) setLocalMsg(null);
  }
  function printSheet() {
    document.body.classList.add("print-sheet");
    window.print();
    document.body.classList.remove("print-sheet");
  }
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
          {editable && (
            <p className="hint no-print">
              Kattints egy sorra, és írd be a mennyiségeket: amit beírsz, a sor elhagyása után is megmarad és átírható. A végén a „Takarmánylap mentése” ment mindent. Az üres cella 0, nem kerül tételként rögzítésre; egy mentett cella kiürítése a tételét érvényteleníti.
            </p>
          )}
          <div className="table-scroll">
            <table className="log-table" data-testid="feeding-sheet-table">
              <thead>
                <tr>
                  <th>Állat</th>
                  {feeds.map((f) => (
                    <th key={f.id}>
                      {f.name} ({cellUnits(f).map((u) => u.symbol).join(" + ")})
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
                      {feeds.map((f) => {
                        const key = cellKey(r.key, f.id);
                        const d = shown(r.key, f);
                        const dirty = isDirty(r.key, f);
                        return (
                          <td key={f.id} className="keep" data-testid={`sheet-cell-${r.label}-${f.name}`}>
                            {isActive ? (
                              cellUnits(f).map((u) => (
                                <input
                                  key={u.dimension}
                                  className={`input small no-print${bad.includes(key) ? " input-invalid" : ""}`}
                                  aria-invalid={bad.includes(key)}
                                  inputMode="decimal"
                                  value={d[u.dimension] ?? ""}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => type(r.key, f, u.dimension, e.target.value)}
                                  aria-label={`${r.label}: ${f.name} (${u.symbol})`}
                                />
                              ))
                            ) : (
                              <span className={dirty ? "badge badge-pending" : undefined} title={dirty ? "Nincs még mentve" : undefined}>
                                {fmt(cellTotals(r.key, f)) || "0"}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td>{fmt(rowTotal(r.key)) || "0"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>Összesen</td>
                  {feeds.map((f) => (
                    <td key={f.id} data-testid={`sheet-total-${f.id}`}>
                      {fmt(colTotal(f)) || "0"}
                    </td>
                  ))}
                  <td data-testid="sheet-grand-total">{fmt(grand) || "0"}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {editable && (
            <div className="toolbar no-print">
              <button className="btn" type="button" disabled={busy || changed.length === 0} onClick={() => void saveAll()}>
                Takarmánylap mentése{changed.length ? ` (${changed.length} cella)` : ""}
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
