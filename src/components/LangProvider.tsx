"use client";

import { createContext, useContext } from "react";
import type { Lang } from "@/lib/i18n/lang";
import { translate, type TrVars } from "@/lib/i18n/translate";

/**
 * The page's language for the client components (lib/i18n/lang.ts): the server reads the device's cookie and hands it
 * down here, so a client component speaks the same language as the server-rendered text around it, from the first render.
 */
const LangContext = createContext<Lang>("hu");

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LangContext);
}

/** The translator of the page's language: tr("Mentés"), tr("{n} sor mentve.", { n }). */
export function useTr(): (text: string, vars?: TrVars) => string {
  const lang = useContext(LangContext);
  return (text, vars) => translate(lang, text, vars);
}
