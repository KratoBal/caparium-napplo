"use client";

// The header's right end: the helper's switch and the user. On a tablet and a desktop it is the box it always was (the switch, the name and the
// role, the Kilépés button). On a phone (Lili 2026-10-30 20:43 UTC, msg 1565813299197517825, task caparium-fejlec-telefon: "szerinted nem nagy ez
// a holtter a fejlecben?") it is one small button with the user's monogram, and what the box held opens under it: the name and the role, the
// helper's switch, the Kilépés. The server and the first client render say "not a phone", so nothing changes for the larger screens.
import { useEffect, useRef, useState } from "react";
import { HelperToggle } from "./HelperToggle";
import { useIsPhone } from "./useIsPhone";

export function TopbarUser({ name, roleLabel, monogram, helper }: { name: string; roleLabel: string; monogram: string; helper: boolean }) {
  const phone = useIsPhone();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (!phone) {
    return (
      <>
        {helper && <HelperToggle />}
        <div className="userbox">
          <span data-testid="current-user">
            {name} · {roleLabel}
          </span>
          <form method="post" action="/api/auth/logout">
            <button className="btn btn-soft" type="submit">
              Kilépés
            </button>
          </form>
        </div>
      </>
    );
  }
  return (
    <div className="profile no-print" ref={box}>
      <button
        type="button"
        className="profile-btn"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`${name}, profil`}
        data-testid="profile-button"
        onClick={() => setOpen(!open)}
      >
        {monogram}
      </button>
      {open && (
        <div className="profile-panel" role="group" aria-label="Profil" data-testid="profile-panel">
          <span data-testid="current-user">
            {name} · {roleLabel}
          </span>
          {helper && <HelperToggle />}
          <form method="post" action="/api/auth/logout">
            <button className="btn btn-soft" type="submit">
              Kilépés
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
