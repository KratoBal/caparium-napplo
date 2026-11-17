// THE DICTIONARY'S KEY IS THE HUNGARIAN TEXT ITSELF (task t-20261117-caparium-angol-alap). No invented keys: the
// Hungarian stays the source, the English comes from Lili's sheet (exchange/caparium/forditas-napi-modulok-2026-11-17.xlsx),
// and a text with no English yet is shown in Hungarian: nothing breaks, nothing reads as a key name.
// A text with data in it names the data in braces, the same in both languages: tr("{n} sor mentve.", { n: 3 }).
import { EN } from "./en";
import type { Lang } from "./lang";

export type TrVars = Record<string, string | number>;

function fill(text: string, vars?: TrVars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** The text in the language, its {name} places filled; Hungarian when there is no English for it. */
export function translate(lang: Lang, text: string, vars?: TrVars): string {
  const english = lang === "en" ? EN[text] : undefined;
  return fill(english && english.trim() ? english : text, vars);
}

/** The placeholders of a text, sorted: a translation must keep the same set, or data would vanish or show as {name}. */
export function placeholdersOf(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))].sort();
}
