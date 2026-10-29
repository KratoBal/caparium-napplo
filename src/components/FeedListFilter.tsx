"use client";

// The feed list hides an inactive feed (Lili 2026-10-29 via acrobot 38203, as the pools in #107): shown only with the
// "Inaktívak mutatása" switch on, to be activated again. A row switched in this view stays until the page is left, so
// its message is read and an inactivation undone at once. The earlier days and the exports are not affected: they read
// the feeds themselves, not this list.
import { createContext, useContext, useState } from "react";

type Filter = { show: boolean; kept: string[]; keep: (id: string) => void };
const Ctx = createContext<Filter | null>(null);

export function FeedListFilter({ inactive, children }: { inactive: number; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const [kept, setKept] = useState<string[]>([]);
  const keep = (id: string) => setKept((k) => (k.includes(id) ? k : [...k, id]));
  return (
    <Ctx.Provider value={{ show, kept, keep }}>
      {inactive > 0 && (
        <label className="toolbar no-print" style={{ margin: "8px 0" }}>
          <input className="switch" type="checkbox" role="switch" checked={show} onChange={(e) => setShow(e.target.checked)} />
          Inaktívak mutatása ({inactive})
        </label>
      )}
      {children}
    </Ctx.Provider>
  );
}

/** A feed's row: an inactive one only with the switch on, or after it was switched in this view. */
export function FeedRowShell({ id, active, children }: { id: string; active: boolean; children: React.ReactNode }) {
  const f = useContext(Ctx);
  if (!active && f && !f.show && !f.kept.includes(id)) return null;
  return <tr className={active ? undefined : "invalid"}>{children}</tr>;
}

/** Called by the row's activation button: the row stays in view after the switch. */
export function useKeepFeedRow(): (id: string) => void {
  return useContext(Ctx)?.keep ?? (() => {});
}
