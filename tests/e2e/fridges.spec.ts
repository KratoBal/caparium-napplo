// Lili 2026-11-02 (task caparium-hutok): the fridges' temperature book on the real pages. An admin adds a fridge in Beállítások,
// an aquarist records it on the daily water page under the big pools' table: red already while an out-of-range value is typed,
// red in the saved row; the export page offers the book apart from the water exports. The server rules, the range kept per
// reading, the correction and the files are measured in tests/integration/fridges.test.ts.
import { expect, test, type Page } from "@playwright/test";
import { openAllSettings } from "../support/settings-folds";

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

test("a fridge added in the settings is recorded under the big pools' table; out of range is red", async ({ page, browser }, info) => {
  // a fridge of its own per project and per attempt, so a retry or the other project does not find this one's readings
  const name = `E2E hűtő ${info.project.name} ${info.retry}`;
  await login(page, "teszt.admin");
  await page.goto("/beallitasok");
  await openAllSettings(page);
  const box = page.getByTestId("new-fridge");
  await box.getByLabel("Név").fill(name);
  await box.getByLabel("Minimum (°C)").fill("2");
  await box.getByLabel("Maximum (°C)").fill("8");
  await box.getByRole("button", { name: "Hűtő felvétele" }).click();
  await expect(box.getByRole("status")).toHaveText("Felvéve.");
  await expect(page.getByTestId(`fridge-setting-${name}`)).toBeVisible();

  const aq = await browser.newPage();
  await login(aq, "teszt.akvarista1");
  await aq.goto("/vizmeres?csoport=NAPI_NAGY");
  const card = aq.getByTestId("fridge-card");
  // under the big pools' table
  const gridBox = await aq.locator(".grid-table").first().boundingBox();
  const cardBox = await card.boundingBox();
  expect(cardBox!.y).toBeGreaterThan(gridBox!.y + gridBox!.height - 1);
  const row = card.getByTestId(`fridge-${name}`);
  const temp = row.getByLabel(`${name} hőmérséklete (°C)`);
  await temp.fill("9,5");
  await expect(temp).toHaveAttribute("aria-invalid", "true");
  await row.getByLabel(`${name}: leolvasztás`).check();
  await row.getByLabel(`${name}: megjegyzés`).fill("ajtó nyitva maradt");
  await row.getByRole("button", { name: "Mentés" }).click();
  await expect(row.getByRole("status")).toHaveText("Mentve; a hőmérséklet a tartományon kívül van.");
  const saved = card.getByTestId("fridge-reading").filter({ hasText: "ajtó nyitva maradt" });
  await expect(saved).toHaveCount(1);
  await expect(saved.locator("td.fridge-out")).toHaveText("9,5 °C");
  await expect(saved).toContainText("Leolvasztás");

  // the small tanks' table has no fridge card
  await aq.goto("/vizmeres?csoport=NAPI_KIS");
  await expect(aq.getByTestId("fridge-card")).toHaveCount(0);

  await aq.goto("/export");
  await expect(aq.getByTestId("fridge-export").getByRole("button", { name: /^Excel/ })).toBeVisible();
  await expect(aq.getByTestId("fridge-export").getByRole("button", { name: /^PDF/ })).toBeVisible();
  await aq.close();
});
