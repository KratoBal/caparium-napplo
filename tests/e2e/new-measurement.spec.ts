// Lili 2026-11-01 (point 9, msg 1566532615530352863): an admin adds a measurement in Beállítások for some pools of the weekly table
// from today; the weekly table gets the column, a field in the chosen pool, a dash in the others. Each project its own name; the
// weekly table (no other spec after this one fills every weekly field).
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

test("a new measurement in one pool of the weekly table: a column, a field there, a dash elsewhere", async ({ page }, info) => {
  const name = `Nitrit ${info.project.name}`;
  await login(page, "teszt.admin");
  await page.goto("/beallitasok");
  const card = page.getByTestId("new-measurement-card");
  if (!(await card.evaluate((d) => (d as HTMLDetailsElement).open))) await card.locator(":scope > summary").click();
  const form = card.getByTestId("new-measurement");
  await form.getByLabel("Név (például Nitrit)").fill(name);
  // the units Lili asked for are offered
  expect(await form.getByLabel("Mértékegység", { exact: true }).locator("option").allTextContents()).toEqual(expect.arrayContaining(["mg/l", "%", "SG"]));
  await form.getByLabel("Mértékegység", { exact: true }).selectOption({ label: "ppm" });
  await form.getByLabel("Tizedesjegyek").selectOption("2");
  await form.getByLabel("Hihető tartomány teteje").fill("5");
  await form.getByLabel("Referencia teteje").fill("0,1");
  await form.getByLabel("ZIMS-név").fill("Nitrite");
  await form.getByLabel("ZIMS-mértékegység").fill("ppm");
  const add = form.getByRole("button", { name: "Mérésfajta felvétele" });
  await expect(add, "a table and a pool are needed").toBeDisabled();
  // Lili 2026-11-01 22:21 UTC: the tables are a multiple choice, each with its own pools
  await form.getByLabel("Tábla: Heti mérés (heti)").check();
  await expect(add, "a pool of the chosen table is needed").toBeDisabled();
  await form.getByLabel("Heti mérés (heti): Karantén").check();
  await add.click();
  await expect(form.getByRole("status")).toHaveText("Mérésfajta felvéve.");

  await page.goto("/heti");
  await page.getByRole("button", { name: "Karantén", exact: true }).click();
  const cell = page.getByTestId(`cell-Karantén-${name}`);
  await expect(cell, "a field in the chosen pool").toBeVisible();
  await expect(page.getByTestId(`na-Nagymedence-${name}`), "a dash in another").toHaveText("–");
  await cell.fill("0,05");
  await page.getByTestId("save-all").click();
  await expect(page.getByTestId("banner")).toHaveText("Minden érték mentve.");
});
