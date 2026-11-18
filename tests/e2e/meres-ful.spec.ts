// MEASUREMENT ONLY (card de99fbd4, t-20261118-caparium-vizmeres-villogo), never merged.
// Round 1 (47be1df): a pool chosen while the tab's RSC request was held SURVIVED the navigation (both projects).
// Round 2 (87e19b8): Playwright does not click a pool button in an inert main; it waits (both engines).
// Round 3 (6f03741): the layout does not move at the commit (button and toolbar the same before, during, after); but on the
// tablet the pool button is below the fold (y 986 in a 768 px viewport), so Playwright scrolls to it before the click.
// Round 4 (e14c26b): YES on the tablet: scrollY 574 after Playwright's scroll to the pool, 0 after the commit (desktop: 0, no scroll).
// Round 5: calibration of the fix's openTab(): while the tab's request is held it must not return; after the release it
// returns with the address changed and the page already at the top.
// Every line it prints starts with MERES; the test always passes.
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_TEST_PASSWORD ?? "";

async function login(page: Page, loginId: string) {
  await page.goto("/belepes");
  await page.getByLabel("Felhasználónév").fill(loginId);
  await page.getByLabel("Jelszó").fill(PASSWORD);
  await page.getByRole("button", { name: "Bejelentkezés" }).click();
  await expect(page.getByRole("heading", { name: "Jó munkát!" })).toBeVisible();
}

async function openTab(page: Page, name: string) {
  const tab = page.getByRole("tab", { name });
  const href = await tab.getAttribute("href");
  if (!href) throw new Error(`the tab "${name}" has no address`);
  const here = () => {
    const url = new URL(page.url());
    return `${url.pathname}${url.search}` === href;
  };
  if (here()) return;
  await tab.click();
  await expect.poll(here, { message: `the tab "${name}" navigated to ${href}` }).toBe(true);
}

test("MERES openTab waits for the commit", async ({ page }, info) => {
  const pool = info.project.name === "tablet" ? "Karantén" : "Kismedence";
  const button = page.getByRole("button", { name: pool, exact: true });
  await login(page, "teszt.akvarista1");
  await page.getByRole("link", { name: "Napi vízmérés", exact: true }).first().click();
  await expect(page.locator("html[data-hydrated]")).toHaveCount(1);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let held = 0;
  await page.route(
    (u) => u.pathname === "/vizmeres" && u.searchParams.has("csoport"),
    async (route) => {
      if (route.request().headers()["rsc"] === "1") {
        held++;
        await gate;
      }
      await route.continue();
    },
  );
  let done = false;
  const opening = openTab(page, "Nagy medencék").then(() => (done = true));
  await expect.poll(() => held, { timeout: 5000 }).toBeGreaterThan(0).catch(() => undefined);
  await button.scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
  const doneWhileHeld = done;
  const scrollWhileHeld = await page.evaluate(() => Math.round(window.scrollY));
  release();
  await opening;
  const scrollAtReturn = await page.evaluate(() => Math.round(window.scrollY));
  await button.click();
  const cell = await page.getByTestId(`cell-${pool}-pH`).isVisible();
  console.log(
    `MERES ${info.project.name} held=${held} doneWhileHeld=${doneWhileHeld} scrollWhileHeld=${scrollWhileHeld} ` +
      `scrollAtReturn=${scrollAtReturn} url=${page.url()} cellAfterClick=${cell}`,
  );
});
