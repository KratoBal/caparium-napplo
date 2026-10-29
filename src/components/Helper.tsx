"use client";

// AST-01..AST-03: a static figure in the corner with a speech bubble: fixed quick questions about the
// page's data, never free text (D-23). The figure is drawn from an emoji, not an image: the AI-generated
// character sheets wait for D-38 (their rights), and an image is a file swap in FIGURE below (card
// 8b22c3c2, acrobot 38044). It opens by itself once per alert (AST-03), and greets once per session: the
// greeting is a text-only bubble that takes no click (pointer-events: none) and goes after GREETING_MS,
// so it never covers a form's button (the tablet e2e of #109: it sat on "Tétel mentése").
// Switched off in the header (HelperToggle), the figure and the greeting go; the URGENT notices (the
// missed measurement, a chemical running out) stay, in a small strip (Lili 2026-10-27 13:25 UTC).
import { useEffect, useState } from "react";
import type { HelperData } from "@/lib/helpers";
import { readOff, SWITCH_EVENT } from "@/lib/helper-switch";

const SEEN_KEY = "caparium-segito-latta";
const GREETED_KEY = "caparium-segito-koszont";
const FIGURE = { water: { emoji: "🐠", name: "Antennarius" }, feeding: { emoji: "🦈", name: "Zebracápa" } } as const;
const GREETING_MS = 8000;

export function Helper({ data }: { data: HelperData }) {
  const [off, setOff] = useState(false);
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [greeting, setGreeting] = useState(false);
  const [animal, setAnimal] = useState(data.perAnimal?.[0]?.name ?? "");
  // set once the stored state is read: before that a click could race the auto-open below
  const [ready, setReady] = useState(false);
  const figure = FIGURE[data.who];

  /** AST-03: opens with the alert once per key and session; true when it did. It is also the figure's hello:
   * the next page does not greet after it (an alert, then a hello, would open the bubble on every page) */
  function openIfNew(): boolean {
    if (!data.alert) return false;
    const key = data.alertKey ?? data.alert;
    try {
      if (sessionStorage.getItem(SEEN_KEY) === key) return false;
      sessionStorage.setItem(SEEN_KEY, key);
      sessionStorage.setItem(`${GREETED_KEY}-${data.who}`, "1");
    } catch {
      /* without storage it opens on every page with an alert */
    }
    setOpen(true);
    setAnswer(data.alert);
    return true;
  }
  /** the hello, once per session and figure; an alert goes first */
  function greetIfNew() {
    try {
      if (sessionStorage.getItem(`${GREETED_KEY}-${data.who}`) === "1") return;
      sessionStorage.setItem(`${GREETED_KEY}-${data.who}`, "1");
    } catch {
      return; // without storage it would greet on every page: it does not greet
    }
    setGreeting(true);
  }
  useEffect(() => {
    if (!greeting) return;
    const t = setTimeout(() => setGreeting(false), GREETING_MS);
    return () => clearTimeout(t);
  }, [greeting]);

  useEffect(() => {
    setReady(true);
    const isOff = readOff();
    setOff(isOff);
    // switched off, the alert is not marked as seen: switched back on, it still opens once
    if (!isOff && !openIfNew()) greetIfNew();
    const onSwitch = (e: Event) => {
      const v = (e as CustomEvent<boolean>).detail;
      setOff(v);
      // switched back on: an alert not seen yet opens on this page, not only on the next one
      if (!v) openIfNew();
    };
    window.addEventListener(SWITCH_EVENT, onSwitch);
    return () => window.removeEventListener(SWITCH_EVENT, onSwitch);
  }, [data.alert, data.alertKey]);

  if (off) {
    // the urgent notices are not switched off with the figure
    return data.alert ? (
      <div className="helper-urgent no-print" role="status" data-testid="helper-urgent" data-ready="1">
        {data.alert}
      </div>
    ) : null;
  }
  return (
    <div className="helper no-print" data-testid="helper" data-ready={ready ? "1" : undefined}>
      {greeting && !open && (
        <p className="helper-bubble helper-greeting" role="status" data-testid="helper-greeting">
          {data.greeting}
        </p>
      )}
      {open && (
        <div className="helper-bubble" role="dialog" aria-label={`${figure.name} segítő`}>
          {answer && (
            <p className="helper-answer" data-testid="helper-answer">
              {answer}
            </p>
          )}
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
        </div>
      )}
      <button
        className={`helper-figure${data.alert ? " alert" : ""}`}
        type="button"
        onClick={() => {
          setGreeting(false);
          setOpen(!open);
        }}
        aria-expanded={open}
        aria-label={`${figure.name}${data.alert ? ", figyelmeztetés" : ""}`}
        data-testid="helper-button"
      >
        <span className="helper-face" aria-hidden="true">
          {figure.emoji}
        </span>
        <span className="helper-name">{figure.name}</span>
        {data.alert && (
          <span className="helper-badge" aria-hidden="true">
            !
          </span>
        )}
      </button>
    </div>
  );
}
