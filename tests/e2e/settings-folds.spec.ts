// Lili 2026-11-01 (point 15): every Beállítások module starts closed and opens only on a click; nothing stays open for the next visit.
// A link to a module's anchor (the ZIMS warnings' "/beallitasok#felhasznalok") opens that one module.
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_TEST_PASSWORD ?? "";

async function login(page: Page, loginId: string) {
  await page.goto("/belepes");
  await page.getByLabel("Felhasználónév").fill(loginId);
  await page.getByLabel("Jelszó").fill(PASSWORD);
  await page.getByRole("button", { name: "Bejelentkezés" }).click();
  await expect(page.getByRole("heading", { name: "Jó munkát!" })).toBeVisible();
}

test.beforeAll(() => {
  if (!PASSWORD) throw new Error("SEED_TEST_PASSWORD must be set for the e2e run");
});

const openFolds = (page: Page) => page.locator("details.settings-fold[open]");

test("every settings module starts closed, opens on a click, and is closed again on the next visit", async ({ page }) => {
  await login(page, "teszt.admin");
  await page.goto("/beallitasok");
  const folds = page.locator("details.settings-fold");
  // the control: the page has its modules (an empty page would pass "none open")
  expect(await folds.count()).toBeGreaterThan(5);
  await page.waitForLoadState("networkidle");
  await expect(openFolds(page)).toHaveCount(0);
  await expect(page.getByTestId("new-user")).toBeHidden();
  await page.locator('details[data-fold="felhasznalok"] > summary').click();
  await expect(openFolds(page)).toHaveCount(1);
  await expect(page.getByTestId("new-user")).toBeVisible();
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(openFolds(page)).toHaveCount(0);
});

test("the users anchor opens the users module, and only that", async ({ page }) => {
  await login(page, "teszt.admin");
  await page.goto("/beallitasok#felhasznalok");
  await expect(page.getByTestId("new-user")).toBeVisible();
  await expect(openFolds(page)).toHaveCount(1);
});
