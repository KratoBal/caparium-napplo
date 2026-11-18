// t-20261117-caparium-angol-alap (Lili 2026-11-17): the device's language wins over the user's default, a text with no
// English stays Hungarian, a translation keeps the text's data places
import { describe, expect, it } from "vitest";
import { PARAMETERS } from "@/lib/base-data";
import { EN } from "@/lib/i18n/en";
import { langCookie, parseLang, resolveLang } from "@/lib/i18n/lang";
import { placeholdersOf, translate } from "@/lib/i18n/translate";

describe("resolveLang", () => {
  it("the device's cookie wins; without it the user's default; without both Hungarian; a cookie that is no language is none", () => {
    expect([resolveLang("en", "HU"), resolveLang("hu", "EN"), resolveLang(undefined, "EN"), resolveLang(undefined, null), resolveLang("de", "EN"), parseLang("EN")]).toEqual(["en", "hu", "en", "hu", "en", null]);
  });
  it("the cookie lasts a year and is sent to every path", () => {
    expect(langCookie("en", true)).toBe("nyelv=en; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
  });
});

describe("translate", () => {
  it("English when the dictionary has it, Hungarian when not; the data places filled in both", () => {
    expect(translate("en", "Nyelv")).toBe("Language");
    expect(translate("hu", "Nyelv")).toBe("Nyelv");
    expect(translate("en", "{n} sor mentve.", { n: 3 })).toBe("3 rows saved.");
    expect(translate("en", "{n} ilyen szöveg nincs a szótárban.", { n: 3 })).toBe("3 ilyen szöveg nincs a szótárban.");
    expect(translate("en", "{a} és {b}", { a: 1 })).toBe("1 és {b}");
  });
  it("a text named like an object's member (toString, constructor) is a plain text, in the dictionary and in the data places", () => {
    expect([translate("en", "toString"), translate("en", "constructor"), translate("en", "{toString}", {})]).toEqual(["toString", "constructor", "{toString}"]);
  });
  it("every English text keeps its Hungarian's data places (a {name} lost or added would hide data or show a brace)", () => {
    const broken = Object.entries(EN).filter(([hu, en]) => placeholdersOf(hu).join() !== placeholdersOf(en).join());
    expect(broken).toEqual([]);
  });
});

// Lili 2026-11-18 16:46 UTC (Caparium thread msgs 1572654266085146647, 1572654324851679273, 1572654361535058001; acrobot 56133): in the English view the header reads
// "Shark Nursery" big and "SnAPPs'" (the apostrophe is part of the word) below it, in the place the Hungarian brand stands; the Hungarian view is unchanged. And the removed-feed
// page's header chip key "Kivéve:" is "Removed:" in English, not her table's "Except:" (acrobot: "if nobody objects"). WHAT TURNS THIS RED: a brand text that falls back to Hungarian in the
// English view; the Hungarian view changed; "Except:" back on the chip.
describe("the header's brand and the removed-feed chip, in English", () => {
  it("the English brand is Shark Nursery over SnAPPs', and the Hungarian stays CÁPÁRIUM over nAPPló", () => {
    expect([translate("en", "CÁPÁRIUM"), translate("en", "nAPPló")]).toEqual(["Shark Nursery", "SnAPPs'"]);
    expect([translate("hu", "CÁPÁRIUM"), translate("hu", "nAPPló")]).toEqual(["CÁPÁRIUM", "nAPPló"]);
  });
  it("the removed-feed chip key is Removed: in English", () => {
    expect(translate("en", "Kivéve:")).toBe("Removed:");
  });
});

// barracuda on caparium #262: a measurement's name is data, translated where shown (tr(p.name)); its English comes in only if the
// import reads the name as a key (the guard's MeasurementGrid list). A seeded parameter renamed or added in Hungarian would
// otherwise fall back to Hungarian on the English page, and nothing would say so.
describe("the seeded measurements' names", () => {
  // the names that read the same in English: a symbol or a chemical formula
  const SAME_IN_ENGLISH = ["pH", "ORP", "KH", "Mg", "Ca", "NO3", "PO4"];
  it("each has its English in the dictionary, or is a symbol that reads the same in English", () => {
    const missing = PARAMETERS.map((p) => p.name).filter((name) => !SAME_IN_ENGLISH.includes(name) && !Object.hasOwn(EN, name));
    expect(missing).toEqual([]);
  });
});
