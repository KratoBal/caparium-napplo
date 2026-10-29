"use client";

// THE FEEDING TIMETABLE (6fe63c9b, item 4): every living animal by group, Monday to Sunday, one save for the
// changed rows. The save keeps one request id until it succeeds (#42's rule): a lost answer is replayed, never
// recorded twice.
import { Fragment, useMemo, useState } from "react";
import { Msg, useSend } from "./FeedingForms";

const WEEKDAYS = ["H", "K", "Sze", "Cs", "P", "Szo", "V"];

type Row = { id: string; name: string; groupName: string | null; poolName: string | null; weekdays: number[] };

function newRequestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

const key = (days: number[]) => [...days].sort().join(",");

export function Timetable({ animals, editable }: { animals: Row[]; editable: boolean }) {
  const [days, setDays] = useState<Record<string, number[]>>(() => Object.fromEntries(animals.map((a) => [a.id, a.weekdays])));
  const [pendingId, setPendingId] = useState<string | null>(null);
  const { msg, busy, run } = useSend();
  const changed = useMemo(() => animals.filter((a) => key(days[a.id] ?? []) !== key(a.weekdays)), [animals, days]);
  const anyPlan = animals.some((a) => a.weekdays.length > 0);
  const toggle = (id: string, d: number, on: boolean) => {
    setPendingId(null); // a new choice is a new request
    setDays((cur) => {
      const list = cur[id] ?? [];
      return { ...cur, [id]: on ? [...new Set([...list, d])] : list.filter((x) => x !== d) };
    });
  };
  async function save() {
    const id = pendingId ?? newRequestId();
    setPendingId(id);
    const ok = await run(
      "/api/feeding/plans",
      { requestId: id, plans: changed.map((a) => ({ animalId: a.id, weekdays: days[a.id] ?? [] })) },
      // a replay (the first answer was lost) is a save already done, not "0 saved" (barracuda #43)
      (res) => (res.replayed ? "Már mentve." : `Mentve: ${Number(res.changed ?? 0)} állat terve.`),
    );
    if (ok) setPendingId(null);
  }
  return (
    <div className="card" data-testid="timetable">
      <h2>Heti etetési rend</h2>
      {!anyPlan && (
        <p className="banner banner-warn" data-testid="timetable-empty">
          Még nincs etetési terv. Pipáld be, melyik állat a hét mely napjain eszik, és mentsd: a takarmánynaplóban a „Mai Terv” gomb ebből jelöli ki az aznapi állatokat.
        </p>
      )}
      <p className="hint">Ugyanaz a terv, mint az állat adatlapján. A terv nem tény: a napi listát továbbra is kézzel lehet módosítani.</p>
      <div className="table-scroll">
        <table className="log-table" data-testid="timetable-table">
          <thead>
            <tr>
              <th>Állat</th>
              <th>Medence</th>
              {WEEKDAYS.map((w) => (
                <th key={w}>{w}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {animals.map((a, i) => (
              <Fragment key={a.id}>
                {(i === 0 || animals[i - 1]!.groupName !== a.groupName) && (
                  <tr className="group-head">
                    <td colSpan={2 + WEEKDAYS.length}>
                      <b>{a.groupName ?? "Csoport nélkül"}</b>
                    </td>
                  </tr>
                )}
                <tr>
                  <td>{a.name}</td>
                  <td>{a.poolName ?? "–"}</td>
                  {WEEKDAYS.map((w, d) => (
                    <td key={w} className="keep">
                      <input
                        type="checkbox"
                        checked={(days[a.id] ?? []).includes(d + 1)}
                        disabled={!editable || busy}
                        aria-label={`${a.name}: ${w}`}
                        onChange={(e) => toggle(a.id, d + 1, e.target.checked)}
                      />
                    </td>
                  ))}
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="toolbar">
          <button className="btn" type="button" disabled={busy || changed.length === 0} onClick={() => void save()}>
            Etetési rend mentése{changed.length ? ` (${changed.length} állat)` : ""}
          </button>
          <Msg msg={msg} />
        </div>
      )}
    </div>
  );
}
