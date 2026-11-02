// acrobot 39888: the old diluted rows' card on Beállítások. The dry run answers; the run itself is the integration test's
// (tests/integration/dilution-recalc.test.ts), here nothing is written.
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

test("Beállítások: the old diluted rows' dry run says how many there are", async ({ page }) => {
  await login(page, "teszt.admin");
  await page.goto("/beallitasok");
  await page.locator('details[data-fold="regi-higitas"] > summary').click();
  const card = page.getByTestId("dilution-recalc");
  await card.getByRole("button", { name: "Régi hígított sorok (próba)" }).click();
  await expect(card.getByTestId("dilution-recalc-count")).toHaveText(/^(Nincs átszámolandó sor\.|\d+ átszámolandó sor\.)/);
});
