// Lili 2026-11-01 22:59 UTC (msg 1566587603879469096): "itt nem túl nagyok a holtterek a fejlécben?" on the daily and the weekly
// water page. The date and the day's state on one row; the table picker, the day picker and the save button on the next; the rows
// close together. Measured on the tablet (1024 wide) and the desktop; the phone's "nothing runs off sideways" is android.spec.ts.
import { expect, test, type Locator, type Page } from "@playwright/test";

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

const box = async (l: Locator) => (await l.boundingBox())!;
const middle = (b: { y: number; height: number }) => b.y + b.height / 2;

for (const path of ["/vizmeres", "/heti"]) {
  test(`${path}: the date and the state on one row, the tables, the day and the save button on the next, close below`, async ({ page }) => {
    await login(page, "teszt.akvarista1");
    await page.goto(path);
    const head = page.getByTestId("water-head");
    const date = await box(head.locator("p"));
    const state = await box(head.getByTestId("day-status").locator(".badge"));
    expect(Math.abs(middle(date) - middle(state)), "the state beside the date").toBeLessThan(12);

    const row = page.getByTestId("water-head-row");
    const tabs = await box(row.getByRole("tablist", { name: "Mérési csoport" }));
    const jump = await box(row.getByRole("button", { name: "Ugrás" }));
    const save = await box(row.getByTestId("save-all"));
    // one row: the save button and the jump button on the same bottom line, inside the tables' height
    expect(Math.abs(save.y + save.height - (jump.y + jump.height)), "save and jump on one line").toBeLessThan(4);
    expect(save.y, "the save button in the tables' row").toBeGreaterThanOrEqual(tabs.y - 2);
    expect(save.y + save.height).toBeLessThanOrEqual(tabs.y + tabs.height + 2);
    // the save button at the right end, after the day picker
    expect(save.x).toBeGreaterThan(jump.x + jump.width);
    // the rows close together
    const headBox = await box(head);
    expect((await box(row)).y - (headBox.y + headBox.height), "the gap under the date row").toBeLessThan(20);
  });
}
