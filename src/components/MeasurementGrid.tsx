"use client";

// The measurement grid, daily and weekly (VIZ-03..VIZ-09, ÁLT-03, ÁLT-07, ÁLT-12, ÁLT-15, VIZ-02).
// Weekly mode adds the dilution (1–100) and the diluent water (RO/SW) to the nitrate and phosphate cells of
// every pool (src/lib/dilution.ts, caparium-hibak-1), editable in every pool's row, not only the active one
// (caparium-hibak-2): supplementary data, nothing is recalculated from them (VIZ-06, DN-07).
// The values are saved by the "Mentés" button only, not on leaving a cell (Balázs 2026-10-21 09:13 UTC, Caparium
// thread: an autosave on leaving a field mixed things up when a wrong value was corrected). Until then the typed
// values are drafts, freely corrected; leaving the page with drafts asks first. The measurement time is a time of
// day only: its date is the day chosen above (one date on the page, Balázs 2026-10-21). A failed network request
// goes to a local queue with the same request id, so a retry never saves twice.

import { ClearX } from "./ClearX";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CellView, RangeView } from "@/lib/queries";
import { useReasonsOn } from "./ReasonSwitch";
import { useLeaveWarning } from "./useLeaveWarning";

type Grid = {
  group: { id: string; name: string };
  day: string;
  layout: {
    pools: { id: string; name: string; active: boolean }[];
    parameters: { id: string; name: string; decimals: number; unit: { symbol: string }; dilution: boolean }[];
  };
  rounds: { id: string; seq: number }[];
  selectedRound: { id: string; seq: number } | null;
  cells: Record<string, CellView>;
  /** "poolId:parameterId" -> the range valid now in that pool (its own, else the common one) */
  currentRanges: Record<string, RangeView | null>;
};

type CellState = { state: "saving" | "queued" | "error" | "saved"; message?: string };

type QueueItem = {
  key: string;
  url: string;
  method: "POST" | "PATCH";
  body: Record<string, unknown>;
};

type Conflict = { key: string; draft: string; server: { value: string; by?: string; time?: string } };

type Meta = { dilution: number | null; diluentWater: "RO" | "SW" | null };

const DILUTIONS = Array.from({ length: 100 }, (_, i) => i + 1);

function requestId(): string {
  // crypto.randomUUID needs a secure context; getRandomValues does not (plain http on the tailnet)
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** the current time of day, HH:MM, for the measurement time field */
function nowTime(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

const LEAVE_WARNING = "Van még nem mentett mérési érték. Ha most továbblépsz, elveszik. Továbblépsz mentés nélkül?";

function huNumber(v: string): string {
  return v.replace(".", ",");
}

function draftOutOfRange(text: string, range: RangeView | null | undefined): boolean {
  if (!range) return false;
  const n = Number(text.trim().replace(",", "."));
  if (!Number.isFinite(n) || text.trim() === "") return false;
  return (range.min !== null && n < Number(range.min)) || (range.max !== null && n > Number(range.max));
}

function rangeText(r: RangeView | null | undefined): string {
  if (!r) return "";
  const min = r.min === null ? null : huNumber(r.min);
  const max = r.max === null ? null : huNumber(r.max);
  if (min !== null && max !== null) return `ref: ${min}–${max}`;
  if (max !== null) return `ref: ≤ ${max}`;
  return `ref: ≥ ${min}`;
}

export function MeasurementGrid({
  initial,
  groupCode,
  today,
  user,
  canWrite,
  isAdmin,
  people,
  weekly = false,
  basePath = "/vizmeres",
}: {
  initial: Grid;
  groupCode: string;
  /** weekly measurement: dilution and RO/SW on the nitrate and phosphate cells */
  weekly?: boolean;
  /** the page of this grid, for the round and day links */
  basePath?: string;
  today: string;
  user: { id: string; role: string };
  /** the effective module level (R-17) allows recording */
  canWrite: boolean;
  /** the effective module level is ADMIN */
  isAdmin: boolean;
  people: { id: string; fullName: string }[];
}) {
  const router = useRouter();
  const [grid, setGrid] = useState<Grid>(initial);
  // Lili 2026-10-29 (caparium-finomitas-1, item 4): the header row and the pool column stay put, like the feeding
  // sheet's, but ONLY when the table is wider than its place (a phone); where it fits (tablet, desktop) it looks as
  // before. The box is marked while it overflows, and the stickiness lives under that mark (globals.css).
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const box = scrollRef.current;
    const table = tableRef.current;
    if (!box || !table || typeof ResizeObserver === "undefined") return;
    const measure = () => setOverflow(table.offsetWidth > box.clientWidth + 1);
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    ro.observe(table);
    measure();
    return () => ro.disconnect();
  }, []);
  const [activePool, setActivePool] = useState<string>(initial.layout.pools.find((p) => p.active)?.id ?? "");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [metaDrafts, setMetaDrafts] = useState<Record<string, Meta>>({});
  const [cellState, setCellState] = useState<Record<string, CellState>>({});
  const [responsibleId, setResponsibleId] = useState(user.id);
  const [trainee, setTrainee] = useState(false);
  // the time of day only; the date is the chosen day (`grid.day`)
  const [time, setTime] = useState(initial.day === today ? nowTime() : "12:00");
  const [timeTouched, setTimeTouched] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const [queueSize, setQueueSize] = useState(0);
  const flushing = useRef(false);
  // The saves of one cell run one after another, each built from the latest state: a dilution
  // and an RO/SW picked in quick succession must not race into two creations of the same cell.
  const gridRef = useRef(grid);
  gridRef.current = grid;
  // the weekly dilution and RO/SW fields belong to the nitrate and the phosphate only
  const dilutable = useCallback(
    (parameterId: string) => weekly && gridRef.current.layout.parameters.some((p) => p.id === parameterId && p.dilution),
    [weekly],
  );
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const metaRef = useRef(metaDrafts);
  metaRef.current = metaDrafts;
  // the drafts not yet saved: leaving the page with them asks first (the reverse of the old autosave mix-up
  // would be a silently lost measurement)
  const unsavedRef = useLeaveWarning(new Set([...Object.keys(drafts), ...Object.keys(metaDrafts)]).size, LEAVE_WARNING);
  const chains = useRef(new Map<string, Promise<void>>());

  const queueKey = `napplo-queue-v1-${user.id}`;
  const isPastDay = grid.day !== today;
  const readOnly = !canWrite || (isPastDay && !isAdmin);
  const reasonsOn = useReasonsOn();

  const readQueue = useCallback((): QueueItem[] => {
    try {
      return JSON.parse(localStorage.getItem(queueKey) ?? "[]") as QueueItem[];
    } catch {
      return [];
    }
  }, [queueKey]);
  const writeQueue = useCallback(
    (items: QueueItem[]) => {
      try {
        localStorage.setItem(queueKey, JSON.stringify(items));
      } catch {
        /* storage full or blocked: the in-memory state still shows the cell as unsaved */
      }
      setQueueSize(items.length);
    },
    [queueKey],
  );

  // keep the offered time current until the user changes it (ÁLT-07)
  useEffect(() => {
    if (timeTouched || isPastDay) return;
    const t = setInterval(() => setTime(nowTime()), 30_000);
    return () => clearInterval(t);
  }, [timeTouched, isPastDay]);
  const timeLocal = `${grid.day}T${time}`;

  const refresh = useCallback(async () => {
    const seq = grid.selectedRound?.seq;
    const res = await fetch(`/api/grid?groupId=${grid.group.id}&day=${grid.day}${seq ? `&round=${seq}` : ""}`, {
      cache: "no-store",
    });
    if (res.ok) {
      const g = (await res.json()) as Grid;
      gridRef.current = g;
      setGrid(g);
    }
  }, [grid.group.id, grid.day, grid.selectedRound?.seq]);

  type SendOutcome = "ok" | "queued" | "failed";

  const send = useCallback(
    async (item: QueueItem, fromQueue: boolean): Promise<SendOutcome> => {
      setCellState((s) => ({ ...s, [item.key]: { state: "saving" } }));
      let res: Response;
      try {
        res = await fetch(item.url, {
          method: item.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item.body),
        });
      } catch {
        if (!fromQueue) writeQueue([...readQueue(), item]);
        setCellState((s) => ({ ...s, [item.key]: { state: "queued", message: "Nincs kapcsolat, a mentés várakozik" } }));
        return "queued";
      }
      if (res.ok) {
        setCellState((s) => ({ ...s, [item.key]: { state: "saved" } }));
        setDrafts((d) => {
          const next = { ...d };
          delete next[item.key];
          return next;
        });
        return "ok";
      }
      const payload = (await res.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string; existing?: { value: string }; current?: { value: string } };
      };
      const err = payload.error ?? {};
      if (res.status === 401) {
        if (!fromQueue) writeQueue([...readQueue(), item]);
        setBanner({ kind: "error", text: "A munkamenet lejárt. Jelentkezz be újra: a be nem küldött értékek megmaradnak ezen az eszközön." });
        setCellState((s) => ({ ...s, [item.key]: { state: "queued", message: "Belépésre vár" } }));
        return "queued";
      }
      if (res.status >= 500) {
        if (!fromQueue) writeQueue([...readQueue(), item]);
        setCellState((s) => ({ ...s, [item.key]: { state: "queued", message: "Szerverhiba, újrapróbáljuk" } }));
        return "queued";
      }
      if (err.code === "IMPLAUSIBLE_VALUE" && !item.body.confirmPlausibility) {
        if (window.confirm(`${err.message}\n\nBeírt érték: ${String(item.body.value)}`)) {
          return send({ ...item, body: { ...item.body, confirmPlausibility: true } }, fromQueue);
        }
      }
      if (err.code === "REASON_REQUIRED" && !item.body.reason) {
        const reason = window.prompt("Korábbi vagy lezárt nap módosítása. Indoklás:");
        if (reason && reason.trim().length >= 3) return send({ ...item, body: { ...item.body, reason } }, fromQueue);
      }
      if (err.code === "CELL_TAKEN" || err.code === "VERSION_CONFLICT") {
        const server = err.existing ?? err.current;
        setConflict({ key: item.key, draft: String(item.body.value ?? ""), server: { value: server?.value ?? "?" } });
        await refresh();
      }
      setCellState((s) => ({ ...s, [item.key]: { state: "error", message: err.message ?? "A mentés nem sikerült." } }));
      return "failed";
    },
    [readQueue, writeQueue, refresh],
  );

  const flushQueue = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      let items = readQueue();
      for (const item of [...items]) {
        const outcome = await send(item, true);
        if (outcome === "queued") break; // still offline: keep the order
        items = items.filter((i) => i !== item && JSON.stringify(i) !== JSON.stringify(item));
        writeQueue(items);
      }
      if (items.length === 0) await refresh();
    } finally {
      flushing.current = false;
    }
  }, [readQueue, writeQueue, send, refresh]);

  useEffect(() => {
    setQueueSize(readQueue().length);
    void flushQueue();
    const t = setInterval(() => void flushQueue(), 15_000);
    const online = () => void flushQueue();
    window.addEventListener("online", online);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", online);
    };
  }, [flushQueue, readQueue]);

  const buildItem = useCallback(
    (poolId: string, parameterId: string, value: string, overwrite?: { version: number }, meta?: Meta): QueueItem => {
      const key = `${poolId}:${parameterId}`;
      const existing = gridRef.current.cells[key];
      const common = {
        requestId: requestId(),
        clientTimestamp: new Date().toISOString(),
        value,
        responsibleUserId: responsibleId,
        traineePerformed: trainee,
        ...(dilutable(parameterId) && meta ? { dilution: meta.dilution, diluentWater: meta.diluentWater } : {}),
      };
      if (existing) {
        // an edit keeps the original measurement time unless the user changed the time field
        return {
          key,
          url: `/api/measurements/${existing.id}`,
          method: "PATCH",
          body: { ...common, expectedVersion: overwrite?.version ?? existing.version, ...(timeTouched ? { measuredAtLocal: timeLocal } : {}) },
        };
      }
      return {
        key,
        url: "/api/measurements",
        method: "POST",
        body: {
          ...common,
          groupId: grid.group.id,
          roundId: grid.selectedRound?.id ?? null,
          poolId,
          parameterId,
          measuredAtLocal: timeLocal,
        },
      };
    },
    [grid, responsibleId, trainee, timeLocal, timeTouched, dilutable],
  );

  const metaOf = useCallback(
    (key: string): Meta => {
      const c = grid.cells[key];
      return metaDrafts[key] ?? { dilution: c?.dilution ?? null, diluentWater: c?.diluentWater ?? null };
    },
    [grid.cells, metaDrafts],
  );

  const doSave = useCallback(
    async (poolId: string, parameterId: string, metaOverride?: Meta) => {
      const key = `${poolId}:${parameterId}`;
      const existing = gridRef.current.cells[key];
      const draftText = draftsRef.current[key];
      const text = draftText ?? (existing ? existing.value : undefined);
      const meta = metaOverride ??
        metaRef.current[key] ?? { dilution: existing?.dilution ?? null, diluentWater: existing?.diluentWater ?? null };
      // only what was sent is cleared: a newer edit made while saving stays a draft
      const clear = () => {
        setDrafts((d) => {
          if (d[key] !== draftText) return d;
          const next = { ...d };
          delete next[key];
          return next;
        });
        setMetaDrafts((d) => {
          const m = d[key];
          if (!m || m.dilution !== meta.dilution || m.diluentWater !== meta.diluentWater) return d;
          const next = { ...d };
          delete next[key];
          return next;
        });
      };
      if (text === undefined || text.trim() === "") {
        if (draftText !== undefined) clear();
        return; // a dilution without a value waits for the value
      }
      const valueChanged = !existing || text.trim().replace(",", ".") !== existing.value;
      const metaChanged =
        dilutable(parameterId) && (!existing || meta.dilution !== existing.dilution || meta.diluentWater !== existing.diluentWater);
      if (!valueChanged && !metaChanged) {
        clear();
        return;
      }
      const outcome = await send(buildItem(poolId, parameterId, text.trim(), undefined, meta), false);
      if (outcome === "ok") {
        await refresh();
        clear();
      }
    },
    [send, buildItem, refresh, dilutable],
  );

  const saveCell = useCallback(
    (poolId: string, parameterId: string, metaOverride?: Meta): Promise<void> => {
      const key = `${poolId}:${parameterId}`;
      const next = (chains.current.get(key) ?? Promise.resolve())
        .then(() => doSave(poolId, parameterId, metaOverride))
        .catch(() => undefined);
      chains.current.set(key, next);
      return next;
    },
    [doSave],
  );

  const saveAll = useCallback(async () => {
    setBanner(null);
    for (const key of new Set([...Object.keys(drafts), ...Object.keys(metaDrafts)])) {
      const [poolId, parameterId] = key.split(":");
      await saveCell(poolId, parameterId);
    }
    await flushQueue();
    const left = readQueue().length;
    setBanner(left ? { kind: "warn", text: `${left} mentés várakozik a kapcsolatra.` } : { kind: "ok", text: "Minden érték mentve." });
  }, [drafts, metaDrafts, saveCell, flushQueue, readQueue]);

  const openNewRound = useCallback(async () => {
    if (unsavedRef.current > 0 && !window.confirm(LEAVE_WARNING)) return;
    const res = await fetch("/api/rounds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: requestId(), clientTimestamp: new Date().toISOString(), groupId: grid.group.id, day: grid.day }),
    });
    const body = (await res.json().catch(() => ({}))) as { round?: { seq: number }; error?: { message?: string } };
    if (!res.ok || !body.round) {
      setBanner({ kind: "error", text: body.error?.message ?? "Új mérési kör nem nyitható." });
      return;
    }
    router.push(`${basePath}?csoport=${groupCode}&nap=${grid.day}&kor=${body.round.seq}`);
    router.refresh();
  }, [grid.group.id, grid.day, groupCode, router, basePath]);

  const keepDraft = useCallback(async () => {
    if (!conflict) return;
    const [poolId, parameterId] = conflict.key.split(":");
    const fresh = grid.cells[conflict.key];
    if (!fresh) return;
    setConflict(null);
    const outcome = await send(buildItem(poolId, parameterId, conflict.draft, { version: fresh.version }, metaOf(conflict.key)), false);
    if (outcome === "ok") await refresh();
  }, [conflict, grid.cells, send, buildItem, refresh, metaOf]);

  const loadFresh = useCallback(async () => {
    if (!conflict) return;
    setDrafts((d) => {
      const next = { ...d };
      delete next[conflict.key];
      return next;
    });
    setCellState((s) => ({ ...s, [conflict.key]: { state: "saved" } }));
    setConflict(null);
    await refresh();
  }, [conflict, refresh]);

  // the warning follows what the cells show: a typed, not yet saved value too (it is useful at the moment of typing)
  const anyOut = useMemo(
    () =>
      Object.entries(grid.cells).some(
        ([key, c]) => drafts[key] === undefined && (c.reference === "LOW" || c.reference === "HIGH"),
      ) || Object.entries(drafts).some(([key, draft]) => draftOutOfRange(draft, grid.currentRanges[key])),
    [grid.cells, grid.currentRanges, drafts],
  );
  const unsaved = new Set([...Object.keys(drafts), ...Object.keys(metaDrafts)]).size;

  return (
    <>
      <div className="toolbar">
        <div className="tabs" aria-label="Mérési körök">
          {grid.rounds.map((r) => (
            <a
              key={r.id}
              className={`tab${grid.selectedRound?.id === r.id ? " active" : ""}`}
              href={`${basePath}?csoport=${groupCode}&nap=${grid.day}&kor=${r.seq}`}
            >
              {r.seq}. mérés
            </a>
          ))}
          {!readOnly && grid.rounds.length > 0 && (
            <button className="btn btn-soft" type="button" onClick={openNewRound} data-testid="new-round">
              Új mérés ma
            </button>
          )}
        </div>
        <span className="spacer" />
        {!readOnly && (
          <button className="btn" type="button" onClick={saveAll} data-testid="save-all">
            Mentés
          </button>
        )}
      </div>

      {!canWrite && (
        <div className="banner banner-warn" style={{ marginBottom: 16 }}>
          Ebben a modulban csak olvasási jogod van.
        </div>
      )}
      {canWrite && isPastDay && (
        <div className="banner banner-warn" style={{ marginBottom: 16 }}>
          {isAdmin
            ? reasonsOn
              ? "Korábbi nap: minden módosításhoz indoklás kell, és bekerül a módosítási naplóba."
              : "Korábbi nap: minden módosítás bekerül a módosítási naplóba."
            : "Korábbi nap: csak megtekintés. Módosítani adminisztrátor tud."}
        </div>
      )}

      <div className="card">
        <h2>Napi paraméterek{grid.selectedRound ? ` · ${grid.selectedRound.seq}. mérés` : ""}</h2>
        <p className="hint">
          A beírt értékek a Mentés gombbal rögzülnek, addig szabadon javíthatók. Egy új mérés nem írja felül a korábbit.
        </p>
        {!readOnly && (
          <div className="toolbar">
            <label className="field">
              Mérés időpontja
              <input
                className="input"
                type="time"
                value={time}
                onChange={(e) => {
                  setTime(e.target.value);
                  setTimeTouched(true);
                }}
                data-testid="measured-at"
              />
            </label>
            <label className="field">
              Mérést végezte
              <select className="input" value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)}>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={trainee} onChange={(e) => setTrainee(e.target.checked)} />
              Gyakornok végezte
            </label>
          </div>
        )}
        <div ref={scrollRef} className={`table-scroll${overflow ? " grid-overflow" : ""}`} data-testid="grid-scroll">
          <table ref={tableRef} className="grid-table">
            <thead>
              <tr>
                <th>Medence</th>
                {grid.layout.parameters.map((p) => (
                  <th key={p.id}>
                    {p.name}
                    {p.unit.symbol !== p.name ? ` · ${p.unit.symbol}` : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.layout.pools.map((pool) => {
                // an inactive pool (a renovation) is here only on a day it was measured: shown, not written
                const active = pool.id === activePool && !readOnly && pool.active;
                return (
                  <tr key={pool.id} className={active ? "active-row" : pool.active ? undefined : "pool-off"} data-testid={`row-${pool.name}`}>
                    <td className="pool-cell">
                      <button type="button" onClick={() => pool.active && setActivePool(pool.id)} aria-pressed={active} disabled={!pool.active}>
                        {pool.name}
                        {!pool.active && <span className="hint"> (inaktív)</span>}
                      </button>
                    </td>
                    {grid.layout.parameters.map((param) => {
                      const key = `${pool.id}:${param.id}`;
                      const cell = grid.cells[key];
                      const draft = drafts[key];
                      const st = cellState[key];
                      const shown = draft ?? (cell ? huNumber(cell.value) : "");
                      const out =
                        draft !== undefined
                          ? draftOutOfRange(draft, grid.currentRanges[key])
                          : cell?.reference === "LOW" || cell?.reference === "HIGH";
                      const range = cell?.range ?? grid.currentRanges[key];
                      return (
                        <td key={param.id}>
                          {active ? (
                            // Lili 2026-10-29: the same corner X as on the feeding sheet (ClearX)
                            <span className="clearable clearable-block">
                              <input
                                className={`cell-input${out ? " out" : ""}`}
                                inputMode="decimal"
                                autoComplete="off"
                                aria-label={`${pool.name} ${param.name}`}
                                data-testid={`cell-${pool.name}-${param.name}`}
                                value={shown}
                                onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                }}
                              />
                              <ClearX shown={shown !== ""} label={`Kiürítés, ${pool.name}, ${param.name}`} onClear={() => setDrafts((d) => ({ ...d, [key]: "" }))} />
                            </span>
                          ) : (
                            <div
                              className={`cell-value${shown ? "" : " empty"}${out ? " out" : ""}`}
                              data-testid={`value-${pool.name}-${param.name}`}
                              onClick={() => !readOnly && setActivePool(pool.id)}
                            >
                              {shown || "–"}
                            </div>
                          )}
                          {weekly && param.dilution && (
                            <WeeklyMeta
                              label={`${pool.name} ${param.name}`}
                              testId={`${pool.name}-${param.name}`}
                              meta={metaOf(key)}
                              // in every pool's row, not only the active one (Balázs 2026-10-20 08:32 UTC, msg
                              // 1562020634588876821): a pick there makes its row the active one for the value
                              editable={!readOnly}
                              onChange={(m) => {
                                if (pool.id !== activePool && pool.active) setActivePool(pool.id);
                                // a draft like the value: saved by the Mentés button, with the value
                                setMetaDrafts((d) => ({ ...d, [key]: m }));
                              }}
                            />
                          )}
                          <div className="cell-meta">
                            {st?.state === "saving" && <span>Mentés…</span>}
                            {st?.state === "queued" && <span className="wait">{st.message}</span>}
                            {st?.state === "error" && <span className="err">{st.message}</span>}
                            {(!st || st.state === "saved") && cell && (
                              <span>
                                {cell.localTime} · {cell.responsibleMonogram}
                              </span>
                            )}
                            {out && <span className="ref"> {rangeText(range)}</span>}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {conflict && (
        <div className="card conflict" role="alertdialog" aria-label="Mentési ütközés" data-testid="conflict">
          <h2>Figyelem: a mérés időközben megváltozott</h2>
          <p>
            Más már mentett ide értéket: <b>{huNumber(conflict.server.value)}</b>. A te még nem mentett értéked:{" "}
            <b>{huNumber(conflict.draft)}</b>. Egyik változatot sem írjuk felül automatikusan.
          </p>
          <div className="versions">
            <div className="field">
              Szerveren mentve
              <span className="pill">{huNumber(conflict.server.value)}</span>
            </div>
            <div className="field">
              Saját piszkozat
              <span className="pill">{huNumber(conflict.draft)}</span>
            </div>
          </div>
          <div className="actions">
            <button className="btn btn-dark" type="button" onClick={keepDraft}>
              Piszkozat megtartása
            </button>
            <button className="btn" type="button" onClick={loadFresh}>
              Friss adat betöltése
            </button>
          </div>
          <p className="hint">A döntésig az eredeti bejegyzés változatlan.</p>
        </div>
      )}

      <div className="status-row">
        {queueSize > 0 ? (
          <div className="banner banner-warn" data-testid="queue">
            {queueSize} mentés várakozik a kapcsolatra, nem veszett el
          </div>
        ) : (
          <div className="banner banner-ok">
            <span className="dot" />
            {unsaved > 0 ? `${unsaved} érték még nincs mentve: a Mentés gombbal rögzül` : "Nincs mentetlen érték"}
          </div>
        )}
        {anyOut && <div className="banner banner-error">↗ Eltérés a referenciaértéktől</div>}
        {banner && (
          <div className={`banner banner-${banner.kind}`} role="status" data-testid="banner">
            {banner.text}
          </div>
        )}
      </div>
    </>
  );
}

function WeeklyMeta({
  label,
  testId,
  meta,
  editable,
  onChange,
}: {
  label: string;
  testId: string;
  meta: Meta;
  editable: boolean;
  onChange: (m: Meta) => void;
}) {
  if (!editable) {
    const parts = [meta.dilution ? `1:${meta.dilution}` : null, meta.diluentWater].filter(Boolean);
    return <div className="cell-meta" data-testid={`meta-${testId}`}>{parts.length ? parts.join(" · ") : " "}</div>;
  }
  return (
    <div className="meta-row">
      <select
        className="meta-select"
        aria-label={`${label} hígítás`}
        data-testid={`dilution-${testId}`}
        value={meta.dilution ?? ""}
        onChange={(e) => onChange({ ...meta, dilution: e.target.value ? Number(e.target.value) : null })}
      >
        <option value="">hígítás</option>
        {DILUTIONS.map((d) => (
          <option key={d} value={d}>
            1:{d}
          </option>
        ))}
      </select>
      <select
        className="meta-select"
        aria-label={`${label} hígító víz`}
        data-testid={`diluent-${testId}`}
        value={meta.diluentWater ?? ""}
        onChange={(e) => onChange({ ...meta, diluentWater: (e.target.value || null) as Meta["diluentWater"] })}
      >
        <option value="">RO/SW</option>
        <option value="RO">RO</option>
        <option value="SW">SW</option>
      </select>
    </div>
  );
}
