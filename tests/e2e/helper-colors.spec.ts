// Lili 2026-10-30 (task caparium-buborek-szin, msgs 1565721013113585835 and 1565721180436963370): each helper figure's speech bubble has its
// own colour (Antennarius #FFC4A8, Zebracápa #FFF0B8), a thin edge a shade darker, and the text stays dark. The colours are what the
// browser computes, so a rule that never matches (a renamed attribute, a typo in a selector) fails here.
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

const FIGURES = [
  { path: "/adagolas", slug: "antennarius", bg: "rgb(255, 196, 168)", edge: "rgb(232, 160, 127)" },
  { path: "/etetes", slug: "zebracapa", bg: "rgb(255, 240, 184)", edge: "rgb(230, 201, 92)" },
] as const;

for (const f of FIGURES) {
  test(`the ${f.slug} bubble has its own colour, a darker edge and dark text`, async ({ page }) => {
    await login(page, "teszt.admin");
    await page.goto(f.path);
    const helper = page.getByTestId("helper");
    await expect(helper).toHaveAttribute("data-ready", "1");
    // the figure's picture and the colour rule are about the same figure
    await expect(helper).toHaveAttribute("data-figure", f.slug);
    await expect(helper.getByTestId("helper-button").locator("img")).toHaveAttribute("src", new RegExp(`^/segito/${f.slug}-`));
    await helper.getByTestId("helper-button").click();
    const bubble = helper.getByRole("dialog");
    await expect(bubble).toBeVisible();
    const look = await bubble.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, edge: s.borderTopColor, ink: s.color, after: getComputedStyle(el, "::after").backgroundColor };
    });
    expect(look.bg).toBe(f.bg);
    expect(look.edge).toBe(f.edge);
    expect(look.after, "the tail takes the bubble's colour").toBe(f.bg);
    // dark text on the pastel: the ink is far darker than the background (every channel under 100)
    const ink = look.ink.match(/\d+/g)!.map(Number);
    expect(Math.max(...ink)).toBeLessThan(100);
  });
}
