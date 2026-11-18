// MEASUREMENT ONLY (card de99fbd4, t-20261118-caparium-vizmeres-villogo), never merged.
// Round 1 (47be1df): a pool chosen while the tab's RSC request was held SURVIVED the navigation on both projects, so the
// tab navigation is not what loses it. Round 2: does Playwright click a pool button while the page is not hydrated yet
// (main inert, the JS chunks held), and is that click lost? Every line it prints starts with MERES; the test always passes.
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_TEST_PASSWORD ?? "";

async function login(page: Page, loginId: string) {
  await page.goto("/belepes");
  await page.getByLabel("Felhasználónév").fill(loginId);
  await page.getByLabel("Jelszó").fill(PASSWORD);
  await page.getByRole("button", { name: "Bejelentkezés" }).click();
  await expect(page.getByRole("heading", { name: "Jó munkát!" })).toBeVisible();
}

test("MERES a pool click before hydration", async ({ page, browserName }, info) => {
  const pool = info.project.name === "tablet" ? "Karantén" : "Kismedence";
  const button = page.getByRole("button", { name: pool, exact: true });
  await login(page, "teszt.akvarista1");
  const homeHydratedAtHeading = await page.locator("html[data-hydrated]").count();

  let held = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/_next/static/**/*.js", async (route) => {
    held++;
    await gate;
    await route.continue();
  });
  await page.goto("/vizmeres?csoport=NAPI_NAGY", { waitUntil: "commit" });
  await expect(button).toBeVisible();
  const inertBefore = await page.locator("main[inert]").count();
  let click = "resolved";
  await button.click({ timeout: 3000 }).catch((e: Error) => (click = `threw: ${e.message.split("\n")[0]}`));
  release();
  await expect(page.locator("html[data-hydrated]")).toHaveCount(1, { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(1000);
  const pressedAfter = await button.getAttribute("aria-pressed");
  const cellAfter = await page.getByTestId(`cell-${pool}-pH`).isVisible();
  console.log(
    `MERES ${info.project.name} engine=${browserName} homeHydratedAtHeading=${homeHydratedAtHeading} held=${held} ` +
      `inertBefore=${inertBefore} click=${click} pressedAfter=${pressedAfter} cellAfter=${cellAfter}`,
  );
});
