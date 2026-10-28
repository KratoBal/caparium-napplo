"use client";

// The admin's own order of the animals (Lili 2026-10-26, card f67b1a06, item 4; the drag handle, the place number and the
// row colors: Lili's msg 1564366437148270735 and 1564366690601664713, memory 2496). A row moves three ways: dragged by its
// HANDLE (a pointer drag, so a mouse and a finger both work; the old HTML drag had no touch), typed into its place
// number field, or with the small up and down buttons. The row being moved and the place it would land on are
// highlighted, the rows alternate in a faint background and the last touched row stands out. Nothing is stored until
// "Sorrend mentése"; the lists and the exports then follow the saved order. The rules are the pure ones of lib/animal-order.
// The same list orders the feeds inside a feed type (`OrderList`; Lili 2026-10-28, acrobot 37529).
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { moveBy, moveTo, parsePlace, rowAt } from "@/lib/animal-order";

/** A row of an order: its name (the testids carry it) and a faint detail after it. */
export type OrderRow = { id: string; name: string; detail: string };

function requestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** The place number of a row: type the place it should have, Enter or leaving the field moves it there. */
function PlaceField({ name, place, count, disabled, onPlace }: { name: string; place: number; count: number; disabled: boolean; onPlace: (index: number) => void }) {
  const [text, setText] = useState(String(place));
  useEffect(() => setText(String(place)), [place]);
  function commit() {
    const to = parsePlace(text, count);
    if (to === null || to === place - 1) return setText(String(place));
    onPlace(to);
  }
  return (
    <input
      className="input order-place"
      inputMode="numeric"
      aria-label={`${name} helye (sorszám)`}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

/**
 * The drag list of an order, one for the animals and one per feed type (Lili 2026-10-28, acrobot 37529: "ugyanúgy, mint az
 * állatoknál"). `saveUrl` takes `{ requestId, ids, ...extra }`.
 */
export function OrderList({
  rows,
  saveUrl,
  extra = {},
  testId,
  saveTestId = "save-order",
}: {
  rows: OrderRow[];
  saveUrl: string;
  extra?: Record<string, string>;
  testId: string;
  saveTestId?: string;
}) {
  const animals = rows;
  const router = useRouter();
  const initial = animals.map((a) => a.id);
  const [order, setOrder] = useState(initial);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const byId = new Map(animals.map((a) => [a.id, a]));
  const dirty = order.join() !== initial.join();

  const move = (id: string, to: number) => {
    setOrder((cur) => moveTo(cur, id, to));
    setActive(id);
  };

  // the pointer's row: the nearest row center (a row's rectangle is read at each move, the rows do not move while dragging)
  function rowUnder(clientY: number): number {
    const centers = order.map((id) => {
      const r = rowRefs.current.get(id)?.getBoundingClientRect();
      return r ? r.top + r.height / 2 : Infinity;
    });
    return rowAt(centers, clientY);
  }

  function endDrag(commit: boolean) {
    if (commit && dragging && over !== null && order.indexOf(dragging) !== over) move(dragging, over);
    setDragging(null);
    setOver(null);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(saveUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...extra, requestId: requestId(), ids: order }),
      });
      const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        setMsg({ ok: false, text: b.error?.message ?? "Nem sikerült." });
        return;
      }
      setMsg({ ok: true, text: "Mentve." });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Nincs kapcsolat a szerverrel." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <ol data-testid={testId} className="order-list">
        {order.map((id, i) => {
          const a = byId.get(id)!;
          const cls = ["order-row", dragging === id ? "dragging" : "", dragging && dragging !== id && over === i ? "drop-target" : "", active === id && !dragging ? "touched" : ""].filter(Boolean).join(" ");
          return (
            <li key={id} ref={(el) => void (el ? rowRefs.current.set(id, el) : rowRefs.current.delete(id))} data-testid={`order-row-${a.name}`} className={cls}>
              {/* the handle: a pointer drag with capture, so the move keeps coming after the pointer leaves it (a finger too) */}
              <span
                className="order-handle"
                data-testid={`order-handle-${a.name}`}
                aria-hidden="true"
                title="Húzd a helyére"
                onPointerDown={(e) => {
                  if (busy) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDragging(id);
                  setOver(i);
                  setActive(id);
                }}
                onPointerMove={(e) => {
                  if (dragging !== id) return;
                  setOver(rowUnder(e.clientY));
                  // near the top or bottom of the screen the page follows the finger
                  if (e.clientY < 70) window.scrollBy(0, -14);
                  else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 14);
                }}
                onPointerUp={() => endDrag(true)}
                onPointerCancel={() => endDrag(false)}
              >
                ⠿
              </span>
              <PlaceField name={a.name} place={i + 1} count={order.length} disabled={busy} onPlace={(to) => move(id, to)} />
              <span className="order-name">{a.name}</span>
              <span className="hint" style={{ flex: 1 }}>
                {a.detail}
              </span>
              <button className="btn btn-soft btn-mini" type="button" aria-label={`${a.name} feljebb`} disabled={i === 0 || busy} onClick={() => { setOrder((cur) => moveBy(cur, id, -1)); setActive(id); }}>
                Fel
              </button>
              <button className="btn btn-soft btn-mini" type="button" aria-label={`${a.name} lejjebb`} disabled={i === order.length - 1 || busy} onClick={() => { setOrder((cur) => moveBy(cur, id, 1)); setActive(id); }}>
                Le
              </button>
            </li>
          );
        })}
      </ol>
      <div className="toolbar">
        <button className="btn" type="button" data-testid={saveTestId} disabled={busy || !dirty} onClick={() => void save()}>
          Sorrend mentése
        </button>
        {dirty && !busy && (
          <button className="btn btn-soft" type="button" onClick={() => setOrder(initial)}>
            Elvetés
          </button>
        )}
        {msg && (
          <span className={msg.ok ? "hint" : "err"} role="status">
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}

type AnimalRow = { id: string; name: string; species: string; poolName: string | null };

/** The animals' order (the first user of the list above). */
export function AnimalOrder({ animals }: { animals: AnimalRow[] }) {
  return (
    <OrderList
      rows={animals.map((a) => ({ id: a.id, name: a.name, detail: `${a.species}${a.poolName ? ` · ${a.poolName}` : ""}` }))}
      saveUrl="/api/animals/order"
      testId="animal-order"
    />
  );
}
