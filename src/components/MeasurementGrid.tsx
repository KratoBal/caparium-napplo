"use client";

// The daily measurement grid (VIZ-03, VIZ-04, VIZ-08, VIZ-09, ÁLT-03, ÁLT-07, ÁLT-12, ÁLT-15, VIZ-02).
// Autosave on leaving a cell; a "Mérés mentése" button as confirmation. A failed network
// request goes to a local queue with the same request id, so a retry never saves twice.

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CellView, RangeView } from "@/lib/queries";

type Grid = {
  group: { id: string; name: string };
  day: string;
  layout: {
    pools: { id: string; name: string }[];
    parameters: { id: string; name: string; decimals: number; unit: { symbol: string } }[];
  };
  rounds: { id: string; seq: number }[];
  selectedRound: { id: string; seq: number } | null;
  cells: Record<string, CellView>;
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

function requestId(): string {
  // crypto.randomUUID needs a secure context; getRandomValues does not (plain http on the tailnet)
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function nowLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

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
  people,
}: {
  initial: Grid;
  groupCode: string;
  today: string;
  user: { id: string; role: string };
  people: { id: string; fullName: string }[];
}) {
  const router = useRouter();
  const [grid, setGrid] = useState<Grid>(initial);
  const [activePool, setActivePool] = useState<string>(initial.layout.pools[0]?.id ?? "");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [cellState, setCellState] = useState<Record<string, CellState>>({});
  const [responsibleId, setResponsibleId] = useState(user.id);
  const [trainee, setTrainee] = useState(false);
  const [timeLocal, setTimeLocal] = useState(initial.day === today ? nowLocal() : `${initial.day}T12:00`);
  const [timeTouched, setTimeTouched] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const [queueSize, setQueueSize] = useState(0);
  const flushing = useRef(false);

  const queueKey = `napplo-queue-v1-${user.id}`;
  const isPastDay = grid.day !== today;
  const isAdmin = user.role === "ADMIN";
  const readOnly = isPastDay && !isAdmin;

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
    const t = setInterval(() => setTimeLocal(nowLocal()), 30_000);
    return () => clearInterval(t);
  }, [timeTouched, isPastDay]);

  const refresh = useCallback(async () => {
    const seq = grid.selectedRound?.seq;
    const res = await fetch(`/api/grid?groupId=${grid.group.id}&day=${grid.day}${seq ? `&round=${seq}` : ""}`, {
      cache: "no-store",
    });
    if (res.ok) setGrid((await res.json()) as Grid);
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
    (poolId: string, parameterId: string, value: string, overwrite?: { version: number }): QueueItem => {
      const key = `${poolId}:${parameterId}`;
      const existing = grid.cells[key];
      const common = {
        requestId: requestId(),
        clientTimestamp: new Date().toISOString(),
        value,
        responsibleUserId: responsibleId,
        traineePerformed: trainee,
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
    [grid, responsibleId, trainee, timeLocal, timeTouched],
  );

  const saveCell = useCallback(
    async (poolId: string, parameterId: string) => {
      const key = `${poolId}:${parameterId}`;
      const text = drafts[key];
      if (text === undefined) return;
      const existing = grid.cells[key];
      if (text.trim() === "" || (existing && text.trim().replace(",", ".") === existing.value)) {
        setDrafts((d) => {
          const next = { ...d };
          delete next[key];
          return next;
        });
        return;
      }
      const outcome = await send(buildItem(poolId, parameterId, text.trim()), false);
      if (outcome === "ok") await refresh();
    },
    [drafts, grid.cells, send, buildItem, refresh],
  );

  const saveAll = useCallback(async () => {
    setBanner(null);
    for (const key of Object.keys(drafts)) {
      const [poolId, parameterId] = key.split(":");
      await saveCell(poolId, parameterId);
    }
    await flushQueue();
    const left = readQueue().length;
    setBanner(left ? { kind: "warn", text: `${left} mentés várakozik a kapcsolatra.` } : { kind: "ok", text: "Minden érték mentve." });
  }, [drafts, saveCell, flushQueue, readQueue]);

  const openNewRound = useCallback(async () => {
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
    router.push(`/vizmeres?csoport=${groupCode}&nap=${grid.day}&kor=${body.round.seq}`);
    router.refresh();
  }, [grid.group.id, grid.day, groupCode, router]);

  const keepDraft = useCallback(async () => {
    if (!conflict) return;
    const [poolId, parameterId] = conflict.key.split(":");
    const fresh = grid.cells[conflict.key];
    if (!fresh) return;
    setConflict(null);
    const outcome = await send(buildItem(poolId, parameterId, conflict.draft, { version: fresh.version }), false);
    if (outcome === "ok") await refresh();
  }, [conflict, grid.cells, send, buildItem, refresh]);

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

  const anyOut = useMemo(() => Object.values(grid.cells).some((c) => c.reference === "LOW" || c.reference === "HIGH"), [grid.cells]);
  const unsaved = Object.keys(drafts).length;

  return (
    <>
      <div className="toolbar">
        <div className="tabs" aria-label="Mérési körök">
          {grid.rounds.map((r) => (
            <a
              key={r.id}
              className={`tab${grid.selectedRound?.id === r.id ? " active" : ""}`}
              href={`/vizmeres?csoport=${groupCode}&nap=${grid.day}&kor=${r.seq}`}
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
            Mérés mentése
          </button>
        )}
      </div>

      {isPastDay && (
        <div className="banner banner-warn" style={{ marginBottom: 16 }}>
          {isAdmin
            ? "Korábbi nap: minden módosításhoz indoklás kell, és bekerül a módosítási naplóba."
            : "Korábbi nap: csak megtekintés. Módosítani adminisztrátor tud."}
        </div>
      )}

      <div className="card">
        <h2>Napi paraméterek{grid.selectedRound ? ` · ${grid.selectedRound.seq}. mérés` : ""}</h2>
        <p className="hint">
          A beírt érték automatikusan ellenőrződik és mentődik. Egy új mérés nem írja felül a korábbit.
        </p>
        {!readOnly && (
          <div className="toolbar">
            <label className="field">
              Mérés időpontja
              <input
                className="input"
                type="datetime-local"
                value={timeLocal}
                onChange={(e) => {
                  setTimeLocal(e.target.value);
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
        <div className="table-scroll">
          <table className="grid-table">
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
                const active = pool.id === activePool && !readOnly;
                return (
                  <tr key={pool.id} className={active ? "active-row" : undefined} data-testid={`row-${pool.name}`}>
                    <td className="pool-cell">
                      <button type="button" onClick={() => setActivePool(pool.id)} aria-pressed={active}>
                        {pool.name}
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
                          ? draftOutOfRange(draft, grid.currentRanges[param.id])
                          : cell?.reference === "LOW" || cell?.reference === "HIGH";
                      const range = cell?.range ?? grid.currentRanges[param.id];
                      return (
                        <td key={param.id}>
                          {active ? (
                            <input
                              className={`cell-input${out ? " out" : ""}`}
                              inputMode="decimal"
                              autoComplete="off"
                              aria-label={`${pool.name} ${param.name}`}
                              data-testid={`cell-${pool.name}-${param.name}`}
                              value={shown}
                              onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                              onBlur={() => void saveCell(pool.id, param.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              }}
                            />
                          ) : (
                            <div
                              className={`cell-value${shown ? "" : " empty"}${out ? " out" : ""}`}
                              data-testid={`value-${pool.name}-${param.name}`}
                              onClick={() => !readOnly && setActivePool(pool.id)}
                            >
                              {shown || "–"}
                            </div>
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
            {unsaved > 0 ? `${unsaved} érték még nincs elküldve` : "Automatikus mentés aktív"}
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
