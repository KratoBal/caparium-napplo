"use client";

// The phone menu's drop-down (Lili 2026-11-01, point 12): "Vízmérés" and "Takarmányozás" open their entries under the menu row instead of
// the long scrolling row of every entry. Lili 2026-11-01 22:01 UTC (iPhone, stage 9abcefc5): nothing opened. The list stood inside the
// sideways-scrolling menu row; iOS Safari clips a fixed element inside a touch-scrolling box, and it fires resize and scroll as its bars
// move, which closed the list at once. So the list goes to the end of the page's body (a portal), outside every scrolling box, and a
// resize or a scroll moves it under the menu row again instead of closing it.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { NavItem, NavKey, NavTone } from "@/lib/nav";

export function NavGroup({ label, tone, items, active }: { label: string; tone: NavTone; items: NavItem[]; active?: NavKey }) {
  const [top, setTop] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const open = top !== null;
  // the menu row's bottom edge, where the list hangs
  const rowBottom = useCallback(() => Math.round((box.current?.closest(".nav") ?? box.current)?.getBoundingClientRect().bottom ?? 0), []);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !panel.current?.contains(t)) setTop(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTop(null);
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
  }, [open, rowBottom]);
  const current = items.some((n) => n.key === active);
  return (
    <div className="nav-group" ref={box} data-testid={`nav-group-${tone}`}>
      <button
        type="button"
        className={["nav-group-btn", `nav-${tone}`, current ? "active" : ""].filter(Boolean).join(" ")}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setTop(open ? null : rowBottom())}
      >
        {label}
        <span aria-hidden="true" className="nav-group-caret">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open &&
        createPortal(
          <div className="nav-group-panel" ref={panel} style={{ top: top ?? 0 }} role="menu" aria-label={label}>
            {items.map((n) => (
              <Link
                key={n.key}
                href={n.href}
                role="menuitem"
                className={[`nav-${tone}`, n.key === active ? "active" : ""].filter(Boolean).join(" ")}
                onClick={() => setTop(null)}
              >
                {n.icon && (
                  <span className="nav-icon" aria-hidden="true">
                    {n.icon}
                  </span>
                )}
                {n.label}
              </Link>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
