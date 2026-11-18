// MEASUREMENT ONLY (card de99fbd4, t-20261118-caparium-vizmeres-villogo), never merged: does a pool chosen on the daily
// water page survive the tab navigation that was still in flight when it was chosen? The tab's RSC request is held until
// the pool is chosen, then let go. Every line it prints starts with MERES; the test itself always passes.
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_TEST_PASSWORD ?? "";

async function login(page: Page, loginId: string) {
  await page.goto("/belepes");
  await page.getByLabel("Felhasználónév").fill(loginId);
  await page.getByLabel("Jelszó").fill(PASSWORD);
  await page.getByRole("button", { name: "Bejelentkezés" }).click();
  await expect(page.getByRole("heading", { name: "Jó munkát!" })).toBeVisible();
}

for (const hold of [true, false]) {
  test(`MERES tab navigation and the pool choice (hold=${hold})`, async ({ page }, info) => {
    const pool = info.project.name === "tablet" ? "Karantén" : "Kismedence";
    const cell = page.getByTestId(`cell-${pool}-pH`);
    const button = page.getByRole("button", { name: pool, exact: true });
    await login(page, "teszt.akvarista1");
    await page.getByRole("link", { name: "Napi vízmérés", exact: true }).first().click();
    await expect(page.getByRole("tab", { name: "Nagy medencék" })).toBeVisible();
    await expect(page.locator("html[data-hydrated]")).toHaveCount(1);
    const urlStart = page.url();

    const seen: string[] = [];
    let held = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route(
      (u) => u.pathname === "/vizmeres" && u.searchParams.has("csoport"),
      async (route) => {
        const h = route.request().headers();
        seen.push(`rsc=${h["rsc"] ?? "-"} prefetch=${h["next-router-prefetch"] ?? "-"}`);
        if (hold && h["rsc"] === "1" && !h["next-router-prefetch"]) {
          held++;
          await gate;
        }
        await route.continue();
      },
    );

    await page.getByRole("tab", { name: "Nagy medencék" }).click();
    await button.click();
    const visibleAfterClick = await cell.isVisible();
    const urlDuring = page.url();
    if (hold) await expect.poll(() => held, { timeout: 5000 }).toBeGreaterThan(0).catch(() => undefined);
    release();
    await page.waitForURL(/csoport=NAPI_NAGY/, { timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(2000);
    const visibleAtEnd = await cell.isVisible();
    const pressedAtEnd = await button.getAttribute("aria-pressed");
    console.log(
      `MERES ${info.project.name} hold=${hold} held=${held} visibleAfterClick=${visibleAfterClick} visibleAtEnd=${visibleAtEnd} ` +
        `pressedAtEnd=${pressedAtEnd} urlStart=${urlStart} urlDuring=${urlDuring} urlEnd=${page.url()} seen=[${seen.join("; ")}]`,
    );
  });
}
