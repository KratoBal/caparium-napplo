"use client";

// Lili 2026-10-29 (caparium-finomitas-1): the settings page's modules fold, so the one being worked on is not lost
// among the others. Each opens by default; what a viewer folds stays folded in that browser (a viewer's own
// convenience, so the browser's storage, wrapped: without it every module is simply open).
import { useEffect, useState, type ReactNode } from "react";

const KEY = (id: string) => `caparium-beallitasok-csukva:${id}`;

export function SettingsCard({ id, title, testId, htmlId, children }: { id: string; title: string; testId?: string; htmlId?: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(KEY(id)) === "1") setOpen(false);
    } catch {
      /* no storage: open */
    }
  }, [id]);
  return (
    <details
      className="card settings-fold"
      data-testid={testId}
      id={htmlId}
      open={open}
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(now);
        try {
          if (now) window.localStorage.removeItem(KEY(id));
          else window.localStorage.setItem(KEY(id), "1");
        } catch {
          /* no storage: not remembered */
        }
      }}
    >
      <summary>
        <h2>{title}</h2>
      </summary>
      {children}
    </details>
  );
}
