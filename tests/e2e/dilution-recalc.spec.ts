// acrobot 39888: the old diluted rows' card was on Beállítások; it left the screen on Lili's request (caparium-egyszerusites).
// The run itself stays the integration test's (tests/integration/dilution-recalc.test.ts).
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

test("Beállítások: the old diluted rows' card is gone (Lili 2026-11-02), the API stays", async ({ page }) => {
  await login(page, "teszt.admin");
  await page.goto("/beallitasok");
  await expect(page.getByRole("heading", { name: "Medencék" })).toBeVisible();
  await expect(page.locator('details[data-fold="regi-higitas"]')).toHaveCount(0);
  await expect(page.getByTestId("dilution-recalc")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Régi hígított sorok (próba)" })).toHaveCount(0);
});
