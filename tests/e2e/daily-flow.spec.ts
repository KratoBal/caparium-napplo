// The first working flow (feladat-4, 4. pont): login -> pool group -> record -> saved in the DB -> log.
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_TEST_PASSWORD ?? "";

async function login(page: Page, loginId: string) {
  await page.goto("/belepes");
  await page.getByLabel("Felhasználónév").fill(loginId);
  await page.getByLabel("Jelszó").fill(PASSWORD);
  await page.getByRole("button", { name: "Bejelentkezés" }).click();
  await expect(page.getByRole("heading", { name: "Jó munkát!" })).toBeVisible();
}

// each layout writes its own group, so the two projects never touch the same cell
function plan(projectName: string) {
  return projectName === "tablet"
    ? { tab: "Kismedencék", pool: "Korallos" }
    : { tab: "Nagy medencék", pool: "Nagymedence" };
}

test.beforeAll(() => {
  if (!PASSWORD) throw new Error("SEED_TEST_PASSWORD must be set for the e2e run");
});

test("login, record a daily measurement, it survives a reload and shows in the log with history", async ({ page }, info) => {
  const p = plan(info.project.name);
  await login(page, "teszt.akvarista1");

  await page.getByRole("link", { name: "Napi vízmérés" }).first().click();
  await page.getByRole("tab", { name: p.tab }).click();
  await expect(page.getByRole("heading", { name: /Napi paraméterek/ })).toBeVisible();

  // the first pool is the active row; tap it anyway, as on the tablet
  await page.getByRole("button", { name: p.pool, exact: true }).click();
  const ph = page.getByTestId(`cell-${p.pool}-pH`);
  await ph.fill("7,88");
  await ph.press("Enter");
  await expect(page.getByTestId(`cell-${p.pool}-pH`)).toHaveClass(/out/);
  await expect(page.getByText("Eltérés a referenciaértéktől")).toBeVisible();

  const sal = page.getByTestId(`cell-${p.pool}-Sűrűség`);
  await sal.fill("35,0");
  await page.getByTestId("save-all").click();
  await expect(page.getByTestId("banner")).toHaveText("Minden érték mentve.");

  // persisted in the database, not in the browser
  await page.reload();
  await expect(page.getByTestId(`cell-${p.pool}-pH`)).toHaveValue("7,88");
  await expect(page.getByTestId(`cell-${p.pool}-Sűrűség`)).toHaveValue("35");

  // the log finds it, and the history shows who recorded it
  await page.getByRole("link", { name: "Vízmérési napló" }).first().click();
  const row = page.getByTestId("log-table").getByRole("row").filter({ hasText: p.pool }).filter({ hasText: "pH" }).first();
  await expect(row).toContainText("7,88");
  await expect(row.locator(".value-out")).toBeVisible();
  await row.getByRole("link").click();
  await expect(page.getByTestId("history-entry").first()).toContainText("Rögzítés");
  await expect(page.getByTestId("history-entry").first()).toContainText("Teszt Akvarista Egy");
});

test("an aquarist sees an earlier day read-only", async ({ page }) => {
  await login(page, "teszt.akvarista2");
  await page.goto("/vizmeres?nap=2026-01-05");
  await expect(page.getByText("Korábbi nap: csak megtekintés.")).toBeVisible();
  await expect(page.getByTestId("save-all")).toHaveCount(0);
  await expect(page.locator("input.cell-input")).toHaveCount(0);
});

test("a second editor of the same cell gets a conflict, not a silent overwrite", async ({ browser }, info) => {
  const p = plan(info.project.name);
  const a = await browser.newPage();
  const b = await browser.newPage();
  await login(a, "teszt.akvarista1");
  await login(b, "teszt.akvarista2");
  for (const page of [a, b]) {
    await page.goto("/vizmeres");
    await page.getByRole("tab", { name: p.tab }).click();
    await page.getByRole("button", { name: p.pool, exact: true }).click();
  }
  // a writes ORP first; b's page still shows the empty cell and writes too
  const orpA = a.getByTestId(`cell-${p.pool}-ORP`);
  await orpA.fill("305");
  await orpA.press("Enter");
  await expect(a.getByTestId(`cell-${p.pool}-ORP`)).toHaveValue("305");
  await a.waitForLoadState("networkidle");
  const orpB = b.getByTestId(`cell-${p.pool}-ORP`);
  await orpB.fill("310");
  await orpB.press("Enter");
  await expect(b.getByTestId("conflict")).toBeVisible();
  await expect(b.getByTestId("conflict")).toContainText("305");
  await b.getByRole("button", { name: "Friss adat betöltése" }).click();
  await expect(b.getByTestId(`cell-${p.pool}-ORP`)).toHaveValue("305");
  await a.close();
  await b.close();
});
