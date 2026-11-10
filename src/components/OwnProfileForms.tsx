"use client";

// Lili 2026-11-01 (point 11): the user's own display name and password. The monogram and the ZIMS name are shown, not
// edited: the admin changes them (they are on the measurements and in the ZIMS export).
import { useRouter } from "next/navigation";
import { useState } from "react";

function requestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

async function patch(body: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: requestId(), ...body }),
    });
    if (res.ok) return null;
    const b = (await res.json().catch(() => ({}))) as { error?: { message?: string; issues?: { message: string }[] } };
    return b.error?.issues?.[0]?.message ?? b.error?.message ?? "A mentés nem sikerült.";
  } catch {
    return "Nincs kapcsolat a szerverrel.";
  }
}

type Msg = { ok: boolean; text: string } | null;

function Status({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return <span className={msg.ok ? "hint" : "err"} role="status">{msg.text}</span>;
}

export function OwnNameForm({ fullName }: { fullName: string }) {
  const router = useRouter();
  const [name, setName] = useState(fullName);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const changed = name.trim() !== fullName && name.trim().length >= 2;
  return (
    <div className="toolbar" data-testid="own-name">
      <label className="field">
        <span>Megjelenő név</span>
        <input className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
      </label>
      <button
        className="btn"
        type="button"
        disabled={busy || !changed}
        onClick={async () => {
          setBusy(true);
          const err = await patch({ fullName: name.trim() });
          setBusy(false);
          setMsg(err ? { ok: false, text: err } : { ok: true, text: "Név mentve." });
          if (!err) router.refresh();
        }}
      >
        Név mentése
      </button>
      <Status msg={msg} />
    </div>
  );
}

export function OwnPasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = again !== "" && next !== again;
  const ready = current !== "" && next.length >= 10 && next === again;
  return (
    <div data-testid="own-password">
      <div className="form-grid">
        <label className="field">
          <span>Jelenlegi jelszó</span>
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label className="field">
          <span>Új jelszó</span>
          <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        <label className="field">
          <span>Új jelszó még egyszer</span>
          <input className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        </label>
      </div>
      <p className="hint">Legalább 10 karakter. A többi eszközön újra be kell lépni, ezen nem.</p>
      {mismatch && <p className="err">A két új jelszó nem egyezik.</p>}
      <div className="toolbar">
        <button
          className="btn"
          type="button"
          disabled={busy || !ready}
          onClick={async () => {
            setBusy(true);
            const err = await patch({ currentPassword: current, newPassword: next });
            setBusy(false);
            setMsg(err ? { ok: false, text: err } : { ok: true, text: "Jelszó megváltoztatva." });
            if (!err) {
              setCurrent("");
              setNext("");
              setAgain("");
            }
          }}
        >
          Jelszó módosítása
        </button>
        <Status msg={msg} />
      </div>
    </div>
  );
}

/** Lili 2026-11-01 (point 17): the nickname the helper greets with; empty goes back to the given name. */
export function OwnNicknameForm({ nickname }: { nickname: string }) {
  const router = useRouter();
  const [nick, setNick] = useState(nickname);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const changed = nick.trim() !== nickname;
  return (
    <div className="toolbar" data-testid="own-nickname">
      <label className="field">
        <span>Becenév</span>
        <input className="input" value={nick} maxLength={40} onChange={(e) => setNick(e.target.value)} />
      </label>
      <button
        className="btn"
        type="button"
        disabled={busy || !changed}
        onClick={async () => {
          setBusy(true);
          const err = await patch({ nickname: nick.trim() });
          setBusy(false);
          setMsg(err ? { ok: false, text: err } : { ok: true, text: "Becenév mentve." });
          if (!err) router.refresh();
        }}
      >
        Becenév mentése
      </button>
      <Status msg={msg} />
    </div>
  );
}

/**
 * The user's own e-mail address (task e7f9e84d): where the link of a forgotten password goes. Optional; empty removes it.
 */
export function OwnEmailForm({ email }: { email: string }) {
  const router = useRouter();
  const [value, setValue] = useState(email);
  const [current, setCurrent] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const changed = value.trim().toLowerCase() !== email;
  return (
    <div className="toolbar" data-testid="own-email">
      <label className="field">
        <span>E-mail cím</span>
        <input className="input" type="email" autoComplete="email" value={value} maxLength={254} onChange={(e) => setValue(e.target.value)} />
      </label>
      {/* the address is where a reset link goes, so it is guarded like the password (barracuda on #217) */}
      <label className="field">
        <span>Jelenlegi jelszó</span>
        <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <button
        className="btn"
        type="button"
        disabled={busy || !changed || !current}
        onClick={async () => {
          setBusy(true);
          const err = await patch({ email: value.trim(), currentPassword: current });
          setBusy(false);
          setMsg(err ? { ok: false, text: err } : { ok: true, text: value.trim() ? "E-mail cím mentve." : "E-mail cím törölve." });
          if (!err) {
            setCurrent("");
            router.refresh();
          }
        }}
      >
        E-mail cím mentése
      </button>
      <Status msg={msg} />
    </div>
  );
}
