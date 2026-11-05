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

// Lili 2026-11-03 17:37 UTC (her iPhone photos): less dead space in the head on the phone. The three picture tiles share
// one row; the day picker and the save button are one row from the left edge, the save button beside the jump button.
// The same on the weekly page and on the fridges' page (no save button there).
for (const path of ["/vizmeres?csoport=NAPI_NAGY", "/heti", "/vizmeres/hutok"]) {
  test(`${path}: the head on the phone, tiles in one row, the day and the save button in one row from the left`, async ({ page }) => {
    await login(page, "teszt.akvarista1");
    await page.goto(path);
    const box = async (l: ReturnType<Page["getByTestId"]>) => (await l.boundingBox())!;
    const tiles = page.getByRole("tablist", { name: "Mérési csoport" }).getByRole("tab");
    const tops = await Promise.all((await tiles.all()).map(async (t) => (await t.boundingBox())!.y));
    expect(tops.length).toBeGreaterThan(0);
    expect(Math.max(...tops) - Math.min(...tops), "the tiles in one row").toBeLessThan(2);
    const jump = await box(page.getByRole("button", { name: "Ugrás" }));
    const date = await box(page.locator('input[name="nap"]'));
    const actions = await box(page.locator(".water-head-actions"));
    expect(date.x - actions.x, "the day picker starts at the left edge").toBeLessThan(2);
    expect(Math.abs(date.y + date.height - (jump.y + jump.height)), "the date and Ugrás in one row").toBeLessThan(2);
    if (!path.includes("hutok")) {
      const save = await box(page.getByTestId("save-all"));
      expect(Math.abs(save.y + save.height - (jump.y + jump.height)), "the save button beside Ugrás").toBeLessThan(2);
      expect(save.x + save.width, "the save button inside the screen").toBeLessThanOrEqual(page.viewportSize()!.width);
    }
    expect(await noSideways(page)).toBeLessThanOrEqual(0);
  });
}

// Lili's iPhone photos (2026-11-03, acrobot 41478): scrolling, the 100 px helper covered the last fields. The page keeps
// room under its last element for the figure, and while a field of the page is being filled in the helper fades and lets
// taps through. Its size stays (Balázs asked for the larger one).
for (const path of ["/vizmeres?csoport=NAPI_NAGY", "/adagolas"]) {
  test(`${path}: the last element scrolls clear of the helper; a focused field makes it step back`, async ({ page }) => {
    await login(page, "teszt.akvarista1");
    await page.goto(path);
    const figure = page.locator(".helper-figure");
    await expect(figure).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const lastBottom = await page.evaluate(() => {
      const last = document.querySelector("main")?.lastElementChild?.getBoundingClientRect();
      return last ? last.bottom : 0;
    });
    const figureTop = (await figure.boundingBox())!.y;
    // at least 24 px clear: with the old 120 px room the last element ended 4 px above the figure (measured on a Pixel 7),
    // and on an iPhone the Safari bar and the figure's name take more than that
    expect(lastBottom, "the page's last element ends at least 24 px above the helper").toBeLessThanOrEqual(figureTop - 24);
    const helper = page.getByTestId("helper");
    expect(Number(await helper.evaluate((el) => getComputedStyle(el).opacity))).toBeGreaterThan(0.9);
    await page.locator("main").locator("input:not([type=hidden]):not([type=checkbox]), select").first().focus();
    await expect.poll(async () => Number(await helper.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(0.5);
    expect(await figure.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
  });
}

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
