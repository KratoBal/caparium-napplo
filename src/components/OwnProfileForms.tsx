"use client";

// Lili 2026-11-01 (point 11): the user's own display name and password. The monogram and the ZIMS name are shown, not
// edited: the admin changes them (they are on the measurements and in the ZIMS export).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTr } from "./LangProvider";
import type { TrVars } from "@/lib/i18n/translate";

type Tr = (text: string, vars?: TrVars) => string;

function requestId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

async function patch(body: Record<string, unknown>, tr: Tr): Promise<string | null> {
  try {
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: requestId(), ...body }),
    });
    if (res.ok) return null;
    const b = (await res.json().catch(() => ({}))) as { error?: { message?: string; issues?: { message: string }[] } };
    return b.error?.issues?.[0]?.message ?? b.error?.message ?? tr("A mentés nem sikerült.");
  } catch {
    return tr("Nincs kapcsolat a szerverrel.");
  }
}

type Msg = { ok: boolean; text: string } | null;

function Status({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return <span className={msg.ok ? "hint" : "err"} role="status">{msg.text}</span>;
}

export function OwnNameForm({ fullName }: { fullName: string }) {
  const tr = useTr();
  const router = useRouter();
  const [name, setName] = useState(fullName);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const changed = name.trim() !== fullName && name.trim().length >= 2;
  return (
    <div className="toolbar" data-testid="own-name">
      <label className="field">
        <span>{tr("Megjelenő név")}</span>
        <input className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
      </label>
      <button
        className="btn"
        type="button"
        disabled={busy || !changed}
        onClick={async () => {
          setBusy(true);
          const err = await patch({ fullName: name.trim() }, tr);
          setBusy(false);
          setMsg(err ? { ok: false, text: err } : { ok: true, text: tr("Név mentve.") });
          if (!err) router.refresh();
        }}
      >
        {tr("Név mentése")}
      </button>
      <Status msg={msg} />
    </div>
  );
}

export function OwnPasswordForm() {
  const tr = useTr();
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
          <span>{tr("Jelenlegi jelszó")}</span>
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label className="field">
          <span>{tr("Új jelszó")}</span>
          <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        <label className="field">
          <span>{tr("Új jelszó még egyszer")}</span>
          <input className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        </label>
      </div>
      <p className="hint">{tr("Legalább 10 karakter. A többi eszközön újra be kell lépni, ezen nem.")}</p>
      {mismatch && <p className="err">{tr("A két új jelszó nem egyezik.")}</p>}
      <div className="toolbar">
        <button
          className="btn"
          type="button"
          disabled={busy || !ready}
          onClick={async () => {
            setBusy(true);
            const err = await patch({ currentPassword: current, newPassword: next }, tr);
            setBusy(false);
            setMsg(err ? { ok: false, text: err } : { ok: true, text: tr("Jelszó megváltoztatva.") });
            if (!err) {
              setCurrent("");
              setNext("");
              setAgain("");
            }
          }}
        >
          {tr("Jelszó módosítása")}
        </button>
        <Status msg={msg} />
      </div>
    </div>
  );
}

/** Lili 2026-11-01 (point 17): the nickname the helper greets with; empty goes back to the given name. */
export function OwnNicknameForm({ nickname }: { nickname: string }) {
  const tr = useTr();
  const router = useRouter();
  const [nick, setNick] = useState(nickname);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const changed = nick.trim() !== nickname;
  return (
    <div className="toolbar" data-testid="own-nickname">
      <label className="field">
        <span>{tr("Becenév")}</span>
        <input className="input" value={nick} maxLength={40} onChange={(e) => setNick(e.target.value)} />
      </label>
      <button
        className="btn"
        type="button"
        disabled={busy || !changed}
        onClick={async () => {
          setBusy(true);
          const err = await patch({ nickname: nick.trim() }, tr);
          setBusy(false);
          setMsg(err ? { ok: false, text: err } : { ok: true, text: tr("Becenév mentve.") });
          if (!err) router.refresh();
        }}
      >
        {tr("Becenév mentése")}
      </button>
      <Status msg={msg} />
    </div>
  );
}

/**
 * The user's own e-mail address (task e7f9e84d): where the link of a forgotten password goes. Optional; empty removes it.
 */
export function OwnEmailForm({ email }: { email: string }) {
  const tr = useTr();
  const router = useRouter();
  const [value, setValue] = useState(email);
  const [current, setCurrent] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const changed = value.trim().toLowerCase() !== email;
  return (
    <div className="toolbar" data-testid="own-email">
      <label className="field">
        <span>{tr("E-mail cím")}</span>
        <input className="input" type="email" autoComplete="email" value={value} maxLength={254} onChange={(e) => setValue(e.target.value)} />
      </label>
      {/* the address is where a reset link goes, so it is guarded like the password (barracuda on #217) */}
      <label className="field">
        <span>{tr("Jelenlegi jelszó")}</span>
        <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <button
        className="btn"
        type="button"
        disabled={busy || !changed || !current}
        onClick={async () => {
          setBusy(true);
          const err = await patch({ email: value.trim(), currentPassword: current }, tr);
          setBusy(false);
          setMsg(err ? { ok: false, text: err } : { ok: true, text: value.trim() ? tr("E-mail cím mentve.") : tr("E-mail cím törölve.") });
          if (!err) {
            setCurrent("");
            router.refresh();
          }
        }}
      >
        {tr("E-mail cím mentése")}
      </button>
      <Status msg={msg} />
    </div>
  );
}

/**
 * The screens' default language (t-20261117-caparium-angol-alap). It is only the default: a device that has chosen with
 * the header's HU/EN switch keeps its own; a device with no choice yet gets this one at the next login.
 */
export function OwnLanguageForm({ language }: { language: "HU" | "EN" }) {
  const tr = useTr();
  const router = useRouter();
  const [value, setValue] = useState(language);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="toolbar" data-testid="own-language">
      <label className="field">
        <span>{tr("Alapértelmezett nyelv")}</span>
        <select className="input" value={value} onChange={(e) => setValue(e.target.value as "HU" | "EN")}>
          {/* each language by its own name, in both views */}
          <option value="HU">magyar</option>
          <option value="EN">English</option>
        </select>
      </label>
      <button
        className="btn"
        type="button"
        disabled={busy || value === language}
        onClick={async () => {
          setBusy(true);
          const err = await patch({ language: value }, tr);
          setBusy(false);
          setMsg(err ? { ok: false, text: err } : { ok: true, text: tr("Nyelv mentve.") });
          if (!err) router.refresh();
        }}
      >
        {tr("Nyelv mentése")}
      </button>
      <Status msg={msg} />
    </div>
  );
}
