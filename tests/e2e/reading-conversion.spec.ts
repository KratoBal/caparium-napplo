// Lili 2026-11-01 (point 13): a tester conversion set in Beállítások; on the weekly page the reading typed in the field becomes
// the value when the field is left, the value carries a small dot, and after the save the dot stays, its title naming the reading.
// On Mg with a test factor (2, no decimals): no other e2e test types Mg. Each project its own pool; the conversion is set once
// (the second project finds it in force).
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

test("a reading typed for a converted parameter becomes the value, with a dot, and is kept", async ({ page }, info) => {
  const pool = info.project.name === "tablet" ? "Karantén" : "Kismedence";
  await login(page, "teszt.admin");
  await page.goto("/beallitasok");
  // the module may start closed (point 15): opened if it is
  const card = page.getByTestId("conversions");
  if (!(await card.evaluate((d) => (d as HTMLDetailsElement).open))) await card.locator(":scope > summary").click();
  const row = page.getByTestId("conversion-Mg");
  if ((await row.innerText()).includes("nincs")) {
    await row.getByLabel("Mg mérőeszköz").fill("E2E mérő");
    await row.getByLabel("Mg szorzó").fill("2");
    await row.getByLabel("Mg tizedesjegy").selectOption("0");
    await row.getByRole("button", { name: "Mentés" }).click();
    await expect(row.getByRole("status")).toHaveText("Mentve.");
  }
  await expect(row).toContainText("E2E mérő: leolvasás × 2, 0 tizedes");

  await page.goto("/heti");
  await page.getByRole("button", { name: pool, exact: true }).click();
  const cell = page.getByTestId(`cell-${pool}-Mg`);
  await cell.fill("617");
  await expect(page.getByTestId(`conv-${pool}-Mg`), "no dot while typing").toHaveCount(0);
  await cell.press("Tab");
  await expect(cell, "converted when the field is left, and it stays in the field").toHaveValue("1234");
  await expect(page.getByTestId(`conv-${pool}-Mg`)).toHaveAttribute("title", /leolvasva: 617/);
  // left again without a change: not converted twice
  await cell.focus();
  await cell.press("Tab");
  await expect(cell).toHaveValue("1234");
  await page.getByTestId("save-all").click();
  await expect(page.getByTestId("banner")).toHaveText("Minden érték mentve.");
  await page.reload();
  await page.getByRole("button", { name: pool, exact: true }).click();
  await expect(page.getByTestId(`cell-${pool}-Mg`)).toHaveValue("1234");
  await expect(page.getByTestId(`conv-${pool}-Mg`)).toHaveAttribute("title", /E2E mérő.*leolvasva: 617/);
  // the pool's other cells carry no dot
  await expect(page.getByTestId(`row-${pool}`).locator(".conv-dot")).toHaveCount(1);
});
