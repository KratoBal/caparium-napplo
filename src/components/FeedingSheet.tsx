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
//     its item, a saved cell emptied is invalidated; each through the existing endpoints, so the list, the eating
//     log and the exports read the same data;
//   - an empty cell shows 0 and records nothing.
// The list is common (any aquarist may change it), so a draft remembers WHAT IT WAS TYPED ON (the item and its
// version, or "no item") and the save sends that, never the version read at the save: a change made meanwhile by
// someone else is a conflict on that cell, never silently overwritten (barracuda #45). Unsaved drafts ask before the
// page is left, as the measurement page does (#38). A cell keeps one request id per change until it is saved (#42).
import { useRouter } from "next/navigation";
import { useState, type CSSProperties } from "react";
import { sheetColorBg } from "@/lib/sheet-color-palette";
import { ClearX } from "./ClearX";
import { DayControls, type DayLock } from "./DayControls";
import { Msg, parseAmount, useSend, type FeedOpt, type Recipient } from "./FeedingForms";
import { askReason, useReasonsOn } from "./ReasonSwitch";
import { useLeaveWarning } from "./useLeaveWarning";

const LEAVE_WARNING = "Van még nem mentett érték a takarmánylapon. Ha most továbblépsz, elveszik. Továbblépsz mentés nélkül?";

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

/**
 * A coral feed (feed.tick, 6fe63c9b item 7) is a tick, not an amount: its draft holds TICK "1" (given) or "" (not),
 * a tick is saved as an item without a quantity, and an untick invalidates the cell's item. The item form still
 * takes a quantity; a cell whose item has one shows it.
 */
const TICK = "TICK";
const fieldsOf = (feed: FeedOpt) => (feed.tick ? [TICK] : cellUnits(feed).map((u) => u.dimension));

/** A draft cell: the typed text per dimension, and what it was typed on (the item and version, or none). */
type Draft = { values: Record<string, string>; baseId: string | null; baseVersion: number | null };

export function FeedingSheet({
  day,
  editable,
  recipients,
  lock,
  feeds,
  items,
  active,
  onActive,
}: {
  day: string;
  editable: boolean;
  recipients: Recipient[];
  /** the day's lock: the close action under the save button too (Lili 2026-10-29) */
  lock?: DayLock;
  /** the columns: the day's feeds (step 2), or the feeds already given that day if none were chosen */
  feeds: FeedOpt[];
  items: SheetItem[];
  active: string;
  onActive: (key: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [requestIds, setRequestIds] = useState<Record<string, string>>({});
  const [bad, setBad] = useState<string[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const [localMsg, setLocalMsg] = useState<string | null>(null);
  const { msg, busy, run } = useSend();
  const router = useRouter();
  const reasonsOn = useReasonsOn();
  const keyOf = (i: SheetItem) => i.animalId ?? `g:${i.groupId}`;
  const cellKey = (rec: string, feedId: string) => `${rec}|${feedId}`;
  const cellItems = (rec: string, feedId: string) => items.filter((i) => keyOf(i) === rec && i.feedId === feedId);
  // one item per recipient and feed a day is the server's rule; two would make the cell read-only (barracuda #45)
  const savedItem = (rec: string, feedId: string) => {
    const list = cellItems(rec, feedId);
    return list.length === 1 ? list[0]! : null;
  };
  const multi = (rec: string, feedId: string) => cellItems(rec, feedId).length > 1;
  const savedText = (rec: string, f: FeedOpt): Record<string, string> => {
    const item = savedItem(rec, f.id);
    if (f.tick) return { [TICK]: item ? "1" : "" };
    const out: Record<string, string> = {};
    for (const u of cellUnits(f)) {
      const v = item?.baseQuantities.filter((q) => q.unit === u.symbol).reduce((s, q) => s + q.value, 0) ?? 0;
      out[u.dimension] = v ? num(v) : "";
    }
    return out;
  };
  const shown = (rec: string, f: FeedOpt): Record<string, string> => drafts[cellKey(rec, f.id)]?.values ?? savedText(rec, f);
  const isDirty = (rec: string, f: FeedOpt) => {
    const d = drafts[cellKey(rec, f.id)];
    if (!d) return false;
    const s = savedText(rec, f);
    return fieldsOf(f).some((k) => (d.values[k] ?? "").trim() !== (s[k] ?? "").trim());
  };
  // the totals read what the sheet shows: saved values (every item of the cell), or the draft where one was typed
  const cellTotals = (rec: string, f: FeedOpt): Record<string, number> => {
    const t: Record<string, number> = {};
    // a tick adds no amount; a ticked cell shows what its saved item(s) carry, an unticked draft nothing
    if (f.tick && drafts[cellKey(rec, f.id)]?.values[TICK] === "") return t;
    if (!drafts[cellKey(rec, f.id)] || f.tick) {
      for (const i of cellItems(rec, f.id)) for (const q of i.baseQuantities) add(t, q.unit, q.value);
      return t;
    }
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
  const rowDirty = (rec: string) => feeds.some((f) => isDirty(rec, f));
  const colDirty = (f: FeedOpt) => recipients.some((r) => isDirty(r.key, f));
  // a total that counts a value not saved yet is marked like the draft cell itself (barracuda #45)
  const totalMark = (dirty: boolean, text: string) => (dirty ? <span className="badge badge-pending" title="Nem mentett értéket is tartalmaz">{text}*</span> : text);

  // leaving with drafts asks first: the page itself, and every in-app link (#38's rule). The browser's back button
  // is neither a click nor an unload in the App Router, so it is not asked, as on the measurement page
  useLeaveWarning(changed.length, LEAVE_WARNING);

  const drop = <T,>(list: T[], key: T) => list.filter((x) => x !== key);
  function type(rec: string, f: FeedOpt, dimension: string, value: string) {
    const key = cellKey(rec, f.id);
    setDrafts((cur) => {
      // the first keystroke fixes what the draft is typed on
      const base = cur[key] ?? { values: savedText(rec, f), baseId: savedItem(rec, f.id)?.id ?? null, baseVersion: savedItem(rec, f.id)?.version ?? null };
      return { ...cur, [key]: { ...base, values: { ...base.values, [dimension]: value } } };
    });
    setBad((cur) => drop(cur, key));
    setFailed((cur) => drop(cur, key));
    // a new value is a new request
    setRequestIds((cur) => {
      const next = { ...cur };
      delete next[key];
      return next;
    });
  }
  function discard() {
    if (!window.confirm("A takarmánylap nem mentett értékei elvesznek. Elveted őket?")) return;
    setDrafts({});
    setBad([]);
    setFailed([]);
    setLocalMsg(null);
  }

  async function saveAll() {
    // a typed cell that is not an amount is never skipped silently (#42): marked, and nothing is sent
    const invalid = changed.filter(({ r, f }) =>
      cellUnits(f).some((u) => {
        const raw = (shown(r.key, f)[u.dimension] ?? "").trim();
        return raw !== "" && parseAmount(raw) === null;
      }),
    );
    setBad(invalid.map(({ r, f }) => cellKey(r.key, f.id)));
    if (invalid.length) {
      setLocalMsg(`${invalid.length} cella nem menthető: érvénytelen mennyiség (${invalid.map(({ r, f }) => `${r.label}: ${f.name}`).join("; ")}).`);
      return;
    }
    // a cell that got a second item since its draft began is read-only: the item form corrects it. A change made
    // meanwhile to the draft's own item is the SERVER's to judge (VERSION_CONFLICT, CELL_TAKEN): this sheet's own
    // request whose answer was lost looks the same from here, and only the server knows it is a replay (#42)
    const stale = changed.filter(({ r, f }) => multi(r.key, f.id));
    setFailed(stale.map(({ r, f }) => cellKey(r.key, f.id)));
    if (stale.length) {
      setLocalMsg(`${stale.length} cellában közben több tétel lett: ${stale.map(({ r, f }) => `${r.label}: ${f.name}`).join("; ")}. A tétel-űrlapon javítsd, a piszkozatát vesd el.`);
      return;
    }
    const emptied = (f: FeedOpt, v: Record<string, string>) => (f.tick ? v[TICK] !== "1" : cellUnits(f).every((u) => !parseAmount(v[u.dimension] ?? "")));
    const clearing = changed.filter(({ r, f }) => drafts[cellKey(r.key, f.id)]!.baseId && emptied(f, shown(r.key, f)));
    let why: { reason?: string } | null = {};
    if (clearing.length) {
      why = askReason(reasonsOn, "A kiürített cellák tételeinek érvénytelenítési oka:", `${clearing.length} kiürített cella tétele érvénytelenítődik. Folytatod?`);
      if (!why) return;
    }
    setLocalMsg(null);
    for (const { r, f } of changed) {
      const key = cellKey(r.key, f.id);
      const d = drafts[key]!;
      const quantities = (f.tick ? [] : cellUnits(f))
        .map((u) => ({ raw: (d.values[u.dimension] ?? "").trim(), unitId: u.id }))
        .filter((q) => q.raw !== "" && parseAmount(q.raw))
        .map((q) => ({ value: q.raw, unitId: q.unitId }));
      const id = requestIds[key] ?? newRequestId();
      if (!requestIds[key]) setRequestIds((m) => ({ ...m, [key]: id }));
      let ok: boolean;
      if (emptied(f, d.values)) {
        // an emptied (or unticked) saved cell: its item is invalidated, on the version the draft was typed on
        if (!d.baseId) ok = true;
        else ok = await run(`/api/feeding/items/${d.baseId}/invalidate`, { requestId: id, expectedVersion: d.baseVersion, ...why }, "Takarmánylap mentve.");
      } else {
        ok = await run(
          "/api/feeding/items",
          {
            requestId: id,
            day,
            feedId: f.id,
            quantities,
            // the version the draft began on: a change made since is the server's VERSION_CONFLICT, not an overwrite
            ...(d.baseId ? { itemId: d.baseId, expectedVersion: d.baseVersion } : {}),
            ...(r.animalId ? { animalId: r.animalId } : { groupId: r.groupId }),
          },
          "Takarmánylap mentve.",
        );
      }
      if (!ok) {
        // the cell stays a draft, marked; the sheet reloads, so after discarding the draft the current value shows
        setFailed([key]);
        router.refresh();
        return;
      }
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
    setFailed([]);
  }
  function printSheet() {
    // the paper should not carry a value that is not saved, unasked (barracuda #45)
    if (changed.length && !window.confirm("A takarmánylapon nem mentett érték is van, a nyomtatás azt is mutatja. Nyomtatod így?")) return;
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
              Kattints egy sorra, és írd be a mennyiségeket: amit beírsz, a sor elhagyása után is megmarad és átírható. A végén a „Takarmánylap mentése” ment mindent. Az üres cella 0, nem kerül tételként rögzítésre; egy mentett cella kiürítése a tételét érvényteleníti.{feeds.some((f) => f.tick) ? " A koralltáp oszlopában pipa: adva vagy nem, mennyiség nélkül (a mennyiség a tétel-űrlapon írható be)." : ""}
            </p>
          )}
          <div className="table-scroll sheet-scroll">
            <table className="log-table" data-testid="feeding-sheet-table">
              <thead>
                <tr>
                  <th>Állat</th>
                  {feeds.map((f) => (
                    <th key={f.id}>
                      {f.name} ({f.tick ? "adva" : cellUnits(f).map((u) => u.symbol).join(" + ")})
                    </th>
                  ))}
                  <th>Összesen</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((r) => {
                  const isActive = editable && r.key === active;
                  const bg = sheetColorBg(r.color);
                  return (
                    <tr
                      key={r.key}
                      className={editable ? `clickable${isActive ? " active-row" : ""}` : undefined}
                      style={bg ? ({ "--row-bg": bg } as CSSProperties) : undefined}
                      data-color={bg ? r.color ?? undefined : undefined}
                      aria-selected={isActive}
                      onClick={editable ? () => onActive(r.key) : undefined}
                    >
                      <td>{r.label}</td>
                      {feeds.map((f) => {
                        const key = cellKey(r.key, f.id);
                        const d = shown(r.key, f);
                        const dirty = isDirty(r.key, f);
                        const conflict = failed.includes(key);
                        return (
                          <td key={f.id} className="keep" data-testid={`sheet-cell-${r.label}-${f.name}`} data-failed={conflict || undefined}>
                            {multi(r.key, f.id) ? (
                              <span className="hint" title="Egy cellában több tétel: a tétel-űrlapon javítsd">
                                {fmt(cellTotals(r.key, f))} (több tétel)
                              </span>
                            ) : isActive && f.tick ? (
                              <input
                                type="checkbox"
                                className="no-print"
                                checked={d[TICK] === "1"}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => type(r.key, f, TICK, e.target.checked ? "1" : "")}
                                aria-label={`${r.label}: ${f.name} (adva)`}
                              />
                            ) : isActive ? (
                              cellUnits(f).map((u) => (
                                // Lili 2026-10-29: a small X in the corner empties the field in one click, the same as
                                // deleting it by hand; shown only while the field holds something, on each of g and db
                                <span key={u.dimension} className="clearable no-print">
                                  <input
                                    className={`input small${bad.includes(key) || conflict ? " input-invalid" : ""}`}
                                    aria-invalid={bad.includes(key) || conflict}
                                    inputMode="decimal"
                                    value={d[u.dimension] ?? ""}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => type(r.key, f, u.dimension, e.target.value)}
                                    aria-label={`${r.label}: ${f.name} (${u.symbol})`}
                                  />
                                  <ClearX
                                    shown={(d[u.dimension] ?? "") !== ""}
                                    label={`${u.symbol} kiürítése, ${r.label}, ${f.name}`}
                                    onClear={() => type(r.key, f, u.dimension, "")}
                                  />
                                </span>
                              ))
                            ) : (
                              <span className={dirty || conflict ? "badge badge-pending" : undefined} title={conflict ? "Nem mentődött: lásd az üzenetet" : dirty ? "Nincs még mentve" : undefined}>
                                {f.tick ? (d[TICK] === "1" ? fmt(cellTotals(r.key, f)) || "adva" : "nem") : fmt(cellTotals(r.key, f)) || "0"}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td>{totalMark(rowDirty(r.key), fmt(rowTotal(r.key)) || "0")}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>Összesen</td>
                  {feeds.map((f) => (
                    <td key={f.id} data-testid={`sheet-total-${f.id}`}>
                      {totalMark(colDirty(f), fmt(colTotal(f)) || "0")}
                    </td>
                  ))}
                  <td data-testid="sheet-grand-total">{totalMark(changed.length > 0, fmt(grand) || "0")}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {editable && (
            <div className="toolbar no-print">
              <button className="btn" type="button" disabled={busy || changed.length === 0} onClick={() => void saveAll()}>
                Takarmánylap mentése{changed.length ? ` (${changed.length} cella)` : ""}
              </button>
              {Object.keys(drafts).length > 0 && (
                <button className="btn btn-soft" type="button" disabled={busy} onClick={discard}>
                  Piszkozat elvetése
                </button>
              )}
              {localMsg ? (
                <span className="err" role="status">
                  {localMsg}
                </span>
              ) : (
                <Msg msg={msg} />
              )}
            </div>
          )}
          {lock && <DayControls {...lock} bottom unsaved={editable ? changed.length : 0} />}
        </>
      )}
    </div>
  );
}
