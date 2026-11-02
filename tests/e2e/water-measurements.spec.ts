// Lili 2026-11-02 09:36-09:40 UTC (acrobot 39956): the Vízmérések card. One order everywhere: a swap on the card shows in the
// daily table's columns, and is put back. The order is global, so one project only does it (the other would race it).
import { expect, test, type Page } from "@playwright/test";
import { openAllSettings, openMeasurement } from "../support/settings-folds";

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

const columns = async (page: Page) => (await page.locator(".grid-table thead th").allInnerTexts()).slice(1).map((t) => t.split(" · ")[0].trim());

test("the card lists the measurements; a measurement opens with its references, conversion and dilution", async ({ page }) => {
  await login(page, "teszt.admin");
  await page.goto("/beallitasok");
  await openAllSettings(page);
  const list = page.getByTestId("water-measurements");
  for (const name of ["Sűrűség", "pH", "Hőmérséklet", "NO3"]) await expect(list.getByRole("row").filter({ hasText: name }).first()).toBeVisible();
  const no3 = await openMeasurement(page, "NO3 (ppm)");
  await expect(no3.getByTestId("ref-NO3")).toBeVisible();
  await expect(no3.getByTestId("conversion-NO3")).toBeVisible();
  await expect(no3.getByTestId("wm-dilution")).toContainText("a leolvasás és a hígítás szorzata");
  // the pH has no dilution
  await expect((await openMeasurement(page, "pH (pH)")).getByTestId("wm-dilution")).toHaveCount(0);
});

test("one order: pH moved before Sűrűség on the card is the daily table's order; put back", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "the order is global: one project changes it");
  await login(page, "teszt.admin");
  await page.goto("/vizmeres?csoport=NAPI_NAGY");
  expect((await columns(page)).slice(0, 2)).toEqual(["Sűrűség", "pH"]);
  const move = async (name: string) => {
    await page.goto("/beallitasok");
    await openAllSettings(page);
    await page.getByTestId("water-order-box").locator("summary").click();
    await page.getByTestId("water-order").getByRole("button", { name: `${name} feljebb` }).click();
    await page.getByTestId("save-water-order").click();
    await expect(page.getByTestId("water-order-box").getByRole("status")).toBeVisible();
    await page.waitForLoadState("networkidle");
  };
  await move("pH (pH)");
  try {
    await page.goto("/vizmeres?csoport=NAPI_NAGY");
    expect((await columns(page)).slice(0, 2)).toEqual(["pH", "Sűrűség"]);
  } finally {
    await move("Sűrűség (ppt)");
  }
  await page.goto("/vizmeres?csoport=NAPI_NAGY");
  expect((await columns(page)).slice(0, 2)).toEqual(["Sűrűség", "pH"]);
});
