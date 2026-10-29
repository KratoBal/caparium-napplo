// The secondary controls look clickable (Lili 2026-10-26, Caparium channel msg 1564411331891830885). Its own spec file, so that it
// does not grow the end of daily-flow.spec.ts, where every follow-up of the evening appends and the branches conflict.
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

// Lili 2026-10-26 (Caparium channel msg 1564411331891830885, image masodlagos-gombok-lili.png): the secondary controls (a soft
// button, a dropdown, a field, a tab) had almost the page's own background, so it was not clear what could be clicked. One set of
// tokens in globals.css: a pale but visible border, a shade darker background, a darker one on hover. Read from the computed style.
test("secondary controls are visible: a border, a background unlike the page's, and a hover state", async ({ page }, info) => {
  await login(page, "teszt.admin");
  await page.goto("/etetes");
  await page.waitForLoadState("networkidle");
  const pageBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const look = (loc: ReturnType<Page["locator"]>) =>
    loc.first().evaluate((el) => {
      const c = getComputedStyle(el);
      return { width: c.borderTopWidth, style: c.borderTopStyle, color: c.borderTopColor, bg: c.backgroundColor };
    });
  const plan = page.getByRole("button", { name: "Mai Terv" });
  const list = page.getByLabel("Névvel ellátott lista");
  // the day control's soft button is "Nap lezárása" or "Nap újranyitása", whichever the day's state offers
  const dayButton = page.locator(".day-controls button.btn-soft");
  const controls = [plan, ...((await dayButton.count()) > 0 ? [dayButton] : []), ...((await list.count()) > 0 ? [list] : [])];
  for (const control of controls) {
    const l = await look(control);
    expect([l.width, l.style], "a 1px border").toEqual(["1px", "solid"]);
    expect(l.color, "a visible border, not transparent").not.toMatch(/rgba\(\d+, \d+, \d+, 0\)|transparent/);
    expect(l.bg, "not the page's own background").not.toBe(pageBg);
  }
  // hover: a darker background (a mouse only; the tablet layout has no hover)
  if (info.project.name === "desktop") {
    const before = (await look(plan)).bg;
    await plan.hover();
    expect((await look(plan)).bg, "hover changes the background").not.toBe(before);
  }
  // a tab and a field on another page
  await page.goto("/vizmeres");
  await page.waitForLoadState("networkidle");
  const tab = await look(page.locator(".tab:not(.active)"));
  expect([tab.width, tab.style]).toEqual(["1px", "solid"]);
  await page.goto("/export");
  const field = await look(page.locator("input.input[type=date]"));
  expect([field.width, field.style]).toEqual(["1px", "solid"]);
  expect(field.color).not.toMatch(/rgba\(\d+, \d+, \d+, 0\)|transparent/);
});
