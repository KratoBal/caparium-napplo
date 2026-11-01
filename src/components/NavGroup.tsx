"use client";

// The phone menu's drop-down (Lili 2026-11-01, point 12): "Vízmérés" and "Takarmányozás" open their entries under the menu row instead of
// the long scrolling row of every entry. The row scrolls sideways, so the list is fixed under it, not inside it (it would be cut off).
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { NavItem, NavKey, NavTone } from "@/lib/nav";

export function NavGroup({ label, tone, items, active }: { label: string; tone: NavTone; items: NavItem[]; active?: NavKey }) {
  const [top, setTop] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const open = top !== null;
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setTop(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTop(null);
    };
    const close = () => setTop(null);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", close, { passive: true });
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", close);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  const current = items.some((n) => n.key === active);
  return (
    <div className="nav-group" ref={box} data-testid={`nav-group-${tone}`}>
      <button
        type="button"
        className={["nav-group-btn", `nav-${tone}`, current ? "active" : ""].filter(Boolean).join(" ")}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={(e) => {
          const nav = (e.currentTarget.closest(".nav") ?? e.currentTarget).getBoundingClientRect();
          setTop(open ? null : Math.round(nav.bottom));
        }}
      >
        {label}
        <span aria-hidden="true" className="nav-group-caret">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div className="nav-group-panel" style={{ top }} role="menu" aria-label={label}>
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
        </div>
      )}
    </div>
  );
}
