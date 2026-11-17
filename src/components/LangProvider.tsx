"use client";

import { createContext, useCallback, useContext, useEffect } from "react";
import type { Lang } from "@/lib/i18n/lang";
import { translate, type TrVars } from "@/lib/i18n/translate";

/**
 * The page's language for the client components (lib/i18n/lang.ts): the server reads the device's cookie and hands it
 * down here, so a client component speaks the same language as the server-rendered text around it, from the first render.
 */
const LangContext = createContext<Lang>("hu");

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  // The page answers clicks from here on (card 51426546): effects run children first, so when this one runs every component
  // of the page has hydrated and run its mount effects. An end-to-end test that clicks right after a page load waits for it;
  // before it, a click can land on markup React has not taken over yet, or be undone by a mount effect. It goes with its page
  // (barracuda on #242): on a client-side navigation <html> stays, and the previous page's mark would let a test through early.
  useEffect(() => {
    document.documentElement.dataset.hydrated = "1";
    return () => {
      delete document.documentElement.dataset.hydrated;
    };
  }, []);
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LangContext);
}

/**
 * The translator of the page's language: tr("Mentés"), tr("{n} sor mentve.", { n }). The same function while the language
 * stays, so a useCallback or useEffect may list it without running again on every render.
 */
export function useTr(): (text: string, vars?: TrVars) => string {
  const lang = useContext(LangContext);
  return useCallback((text: string, vars?: TrVars) => translate(lang, text, vars), [lang]);
}
