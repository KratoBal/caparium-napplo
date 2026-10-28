// The feeding sheet's row colours (Lili 2026-10-28 13:49 UTC: "kontraszt maradjon olvasható"). WHAT TURNS RED: a
// shade the ink is hard to read on (under 7:1, WCAG AAA for body text), two shades alike, the highlighted row's ink or
// the header's tint on the palette, an unknown key read as a colour.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SHEET_COLORS, sheetColorBg } from "@/lib/sheet-color-palette";

const css = readFileSync("src/app/globals.css", "utf8");
const token = (name: string) => new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i").exec(css)?.[1] ?? "";
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe("the feeding sheet's row colours", () => {
  it("the ink stays readable on every shade, and every shade is told from the others and from the sheet's own", () => {
    const ink = token("--c-ink");
    const tint = token("--c-primary-soft");
    expect([ink, tint].every((h) => /^#[0-9a-f]{6}$/i.test(h))).toBe(true);
    for (const c of SHEET_COLORS) {
      expect(contrast(c.bg, ink), `${c.key} ${c.bg}`).toBeGreaterThanOrEqual(7);
      expect(c.bg.toLowerCase()).not.toBe(tint.toLowerCase());
    }
    expect(new Set(SHEET_COLORS.map((c) => c.key)).size).toBe(SHEET_COLORS.length);
    // two shades alike would be one colour to the eye: no two the same, nor closer than 0.05 in lightness and channel together
    for (const [i, x] of SHEET_COLORS.entries())
      for (const y of SHEET_COLORS.slice(i + 1)) expect(x.bg === y.bg || Math.abs(luminance(x.bg) - luminance(y.bg)) + hueGap(x.bg, y.bg) < 0.05, `${x.key} ${y.key}`).toBe(false);
  });

  it("no colour, or a key no longer on the palette, is no background", () => {
    expect(sheetColorBg(null)).toBeNull();
    expect(sheetColorBg("")).toBeNull();
    expect(sheetColorBg("BLACK")).toBeNull();
    expect(sheetColorBg("GREEN")).toBe(SHEET_COLORS[0].bg);
  });
});

/** How far apart two shades are in hue terms: the largest channel difference, 0..1. */
function hueGap(a: string, b: string) {
  return Math.max(...[1, 3, 5].map((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) / 255));
}
