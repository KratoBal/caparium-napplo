// Lili 2026-10-30 18:58 UTC (msg 1565802152033521714, task caparium-heti-cim): the weekly measurement page's card is "Heti paraméterek", the
// daily one stays "Napi paraméterek". Read-only: the two pages are only loaded.
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

test("the weekly measurement card is titled Heti paraméterek, the daily one Napi paraméterek", async ({ page }) => {
  await login(page, "teszt.akvarista1");
  await page.goto("/heti");
  await expect(page.getByRole("heading", { name: /^Heti paraméterek/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Napi paraméterek/ })).toHaveCount(0);
  await page.goto("/vizmeres");
  await expect(page.getByRole("heading", { name: /^Napi paraméterek/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Heti paraméterek/ })).toHaveCount(0);
});
