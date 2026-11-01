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
    // the button comes with the hydration; the row is one row before and after it
    await expect(page.getByTestId("profile-button")).toBeVisible();
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
    // (the empty margin of the page, left of the cards: no link there)
    await page.mouse.click(4, 400);
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

  // Lili 2026-11-01 (point 12): the water and the feeding entries are two drop-downs on a phone
  test("the menu row holds two drop-downs, Vízmérés and Takarmányozás, that open their entries", async ({ page }) => {
    await login(page, "teszt.akvarista1");
    const nav = page.getByRole("navigation", { name: "Fő navigáció" });
    const row = await nav.locator(":scope > a:visible, :scope > .nav-group:visible > button").allInnerTexts();
    expect(row.map((t) => t.replace(/[\u25B4\u25BE]/g, "").trim())).toEqual(["START", "Vízmérés", "Export", "Takarmányozás", "Kimutatások"]);
    // the colored entries are not in the row itself
    await expect(nav.getByRole("link", { name: "Evési napló" })).toHaveCount(0);
    const feed = nav.getByRole("button", { name: /Takarmányozás/ });
    await feed.click();
    await expect(feed).toHaveAttribute("aria-expanded", "true");
    const menu = page.getByRole("menu", { name: "Takarmányozás" });
    await expect(menu.getByRole("menuitem")).toHaveText([
      /Takarmánynapló/, /Evési napló/, /Takarmánykivétel/, /Takarmánykalkulátor/, /Takarmányozási napló/, /Fagyasztó/, /Takarmánylista/,
    ]);
    // the list opens under the menu row, inside the screen
    const box = (await menu.boundingBox())!;
    const navBottom = (await nav.boundingBox())!;
    expect(Math.abs(box.y - (navBottom.y + navBottom.height))).toBeLessThan(2);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await menu.getByRole("menuitem", { name: /Evési napló/ }).click();
    await expect(page).toHaveURL(/\/evesi-naplo$/);
    await expect(page.getByRole("menu")).toHaveCount(0);
    // the group of the open page is marked, and Escape closes an open list
    await expect(nav.getByRole("button", { name: /Takarmányozás/ })).toHaveClass(/active/);
    const water = nav.getByRole("button", { name: /Vízmérés/ });
    await water.click();
    await expect(page.getByRole("menu", { name: "Vízmérés" }).getByRole("menuitem")).toHaveText([
      /Napi vízmérés/, /Heti vízmérés/, /Vegyszeradagolás/, /Vízmérési napló/,
    ]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
  });
});

// Lili 2026-11-01 22:01 UTC (iPhone, stage 9abcefc5): the drop-downs did not open. A touch phone: a tap opens the list; the list stands
// outside the sideways-scrolling menu row (iOS clips a fixed element inside such a box); the resize and the scroll iOS fires as its bars
// move keep it open, under the menu row.
test.describe("touch phone, 390 px", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("a tap opens the drop-down outside the scrolling menu row; a resize or a scroll does not close it", async ({ page }) => {
    await login(page, "teszt.akvarista1");
    const nav = page.getByRole("navigation", { name: "Fő navigáció" });
    // the row scrolled sideways first, as on Lili's screen
    await nav.evaluate((el) => (el.scrollLeft = el.scrollWidth));
    const feed = nav.getByRole("button", { name: /Takarmányozás/ });
    await feed.tap();
    const menu = page.getByRole("menu", { name: "Takarmányozás" });
    await expect(menu).toBeVisible();
    expect(await menu.evaluate((el) => el.closest(".nav") === null && el.parentElement === document.body)).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await page.evaluate(() => window.scrollTo(0, 300));
    await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
    await expect(menu, "still open after the bars moved").toBeVisible();
    const box = (await menu.boundingBox())!;
    const row = (await nav.boundingBox())!;
    expect(Math.abs(box.y - (row.y + row.height))).toBeLessThan(2);
    await expect(menu.getByRole("menuitem")).toHaveCount(7);
    await menu.getByRole("menuitem", { name: /Fagyasztó/ }).tap();
    await expect(page).toHaveURL(/\/takarmanyhuto$/);
    await expect(page.getByRole("menu")).toHaveCount(0);
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

    // the menu keeps every entry in its plain list, no drop-down (point 12 is for the phone)
    const nav = page.getByRole("navigation", { name: "Fő navigáció" });
    await expect(nav.getByRole("link", { name: "Evési napló" })).toBeVisible();
    await expect(nav.getByRole("button", { name: /Takarmányozás/ })).toHaveCount(0);
  });
});
