// Lili 2026-10-31 (task caparium-webapp-ikon, card 135b457e): the app can be put on a phone's home screen with its logo and opens full screen. The
// manifest and the icons are served, and the page names them (the manifest link, the iOS touch icon, the iOS meta tags). Read-only; the files' sizes and
// their having no transparent corner are measured in tests/unit/app-icons.test.ts.
import { expect, test } from "@playwright/test";

test("the login page names the manifest, the touch icon and the iOS full-screen tags", async ({ page }) => {
  await page.goto("/belepes");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", /\/icons\/apple-touch-icon\.png/);
  // Next 16 renders appleWebApp.capable as mobile-web-app-capable (measured in CI, 2026-10-31); layout.tsx adds the apple- name for iOS Safari
  await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "Caparium");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", /^#[0-9a-f]{6}$/);
});

test("the manifest and its icons are served, without a login", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.status()).toBe(200);
  const m = (await res.json()) as { display: string; short_name: string; icons: { src: string; sizes: string; purpose: string }[] };
  expect([m.display, m.short_name]).toEqual(["standalone", "Caparium"]);
  expect(m.icons.some((i) => i.purpose === "maskable")).toBe(true);
  for (const path of [...m.icons.map((i) => i.src), "/icons/apple-touch-icon.png", "/icons/icon-32.png"]) {
    const r = await request.get(path);
    expect(r.status(), path).toBe(200);
    expect(r.headers()["content-type"], path).toContain("image/png");
    expect((await r.body()).subarray(1, 4).toString(), path).toBe("PNG");
  }
});
