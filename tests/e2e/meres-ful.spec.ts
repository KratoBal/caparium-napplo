// MEASUREMENT ONLY (card de99fbd4, t-20261118-caparium-vizmeres-villogo), never merged.
// Round 1 (47be1df): a pool chosen while the tab's RSC request was held SURVIVED the navigation (both projects).
// Round 2 (87e19b8): Playwright does not click a pool button in an inert main; it waits (both engines).
// Round 3 (6f03741): the layout does not move at the commit (button and toolbar the same before, during, after); but on the
// tablet the pool button is below the fold (y 986 in a 768 px viewport), so Playwright scrolls to it before the click.
// Round 4: does the tab navigation's commit SCROLL the page (back to the top) after Playwright has scrolled to the pool?
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

test("MERES does the page move when the tab navigation commits", async ({ page }, info) => {
  const pool = info.project.name === "tablet" ? "Karantén" : "Kismedence";
  const button = page.getByRole("button", { name: pool, exact: true });
  await login(page, "teszt.akvarista1");
  await page.getByRole("link", { name: "Napi vízmérés", exact: true }).first().click();
  await expect(page.getByRole("tab", { name: "Nagy medencék" })).toBeVisible();
  await expect(page.locator("html[data-hydrated]")).toHaveCount(1);
  await page.waitForTimeout(1000);

  const snap = async () => {
    const b = await button.boundingBox();
    const t = await page.locator(".toolbar").first().boundingBox();
    const toolbarText = (await page.locator(".toolbar").first().innerText()).replace(/\s+/g, " ").slice(0, 160);
    const y = await page.evaluate(() => Math.round(window.scrollY));
    return `scrollY=${y} button=${b ? `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.height)}` : "none"} toolbarH=${t ? Math.round(t.height) : "none"} toolbar="${toolbarText}"`;
  };

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
  const before = await snap();
  await page.getByRole("tab", { name: "Nagy medencék" }).click();
  await expect.poll(() => held, { timeout: 5000 }).toBeGreaterThan(0).catch(() => undefined);
  await button.scrollIntoViewIfNeeded();
  const during = await snap();
  release();
  await page.waitForURL(/csoport=NAPI_NAGY/, { timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const after = await snap();
  console.log(`MERES ${info.project.name} held=${held}\n  MERES before ${before}\n  MERES during ${during}\n  MERES after  ${after}`);
});
