"use client";

// The drop-down under Beállítások (Lili 2026-11-02, caparium-egyszerusites): Állatok, Függő mentések and Aktivitás open under the entry.
// "Beállítások" stays a link to its page; the caret next to it opens and closes the list. On a desktop the list opens inline in the side
// menu (and stands open on the page of one of its entries, so you see where you are). Where the menu is a sideways-scrolling row
// (900 px and below, as in globals.css) it opens as a list under the row, in a portal at the end of the body, like NavGroup: iOS Safari
// clips a fixed element inside a touch-scrolling box. The entries are plain links in both places.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { NavItem, NavKey } from "@/lib/nav";

const NARROW = "(max-width: 900px)";

export function NavSub({ parent, items, active }: { parent: NavItem; items: NavItem[]; active?: NavKey }) {
  const [open, setOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [top, setTop] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const label = `${parent.label} almenü`;
  const here = active === parent.key || items.some((n) => n.key === active);
  const rowBottom = useCallback(() => Math.round((box.current?.closest(".nav") ?? box.current)?.getBoundingClientRect().bottom ?? 0), []);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const sync = () => setNarrow(mq.matches);
    sync();
    // on a wide screen the list stands open where one of its entries is the page; in the row it opens on the caret only
    if (!mq.matches && here) setOpen(true);
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [here]);
  useEffect(() => {
    if (!open || !narrow) return;
    setTop(rowBottom());
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const follow = () => setTop(rowBottom());
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", follow, { passive: true });
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", follow);
      window.removeEventListener("resize", follow);
    };
  }, [open, narrow, rowBottom]);
  const links = items.map((n) => (
    <Link key={n.key} href={n.href} className={n.key === active ? "active" : undefined} onClick={() => narrow && setOpen(false)}>
      {n.label}
    </Link>
  ));
  return (
    <div className="nav-sub" ref={box} data-testid={`nav-sub-${parent.key}`}>
      <div className="nav-sub-head">
        <Link href={parent.href} className={parent.key === active ? "active" : undefined}>
          {parent.label}
        </Link>
        <button type="button" className="nav-sub-btn" aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>
          <span aria-hidden="true">{open ? "▴" : "▾"}</span>
        </button>
      </div>
      {open && !narrow && (
        <div className="nav-sub-list" role="group" aria-label={label}>
          {links}
        </div>
      )}
      {open &&
        narrow &&
        createPortal(
          <div className="nav-group-panel" ref={panel} style={{ top }} role="group" aria-label={label}>
            {links}
          </div>,
          document.body,
        )}
    </div>
  );
}
