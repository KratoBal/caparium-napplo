"use client";

// The admin's own order of the animals (Lili 2026-10-26, card f67b1a06, item 4): drag a row (a mouse), or use the
// up and down buttons (a tablet has no HTML drag). Nothing is stored until "Sorrend mentése"; the lists and the
// exports then follow the saved order. The moves are the pure rules of lib/animal-order.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { moveBy, moveTo } from "@/lib/animal-order";

type Row = { id: string; name: string; species: string; poolName: string | null };

function requestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function AnimalOrder({ animals }: { animals: Row[] }) {
  const router = useRouter();
  const initial = animals.map((a) => a.id);
  const [order, setOrder] = useState(initial);
  const [dragging, setDragging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const byId = new Map(animals.map((a) => [a.id, a]));
  const dirty = order.join() !== initial.join();

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/animals/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: requestId(), ids: order }),
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
      <ol data-testid="animal-order" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {order.map((id, i) => {
          const a = byId.get(id)!;
          return (
            <li
              key={id}
              draggable
              data-testid={`order-row-${a.name}`}
              onDragStart={() => setDragging(id)}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging && dragging !== id) setOrder((cur) => moveTo(cur, dragging, cur.indexOf(id)));
                setDragging(null);
              }}
              className="toolbar"
              style={{ margin: "4px 0", cursor: "grab", opacity: dragging === id ? 0.5 : 1 }}
            >
              <span aria-hidden="true" style={{ minWidth: 28 }}>
                {i + 1}.
              </span>
              <span style={{ minWidth: 200 }}>{a.name}</span>
              <span className="hint" style={{ flex: 1 }}>
                {a.species}
                {a.poolName ? ` · ${a.poolName}` : ""}
              </span>
              <button className="btn btn-soft" type="button" aria-label={`${a.name} feljebb`} disabled={i === 0 || busy} onClick={() => setOrder((cur) => moveBy(cur, id, -1))}>
                Fel
              </button>
              <button className="btn btn-soft" type="button" aria-label={`${a.name} lejjebb`} disabled={i === order.length - 1 || busy} onClick={() => setOrder((cur) => moveBy(cur, id, 1))}>
                Le
              </button>
            </li>
          );
        })}
      </ol>
      <div className="toolbar">
        <button className="btn" type="button" data-testid="save-order" disabled={busy || !dirty} onClick={() => void save()}>
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
