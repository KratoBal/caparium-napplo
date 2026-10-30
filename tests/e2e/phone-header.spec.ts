// Lili 2026-10-30 20:43 UTC (msg 1565813299197517825, task caparium-fejlec-telefon): on a phone the header is ONE compact row above the menu (the
// brand, the day, a button with the user's monogram), the name, the role, the helper's switch and the Kilépés open from that button, and the menu
// row sticks to the top while the page scrolls. A tablet and a desktop keep the header they had. Read-only but the log out at the end of the phone test.
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

test.describe("phone, 390 px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("one compact row, a profile button that opens the name, the switch and the Kilépés, the menu row sticks", async ({ page }) => {
    await login(page, "teszt.akvarista1");
    // the start page has no title: the head is the one row (at most 64 px), the menu right under it
    const heights = await page.evaluate(() => ({
      head: document.querySelector(".head")!.getBoundingClientRect().height,
      navTop: document.querySelector(".nav")!.getBoundingClientRect().top,
      over: document.documentElement.scrollWidth - window.innerWidth,
      userbox: document.querySelectorAll(".userbox").length,
    }));
    expect(heights.head).toBeLessThanOrEqual(64);
    expect(Math.abs(heights.navTop - heights.head)).toBeLessThan(1);
    expect(heights.over).toBeLessThanOrEqual(0);
    expect(heights.userbox, "no inline user box on a phone").toBe(0);
    const button = page.getByTestId("profile-button");
    await expect(button).toBeVisible();
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await button.innerText()).trim().length).toBeGreaterThan(0);
    await expect(page.getByTestId("today")).toBeVisible();
    // closed: the name is not on the page; opened: the name and the role, the Kilépés
    await expect(page.getByTestId("current-user")).toHaveCount(0);
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    const panel = page.getByTestId("profile-panel");
    await expect(panel.getByTestId("current-user")).toContainText("akvarista");
    await expect(panel.getByRole("button", { name: "Kilépés" })).toBeVisible();
    // the start page has a helper, so its switch is in the panel (and only there: the header's own is gone on a phone)
    await expect(panel.getByTestId("helper-toggle")).toBeVisible();
    await expect(page.getByTestId("helper-toggle")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    // a tap elsewhere closes it too
    await button.click();
    await expect(panel).toBeVisible();
    await page.getByRole("heading", { name: "Jó munkát!" }).click();
    await expect(panel).toHaveCount(0);
    // a page with a title: the title is a thin line under the row, the head still well under a quarter of the screen
    await page.goto("/vizmeres");
    await expect(page.getByRole("heading", { name: "Napi vízmérések", level: 1 })).toBeVisible();
    const withTitle = await page.evaluate(() => document.querySelector(".head")!.getBoundingClientRect().height);
    expect(withTitle).toBeLessThanOrEqual(100);
    // the menu row sticks at the top while the page scrolls
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    expect(await page.evaluate(() => Math.round(document.querySelector(".nav")!.getBoundingClientRect().top))).toBe(0);
    // the Kilépés from the profile panel works
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByTestId("profile-button").click();
    await page.getByTestId("profile-panel").getByRole("button", { name: "Kilépés" }).click();
    await expect(page).toHaveURL(/\/belepes(\?|$)/);
  });
});

test.describe("tablet, 1024 px", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("the header is as it was: the user box inline, no profile button", async ({ page }) => {
    await login(page, "teszt.akvarista1");
    await expect(page.getByTestId("current-user")).toBeVisible();
    await expect(page.locator(".userbox").getByRole("button", { name: "Kilépés" })).toBeVisible();
    await expect(page.getByTestId("profile-button")).toHaveCount(0);
    expect(await page.locator(".head").evaluate((el) => getComputedStyle(el).display)).toBe("contents");
  });
});
