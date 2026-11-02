// Lili 2026-11-01 (acrobot 39851): the main views on an Android phone, Chrome on a Pixel 7 (the "android" project in
// playwright.config.ts: 412x915, touch, mobile user agent). Taps, not clicks. The menu's drop-downs, the daily and the weekly table,
// Beállítások; on each page nothing runs off the screen sideways.
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_TEST_PASSWORD ?? "";

async function login(page: Page, loginId: string) {
  await page.goto("/belepes");
  await page.getByLabel("Felhasználónév").fill(loginId);
  await page.getByLabel("Jelszó").fill(PASSWORD);
  await page.getByRole("button", { name: "Bejelentkezés" }).tap();
  await expect(page.getByRole("heading", { name: "Jó munkát!" })).toBeVisible();
}

const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.beforeAll(() => {
  if (!PASSWORD) throw new Error("SEED_TEST_PASSWORD must be set for the e2e run");
});

test("the menu's drop-downs open on a tap and lead to their pages", async ({ page }) => {
  await login(page, "teszt.akvarista1");
  const nav = page.getByRole("navigation", { name: "Fő navigáció" });
  await nav.getByRole("button", { name: /Vízmérés/ }).tap();
  const water = page.getByRole("menu", { name: "Vízmérés" });
  await expect(water.getByRole("menuitem")).toHaveCount(4);
  await water.getByRole("menuitem", { name: /Heti vízmérés/ }).tap();
  await expect(page).toHaveURL(/\/heti$/);
  await nav.getByRole("button", { name: /Takarmányozás/ }).tap();
  const feed = page.getByRole("menu", { name: "Takarmányozás" });
  await expect(feed.getByRole("menuitem")).toHaveCount(7);
  await feed.getByRole("menuitem", { name: /Napi etetés/ }).tap();
  await expect(page).toHaveURL(/\/etetes$/);
  expect(await noSideways(page)).toBeLessThanOrEqual(0);
});

test("the daily table: a pool's card opens on a tap, a value saves", async ({ page }) => {
  // an admin on a past day of its own, so the other projects' days are not touched; the reason the past day asks for is given
  page.on("dialog", (d) => void d.accept("android próba"));
  await login(page, "teszt.admin");
  await page.goto("/vizmeres?csoport=NAPI_NAGY&nap=2026-02-18");
  expect(await noSideways(page)).toBeLessThanOrEqual(0);
  await page.getByTestId("row-Karantén").getByRole("button", { name: "Karantén" }).tap();
  const cell = page.getByTestId("cell-Karantén-Hőmérséklet");
  await cell.tap();
  await cell.fill("25,5");
  await page.getByTestId("save-all").tap();
  await expect(page.getByTestId("banner")).toHaveText("Minden érték mentve.");
  await page.reload();
  await page.getByTestId("row-Karantén").getByRole("button", { name: "Karantén" }).tap();
  await expect(page.getByTestId("cell-Karantén-Hőmérséklet")).toHaveValue("25,5");
});

test("the weekly table: every pool's card, its fields inside the screen", async ({ page }) => {
  await login(page, "teszt.akvarista1");
  await page.goto("/heti");
  await expect(page.getByTestId("row-Nagymedence")).toBeVisible();
  expect(await noSideways(page)).toBeLessThanOrEqual(0);
  for (const pool of ["Nagymedence", "Korallos"]) {
    const row = page.getByTestId(`row-${pool}`);
    await row.getByRole("button", { name: pool, exact: true }).tap();
    const field = page.getByTestId(`cell-${pool}-KH`);
    await expect(field).toBeVisible();
    const box = (await field.boundingBox())!;
    expect(box.x + box.width, pool).toBeLessThanOrEqual(412);
    expect(box.height, pool).toBeGreaterThanOrEqual(44);
  }
});

test("Beállítások: the modules closed, one opens on a tap, nothing runs off the screen", async ({ page }) => {
  await login(page, "teszt.admin");
  await page.goto("/beallitasok");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("details.settings-fold[open]")).toHaveCount(0);
  await page.locator('details[data-fold="medencek"] > summary').tap();
  await expect(page.locator('details[data-fold="medencek"]')).toHaveAttribute("open", "");
  await expect(page.getByTestId("pools-table")).toBeVisible();
  expect(await noSideways(page)).toBeLessThanOrEqual(0);
});
