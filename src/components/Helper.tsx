"use client";

// AST-01..AST-03: a static figure in the corner with a speech bubble: fixed quick questions about the
// page's data, never free text (D-23). The figure is Lili's own pictures (2026-10-29, item 10; the rights are
// hers to give, D-38): one per situation, public/segito/<figure>-<situation>.webp: "feladatok" with the
// missed-measurement alert, "vegyszer" with the chemical alert, "udv-1..3" at rest and in the greeting. Switched
// off in the header (HelperToggle), the figure and the greeting go; the
// URGENT notices (the missed measurement, a chemical running out) stay, in a small strip (Lili 2026-10-27
// 13:25 UTC).
//
// WHAT SPEAKS BY ITSELF TAKES NO CLICK. The figure says something unasked twice: an alert, once per key and
// session (AST-03), and a greeting, once per login (it goes with the first click). Both are a text-only
// bubble with pointer-events: none, and so is the strip: none of them can cover a form's button (the
// tablet e2e of #109, where the greeting sat on "Tétel mentése"; barracuda on #109: in the afternoon the
// measurement alert would open on every water page). The bubble with the questions opens only from the
// figure, and starts with the alert.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { HelperData } from "@/lib/helpers";
import { followAnswer, followNotice, type Notice } from "@/lib/helper-notice";
import { anchorOf, isDoubleTap, isDrag, KEY_STEP, placeKey, placeToPx, pxToPlace, readPlace, writePlace, type Place } from "@/lib/helper-place";
import { readOff, SWITCH_EVENT } from "@/lib/helper-switch";
import { REMINDER_EVENT, REMINDER_TEXT } from "@/lib/save-reminder";

const SEEN_KEY = "caparium-segito-latta";
const GREETED_KEY = "caparium-segito-koszont";
const FIGURE = { water: { slug: "antennarius", name: "Antennarius" }, feeding: { slug: "zebracapa", name: "Zebracápa" } } as const;
const ALERT_PICTURE = { measurement: "feladatok", stock: "vegyszer", feed: "takarmany" } as const;
const GREETING_PICTURES = 3;
// the alert waits a beat after the greeting went: a click that LEAVES the page (a menu link) must not mark it heard
const ALERT_AFTER_GREETING_MS = 600;

export function Helper({ data, userName, loginAt, userKey }: { data: HelperData; userName?: string; loginAt?: number; userKey?: string }) {
  const [off, setOff] = useState(false);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [animal, setAnimal] = useState(data.perAnimal?.[0]?.name ?? "");
  // which of the greeting pictures the figure wears while it greets; at rest it is the first
  const [greetingPicture, setGreetingPicture] = useState(1);
  // set once the stored state is read: before that a click could race the auto-open below
  const [ready, setReady] = useState(false);
  // Lili 2026-10-30 (msg 1565719910833721357): the figure can be dragged (a mouse, a finger), stays inside the screen, keeps its place
  // per user and goes back to its corner on a double click or tap. `place` null is the corner; a size tick re-reads the screen on a resize.
  const [place, setPlace] = useState<Place | null>(null);
  const [dragging, setDragging] = useState(false);
  const [, setScreenTick] = useState(0);
  const figureRef = useRef<HTMLButtonElement>(null);
  const press = useRef<{ id: number; x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const storeKey = placeKey(userKey);
  const figure = FIGURE[data.who];
  // while it greets the figure wears a greeting picture, even with an alert waiting; then the alert's, else at rest the first
  const picture =
    notice?.kind === "greeting" ? `udv-${greetingPicture}` : data.alert ? ALERT_PICTURE[data.alertKind ?? "measurement"] : "udv-1";
  // the alert the shown texts were taken from: a refresh (a save) may change or end it
  const shownAlert = useRef(data.alert);

  /** AST-03: the alert speaks once per key and session; true when it did. */
  function alertIfNew(): boolean {
    if (!data.alert) return false;
    const key = data.alertKey ?? data.alert;
    try {
      if (sessionStorage.getItem(SEEN_KEY) === key) return false;
      sessionStorage.setItem(SEEN_KEY, key);
    } catch {
      /* without storage it speaks on every page with an alert */
    }
    setNotice({ kind: "alert", text: data.alert });
    return true;
  }
  /**
   * The hello, once per LOGIN (Lili 2026-10-29): it shows after the login, on the first page that has the figure, and goes
   * with the first click anywhere (below). The mark is the login's start, so a new login in the same tab greets again;
   * an alert waits until the hello is gone. True when it greets.
   */
  function greetIfNew(): boolean {
    try {
      const mark = String(loginAt ?? "login");
      if (sessionStorage.getItem(GREETED_KEY) === mark) return false;
      sessionStorage.setItem(GREETED_KEY, mark);
    } catch {
      return false; // without storage it would greet on every page: it does not greet
    }
    setGreetingPicture(1 + Math.floor(Math.random() * GREETING_PICTURES));
    setNotice({ kind: "greeting", text: userName ? `Üdv a fedélzeten ${userName}!` : "Üdv a fedélzeten!" });
    return true;
  }
  // the hello goes with the FIRST click (or key) anywhere, and the click goes on to its target: the listeners only watch
  // (capture, no stopPropagation), and the bubble itself takes no click. An alert not yet heard speaks a beat later and
  // is marked heard only when it speaks (barracuda on #122): where the click was a link, the page is gone before that,
  // and the alert speaks on the next page. The latest alertIfNew is read through a ref: the timer outlives the effect.
  const alertLater = useRef<() => boolean>(() => false);
  alertLater.current = alertIfNew;
  const alertTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(alertTimer.current), []);
  useEffect(() => {
    if (notice?.kind !== "greeting") return;
    const remove = () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", dismiss, true);
    };
    const dismiss = () => {
      remove();
      setNotice(null);
      alertTimer.current = setTimeout(() => alertLater.current(), ALERT_AFTER_GREETING_MS);
    };
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", dismiss, true);
    return remove;
  }, [notice?.kind]);

  // card 0d617f0c: the form announces "Ne felejtsd el menteni!" (src/lib/save-reminder.ts) and takes it back once saved.
  // Like the greeting it is a text-only bubble that goes with the first click or key anywhere; the form speaks again
  // after another quiet minute if the values are still not saved.
  useEffect(() => {
    const onReminder = (e: Event) => {
      const on = (e as CustomEvent<boolean>).detail;
      setNotice((n) => (on ? { kind: "reminder", text: REMINDER_TEXT } : n?.kind === "reminder" ? null : n));
    };
    window.addEventListener(REMINDER_EVENT, onReminder);
    return () => window.removeEventListener(REMINDER_EVENT, onReminder);
  }, []);
  useEffect(() => {
    if (notice?.kind !== "reminder") return;
    const remove = () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", dismiss, true);
    };
    // registered after the click that may have announced it (a link's leave warning): the next one takes it away
    const dismiss = () => {
      remove();
      setNotice((n) => (n?.kind === "reminder" ? null : n));
    };
    const id = window.setTimeout(() => {
      document.addEventListener("pointerdown", dismiss, true);
      document.addEventListener("keydown", dismiss, true);
    }, 0);
    return () => {
      window.clearTimeout(id);
      remove();
    };
  }, [notice?.kind]);

  useEffect(() => {
    setReady(true);
    // what is already shown follows the refreshed data; the key rule below decides only whether it speaks again
    setNotice((n) => followNotice(n, data.alert));
    const previous = shownAlert.current;
    setAnswer((a) => followAnswer(a, previous, data.alert));
    shownAlert.current = data.alert;
    const isOff = readOff();
    setOff(isOff);
    // switched off, the alert is not marked as seen: switched back on, it still speaks once
    if (!isOff && !greetIfNew()) alertIfNew();
    const onSwitch = (e: Event) => {
      const v = (e as CustomEvent<boolean>).detail;
      setOff(v);
      // switched back on: an alert not seen yet speaks on this page, not only on the next one
      if (!v) alertIfNew();
    };
    window.addEventListener(SWITCH_EVENT, onSwitch);
    return () => window.removeEventListener(SWITCH_EVENT, onSwitch);
  }, [data.alert, data.alertKey]);

  // the stored place is read after mounting (the server renders the corner); a resize re-fits it
  useEffect(() => {
    setPlace(readPlace(storeKey));
    const onResize = () => setScreenTick((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [storeKey]);

  const screenOf = () => {
    const r = figureRef.current?.getBoundingClientRect();
    return { vw: document.documentElement.clientWidth, vh: window.innerHeight, fw: r?.width ?? 100, fh: r?.height ?? 125 };
  };
  /** The figure goes to a top-left corner in px, inside the screen, and the place is kept. */
  const moveTo = (x: number, y: number, keep: boolean) => {
    const next = pxToPlace(x, y, screenOf());
    setPlace(next);
    if (keep) writePlace(storeKey, next);
  };
  const backToCorner = () => {
    setPlace(null);
    writePlace(storeKey, null);
  };
  const onFigureDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onFigureMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved && !isDrag(dx, dy)) return;
    if (!p.moved) {
      p.moved = true;
      setDragging(true);
    }
    moveTo(p.left + dx, p.top + dy, false);
  };
  const onFigureUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    if (p.moved) {
      // the click that follows the release of a drag must not open the bubble
      suppressClick.current = true;
      window.setTimeout(() => (suppressClick.current = false), 60);
      setDragging(false);
      moveTo(p.left + (e.clientX - p.x), p.top + (e.clientY - p.y), true);
      lastTap.current = null;
      return;
    }
    const tap = { t: Date.now(), x: e.clientX, y: e.clientY };
    if (isDoubleTap(lastTap.current, tap)) {
      lastTap.current = null;
      backToCorner();
    } else lastTap.current = tap;
  };
  const onFigureKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const r = figureRef.current?.getBoundingClientRect();
    if (!r) return;
    const step = { ArrowLeft: [-KEY_STEP, 0], ArrowRight: [KEY_STEP, 0], ArrowUp: [0, -KEY_STEP], ArrowDown: [0, KEY_STEP] }[e.key as "ArrowLeft"];
    if (step) {
      e.preventDefault();
      moveTo(r.left + step[0], r.top + step[1], true);
    } else if (e.key === "Home") {
      e.preventDefault();
      backToCorner();
    }
  };
  /** The container's anchoring for the place: the edges nearest the figure, so the bubble opens towards the room. */
  const placeStyle = (): CSSProperties | undefined => {
    if (!place) return undefined;
    const s = screenOf();
    const { x, y } = placeToPx(place, s);
    const a = anchorOf(place);
    return {
      left: a.horizontal === "left" ? x : "auto",
      right: a.horizontal === "right" ? s.vw - x - s.fw : "auto",
      top: a.vertical === "top" ? y : "auto",
      bottom: a.vertical === "bottom" ? s.vh - y - s.fh : "auto",
    };
  };

  if (off) {
    // the urgent notices are not switched off with the figure
    return data.alert ? (
      <div className="helper-urgent no-print" role="status" data-testid="helper-urgent" data-ready="1">
        {data.alert}
      </div>
    ) : null;
  }
  return (
    <div
      className={`helper no-print${place ? ` helper-placed helper-${anchorOf(place).horizontal} helper-${anchorOf(place).vertical}` : ""}${dragging ? " helper-dragging" : ""}`}
      style={placeStyle()}
      data-testid="helper"
      data-ready={ready ? "1" : undefined}
      data-placed={place ? "1" : undefined}
    >
      {notice && !open && (
        <p className="helper-bubble helper-notice" role="status" data-kind={notice.kind} data-testid="helper-notice">
          {notice.text}
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
        ref={figureRef}
        className={`helper-figure${data.alert ? " alert" : ""}`}
        type="button"
        onPointerDown={onFigureDown}
        onPointerMove={onFigureMove}
        onPointerUp={onFigureUp}
        onPointerCancel={() => {
          press.current = null;
          setDragging(false);
        }}
        onKeyDown={onFigureKey}
        onClick={() => {
          if (suppressClick.current) return;
          setNotice(null);
          // the bubble starts with the alert: the figure's "!" is about it
          if (!open) setAnswer(data.alert ?? null);
          setOpen(!open);
        }}
        aria-expanded={open}
        aria-label={`${figure.name}${data.alert ? ", figyelmeztetés" : ""}`}
        data-testid="helper-button"
      >
        <img className="helper-face" src={`/segito/${figure.slug}-${picture}.webp`} alt="" height={80} data-picture={picture} />
        {data.alert && (
          <span className="helper-badge" aria-hidden="true">
            !
          </span>
        )}
      </button>
    </div>
  );
}
