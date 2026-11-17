"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { langCookie, LANGS, type Lang } from "@/lib/i18n/lang";
import { useLang, useTr } from "./LangProvider";

/**
 * HU / EN in the header (Lili 2026-11-17, acrobot 54635): one account serves a Hungarian colleague and a foreign student
 * in turn, so the language is the device's, switched in one tap and remembered in a cookie; the page reloads its server
 * text in the new language.
 */
export function LangSwitch({ inHeader = false }: { inHeader?: boolean }) {
  const lang = useLang();
  const tr = useTr();
  const router = useRouter();
  const [pending, start] = useTransition();
  function choose(next: Lang) {
    if (next === lang) return;
    document.cookie = langCookie(next, window.location.protocol === "https:");
    start(() => router.refresh());
  }
  return (
    // in a logged-in header the switch is one of the things a phone moves into the profile panel (globals.css), as the helper's switch
    <span className={inHeader ? "lang-switch lang-switch-header" : "lang-switch"} role="group" aria-label={tr("Nyelv")} data-testid="lang-switch">
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          className={l === lang ? "lang-on" : undefined}
          aria-pressed={l === lang}
          aria-label={tr(l === "hu" ? "Magyar nyelv" : "Angol nyelv")}
          disabled={pending}
          onClick={() => choose(l)}
          data-testid={`lang-${l}`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </span>
  );
}
