// Lili uses an iPad (acrobot 39893): on the tablet layout (1024 wide) the head pushed every page with a long title past
// the screen, the Kilépés button cut off (77 px on the water pages, 152 px on the feeding page, measured on main
// 263e1c8). No page runs off sideways; a wide table scrolls inside its own box.
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

test("the tablet: no page runs off the screen sideways, the Kilépés button inside it", async ({ page }, info) => {
  test.skip(info.project.name !== "tablet", "the tablet layout's own check");
  await login(page, "teszt.admin");
  for (const path of ["/", "/vizmeres", "/heti", "/naplo", "/etetes", "/evesi-naplo", "/kivetel", "/beallitasok", "/profil", "/export"]) {
    await page.goto(path);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over, `${path}: sideways`).toBeLessThanOrEqual(0);
    const logout = (await page.getByRole("button", { name: "Kilépés" }).boundingBox())!;
    expect(logout.x + logout.width, `${path}: Kilépés`).toBeLessThanOrEqual(1024);
  }
});
