// The web app's icons and manifest (Lili 2026-10-31, task caparium-webapp-ikon, card 135b457e): the files are what the manifest says they are, and
// no icon has a transparent corner (iOS and Android round an icon themselves: a transparent corner would show as a white or black wedge).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { THEME_COLOR } from "@/lib/app-theme";

const png = (path: string) => {
  const b = readFileSync(new URL(`../../public${path}`, import.meta.url));
  expect([...b.subarray(0, 8)], `${path} is a PNG`).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // IHDR: width, height, bit depth, colour type (2 = RGB, 6 = RGB with alpha)
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colourType: b[25]! };
};

describe("the web app's manifest", () => {
  const m = manifest();

  it("opens full screen under the short name Caparium, in the teal of the logo", () => {
    expect(m.display).toBe("standalone");
    expect(m.short_name).toBe("Caparium");
    expect(m.name).toBe("Cápárium nAPPló");
    expect(m.start_url).toBe("/");
    expect(m.theme_color).toBe(THEME_COLOR);
    expect(THEME_COLOR).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("names an icon of 192 and of 512 and a maskable one, and each file is the size it says", () => {
    const icons = m.icons ?? [];
    expect(icons.map((i) => [i.sizes, i.purpose])).toEqual([
      ["192x192", "any"],
      ["512x512", "any"],
      ["512x512", "maskable"],
    ]);
    for (const i of icons) {
      const [w, h] = (i.sizes as string).split("x").map(Number);
      const p = png(i.src);
      expect([p.width, p.height], i.src).toEqual([w, h]);
    }
  });
});

describe("the icon files", () => {
  it.each([
    ["/icons/apple-touch-icon.png", 180],
    ["/icons/icon-192.png", 192],
    ["/icons/icon-512.png", 512],
    ["/icons/maskable-512.png", 512],
    ["/icons/icon-32.png", 32],
  ])("%s is %d px square and has no alpha channel, so no transparent corner", (path, size) => {
    const p = png(path);
    expect([p.width, p.height]).toEqual([size, size]);
    expect(p.colourType, "RGB, not RGBA").toBe(2);
  });
});
