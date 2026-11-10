// Lili 2026-11-10 (acrobot 45552): Enter in a number field closes the value like clicking out and moves to the next field.
// It never saves or submits. The weekly page: the cells are number fields without a form; the numeric keypad's Enter counts too.
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

for (const enter of ["Enter", "NumpadEnter"]) {
  test(`${enter} in a weekly cell closes the value, moves to the next cell and saves nothing`, async ({ page }, info) => {
    const pool = info.project.name === "tablet" ? "Karantén" : "Kismedence";
    await login(page, "teszt.admin");
    await page.goto("/heti");
    await page.getByRole("button", { name: pool, exact: true }).click();
    const cells = page.locator(`[data-testid^="cell-${pool}-"]`);
    expect(await cells.count(), "the pool has at least two number cells").toBeGreaterThanOrEqual(2);
    const first = cells.nth(0);
    const second = cells.nth(1);
    await first.fill("7");
    await first.press(enter);
    await expect(second, "the focus moved to the next cell").toBeFocused();
    await expect(first, "the value stays as a draft").not.toHaveValue("");
    await expect(page, "nothing was submitted").toHaveURL(/\/heti/);
    await expect(page.getByTestId("banner"), "nothing was saved").toHaveCount(0);
  });
}
