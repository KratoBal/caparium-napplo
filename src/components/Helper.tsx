"use client";

// AST-01..AST-03: a helper in the corner: fixed quick questions about the page's data, never free text
// (D-23); simple icons, no AI-generated figure (NY-10 default); switched off per browser (a viewer's
// convenience, kept in localStorage); it opens by itself once when there is something to say (AST-03).
import { useEffect, useState } from "react";
import type { HelperData } from "@/lib/helpers";

const OFF_KEY = "caparium-segito-ki";
const SEEN_KEY = "caparium-segito-latta";
const NAME = { water: "🐠 Antennarius", feeding: "🦈 Zebracápa" } as const;

export function Helper({ data }: { data: HelperData }) {
  const [off, setOff] = useState(false);
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [animal, setAnimal] = useState(data.perAnimal?.[0]?.name ?? "");
  // set once the stored state is read: before that a click could race the auto-open below
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
    let isOff = false;
    try {
      isOff = localStorage.getItem(OFF_KEY) === "1";
    } catch {
      /* no storage: the helper stays on */
    }
    setOff(isOff);
    // switched off, the alert is not marked as seen: switched back on, it still opens once
    if (!data.alert || isOff) return;
    const key = data.alertKey ?? data.alert;
    try {
      if (sessionStorage.getItem(SEEN_KEY) === key) return;
      sessionStorage.setItem(SEEN_KEY, key);
    } catch {
      /* without storage it opens on every page with an alert */
    }
    setOpen(true);
    setAnswer(data.alert);
  }, [data.alert, data.alertKey]);
  const setStored = (v: boolean) => {
    setOff(v);
    try {
      if (v) localStorage.setItem(OFF_KEY, "1");
      else localStorage.removeItem(OFF_KEY);
    } catch {
      /* not stored: it is back on the next page */
    }
  };
  if (off) {
    return (
      <button className="helper-on no-print" type="button" onClick={() => setStored(false)} data-testid="helper-on" data-ready="1">
        Segítő be
      </button>
    );
  }
  return (
    <div className="helper no-print" data-testid="helper" data-ready={ready ? "1" : undefined}>
      {open && (
        <div className="helper-panel" role="dialog" aria-label={`${NAME[data.who]} segítő`}>
          <div className="helper-qs">
            {data.questions.map((x) => (
              <button key={x.q} className="btn btn-soft" type="button" onClick={() => setAnswer(x.a)}>
                {x.q}
              </button>
            ))}
            {data.perAnimal && data.perAnimal.length > 0 && (
              <span className="helper-animal">
                <select className="input" value={animal} onChange={(e) => setAnimal(e.target.value)} aria-label="Melyik állat?">
                  {data.perAnimal.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button className="btn btn-soft" type="button" onClick={() => setAnswer(data.perAnimal!.find((p) => p.name === animal)?.a ?? null)}>
                  Mit kapott ma?
                </button>
              </span>
            )}
          </div>
          {answer && (
            <p className="helper-answer" data-testid="helper-answer">
              {answer}
            </p>
          )}
          <button className="helper-off" type="button" onClick={() => setStored(true)}>
            Segítő kikapcsolása
          </button>
        </div>
      )}
      <button className={`helper-button${data.alert ? " alert" : ""}`} type="button" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="helper-button">
        {NAME[data.who]}
        {data.alert ? " !" : ""}
      </button>
    </div>
  );
}
