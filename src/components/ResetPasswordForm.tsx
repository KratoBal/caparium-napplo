"use client";

import Link from "next/link";
import { useState } from "react";

/** The new password twice; the link's token goes with it (task e7f9e84d). */
export function ResetPasswordForm({ token }: { token: string }) {
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (done)
    return (
      <p role="status" data-testid="reset-done">
        Az új jelszó beállítva. <Link href="/belepes">Belépés</Link>
      </p>
    );
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (next.length < 10) return setError("Az új jelszó legalább 10 karakter legyen.");
        if (next !== again) return setError("A két új jelszó nem egyezik.");
        setBusy(true);
        setError(null);
        try {
          const res = await fetch("/api/password-reset", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token, newPassword: next }),
          });
          if (res.ok) setDone(true);
          else setError(((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? "A jelszó nem menthető.");
        } catch {
          setError("Nincs kapcsolat a szerverrel.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span>Új jelszó</span>
        <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
      </label>
      <label className="field">
        <span>Új jelszó még egyszer</span>
        <input className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
      </label>
      <button className="btn" type="submit" disabled={busy}>
        Jelszó beállítása
      </button>
      {error && (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      )}
    </form>
  );
}

/** The login id or the address; the answer is the same whatever happened (task e7f9e84d, slice 2). */
export function ForgotPasswordForm() {
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (answer)
    return (
      <p role="status" data-testid="forgot-done">
        {answer}
      </p>
    );
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const res = await fetch("/api/password-reset/request", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ identifier }),
          });
          const body = (await res.json().catch(() => null)) as { message?: string; error?: { message?: string } } | null;
          if (res.ok && body?.message) setAnswer(body.message);
          else setError(body?.error?.message ?? "A kérés nem ment el.");
        } catch {
          setError("Nincs kapcsolat a szerverrel.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span>Felhasználónév vagy e-mail cím</span>
        <input className="input" autoComplete="username" autoCapitalize="none" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
      </label>
      <button className="btn" type="submit" disabled={busy || !identifier.trim()}>
        Link kérése
      </button>
      {error && (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      )}
    </form>
  );
}
