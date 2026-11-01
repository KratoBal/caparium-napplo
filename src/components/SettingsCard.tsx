"use client";

// Lili 2026-10-29 (caparium-finomitas-1): the settings page's modules fold, so the one being worked on is not lost
// among the others. Lili 2026-11-01 (point 15): every module starts closed and opens only on a click; nothing is
// remembered between visits. The one exception is a link to a module's anchor (`/beallitasok#felhasznalok`, from the
// ZIMS warnings): that module opens, or the link would land on a closed heading.
import { useEffect, useState, type ReactNode } from "react";

export function SettingsCard({ id, title, testId, htmlId, children }: { id: string; title: string; testId?: string; htmlId?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!htmlId) return;
    const fromHash = () => {
      if (window.location.hash === `#${htmlId}`) setOpen(true);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [htmlId]);
  return (
    <details
      className="card settings-fold"
      data-testid={testId}
      data-fold={id}
      id={htmlId}
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <h2>{title}</h2>
      </summary>
      {children}
    </details>
  );
}
