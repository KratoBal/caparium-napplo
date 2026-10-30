// Lili 2026-10-30 19:34 UTC (msg 1565811224229453956, card f5f97479, second point): "csak érvényteleníteni lehet, azt nem ha elírta, az értéket". The
// dosing log's row has a "Javítás" beside the "Érvénytelenítés": the amount, the unit, the chemical and the pool can be corrected, the row keeps its
// place. The server rule and the stock are measured in tests/integration/dosing.test.ts; here it is the real page.
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

test("a dosing's amount is corrected in its log row, not only invalidated", async ({ page }, info) => {
  await login(page, "teszt.akvarista1");
  await page.goto("/adagolas");
  // an amount of its own per project and per attempt (a retry must not find the first attempt's uncorrected row), so the row is found among the others
  const before = (info.project.name === "tablet" ? 371 : 373) + 10 * info.retry;
  const after = before + 1;
  const form = page.getByTestId("dosing-form");
  await form.getByLabel("Medence", { exact: true }).selectOption({ label: "Sózó" });
  await form.getByLabel("Szer", { exact: true }).selectOption({ label: "Teszt só" });
  await form.getByLabel("Mennyiség", { exact: true }).fill(String(before));
  await form.getByLabel("Egység", { exact: true }).selectOption({ label: "g" });
  await form.getByRole("button", { name: "+ Adagolás mentése" }).click();
  await expect(form.getByRole("status")).toHaveText("Adagolás mentve.");
  const log = page.getByTestId("dosing-log");
  const row = log.getByRole("row").filter({ hasText: `${before} g` }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Javítás" }).click();
  const editor = page.locator('[data-testid^="dosing-edit-"]');
  await editor.getByLabel("Mennyiség (javítás)").fill(String(after));
  await editor.getByRole("button", { name: "Mentés" }).click();
  await expect(log.getByRole("row").filter({ hasText: `${after} g` }).first()).toBeVisible();
  await expect(log.getByRole("row").filter({ hasText: `${before} g` }).filter({ hasNotText: "érvénytelenítve" })).toHaveCount(0);
  // the corrected row still has both buttons
  const corrected = log.getByRole("row").filter({ hasText: `${after} g` }).first();
  await expect(corrected.getByRole("button", { name: "Javítás" })).toBeVisible();
  await expect(corrected.getByRole("button", { name: "Érvénytelenítés" })).toBeVisible();
});
