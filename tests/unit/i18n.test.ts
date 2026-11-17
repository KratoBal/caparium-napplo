// t-20261117-caparium-angol-alap (Lili 2026-11-17): the device's language wins over the user's default, a text with no
// English stays Hungarian, a translation keeps the text's data places
import { describe, expect, it } from "vitest";
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
    expect(translate("en", "{n} sor mentve.", { n: 3 })).toBe("3 sor mentve.");
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
