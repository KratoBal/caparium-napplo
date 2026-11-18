// MEASUREMENT BRANCH ONLY (card 94f43c2e), not for main. The page's refresh is held back 1.5 s, so the race the flaky
// test met by chance happens every time. A: the old waits (networkidle, then the next click) -> the stale refresh of the
// previous save puts the previous choice back over the new one: the new choice is seen UNCHECKED after its click.
// B: the new waits (each choice waits for its own refresh) -> the new choice is never seen unchecked after its click.
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_TEST_PASSWORD ?? "";
const M = "Merüléses etetés (M)";
const F = "Felszíni etetés (F)";
const K = "Koplalónap (K)";

async function login(page: Page) {
  await page.goto("/belepes");
  await page.getByLabel("Felhasználónév").fill("teszt.akvarista1");
  await page.getByLabel("Jelszó").fill(PASSWORD);
  await page.getByRole("button", { name: "Bejelentkezés" }).click();
  await expect(page.getByRole("heading", { name: "Jó munkát!" })).toBeVisible();
}

const isRefresh = (url: string, headers: Record<string, string>) =>
  new URL(url).pathname === "/evesi-naplo" && headers["rsc"] === "1" && !headers["next-router-prefetch"];

async function slowRefresh(page: Page) {
  // the RESPONSE is held back, not the request: a held request reaches the server after the next save and answers the new choice
  // (the first run of this branch, 167e7ec8: A saw no revert for that reason)
  await page.route("**/evesi-naplo*", async (route) => {
    if (!(route.request().method() === "GET" && isRefresh(route.request().url(), route.request().headers()))) return route.continue();
    const response = await route.fetch();
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ response });
  });
}

/** Records, every 10 ms, whether the radio of `label` is checked; read back with seen(). */
async function watch(page: Page, label: string) {
  await page.evaluate((text) => {
    const w = window as unknown as { __seen: boolean[] };
    w.__seen = [];
    const input = [...document.querySelectorAll('[data-testid="feeding-mode"] label')].find((l) => l.textContent?.includes(text))!.querySelector("input")!;
    setInterval(() => w.__seen.push(input.checked), 10);
  }, label);
}
const seen = (page: Page) => page.evaluate(() => (window as unknown as { __seen: boolean[] }).__seen);

async function start(page: Page) {
  await login(page);
  await slowRefresh(page);
  await page.goto("/evesi-naplo");
  await expect(page.locator("html[data-hydrated]")).toHaveCount(1);
  const box = page.getByTestId("feeding-mode");
  // a known start that differs from M, so the first click is a change
  if (!(await box.getByLabel(K).isChecked())) {
    const saved = page.waitForResponse((r) => r.url().endsWith("/api/feeding/feeding-mode") && r.request().method() === "POST");
    await box.getByLabel(K).click();
    await saved;
  }
  await page.reload();
  await expect(page.locator("html[data-hydrated]")).toHaveCount(1);
  await expect(box.getByLabel(K)).toBeChecked();
  return box;
}

test("MERES A: the old waits, a held-back refresh puts the previous choice back over the next one", async ({ page }) => {
  const box = await start(page);
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/feeding/feeding-mode") && r.request().method() === "POST");
  await page.waitForLoadState("networkidle");
  await box.getByLabel(M).check();
  await saved;
  await expect(box).toContainText("A nap etetése mentve.");
  await page.waitForLoadState("networkidle");
  await expect(box.getByLabel(F)).toBeEnabled();
  await box.getByLabel(F).click();
  await watch(page, F);
  await page.waitForTimeout(4000);
  const s = await seen(page);
  console.log(`MERES A: ${s.length} samples, unchecked ${s.filter((x) => !x).length}`);
  expect(s.some((x) => !x)).toBe(true);
});

test("MERES B: the new waits, the next choice is never put back", async ({ page }) => {
  const box = await start(page);
  const choose = async (label: string) => {
    const radio = box.getByLabel(label);
    await expect(radio).toBeEnabled();
    const saved = page.waitForResponse((r) => r.url().endsWith("/api/feeding/feeding-mode") && r.request().method() === "POST");
    const refreshed = page.waitForResponse((r) => r.request().method() === "GET" && isRefresh(r.url(), r.request().headers()));
    await radio.click();
    expect((await saved).ok()).toBe(true);
    await refreshed;
    await expect(radio).toBeChecked();
  };
  await choose(M);
  await expect(box.getByLabel(F)).toBeEnabled();
  await box.getByLabel(F).click();
  await watch(page, F);
  await page.waitForTimeout(4000);
  const s = await seen(page);
  console.log(`MERES B: ${s.length} samples, unchecked ${s.filter((x) => !x).length}`);
  expect(s.length).toBeGreaterThan(100);
  expect(s.every((x) => x)).toBe(true);
});
