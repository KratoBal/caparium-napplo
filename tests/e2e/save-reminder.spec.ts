// "Ne felejtsd el menteni!" (card 0d617f0c): every field of the day's water form filled, nothing saved, and the page about
// to be left: the helper speaks. Switched off in Beállítások, it does not. The quiet-minute path is the unit test's
// (tests/unit/save-reminder.test.ts, a fake clock): a real minute does not belong in the e2e run.
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_TEST_PASSWORD ?? "";
const REMINDER = "Ne felejtsd el menteni!";

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

// each layout its own group and its own past day, so the two projects never fill the same form
function form(projectName: string) {
  return projectName === "tablet"
    ? { group: "NAPI_KIS", day: "2026-02-16", pools: ["Ragadozós", "Inkubátor", "Korallos"] }
    : { group: "NAPI_NAGY", day: "2026-02-17", pools: ["Nagymedence", "Kismedence", "Karantén"] };
}
const VALUES: [string, string][] = [["Sűrűség", "35,0"], ["pH", "8,10"], ["Hőmérséklet", "25,0"], ["ORP", "300"]];

/** Every cell of the group's day typed in, none saved; then a menu link, and the "leave unsaved?" question answered "stay". */
async function fillAndTryToLeave(page: Page, f: ReturnType<typeof form>) {
  await page.goto(`/vizmeres?csoport=${f.group}&nap=${f.day}`);
  for (const pool of f.pools) {
    await page.getByTestId(`row-${pool}`).getByRole("button", { name: pool }).click();
    for (const [param, value] of VALUES) await page.getByTestId(`cell-${pool}-${param}`).fill(value);
  }
  const asked: string[] = [];
  page.once("dialog", (d) => {
    asked.push(d.message());
    void d.dismiss();
  });
  await page.getByRole("navigation", { name: "Fő navigáció" }).getByRole("link", { name: "Heti vízmérés", exact: true }).click();
  await expect.poll(() => asked.length, { message: "the leave question came" }).toBe(1);
  await expect(page).toHaveURL(/\/vizmeres/);
}

test("a filled, unsaved water form: leaving it makes the helper say to save", async ({ page }, info) => {
  await login(page, "teszt.admin");
  await fillAndTryToLeave(page, form(info.project.name));
  await expect(page.locator('[data-testid="helper-notice"][data-kind="reminder"]')).toHaveText(REMINDER);
});

test("switched off in Beállítások, the helper does not say it; switched on again", async ({ page }, info) => {
  await login(page, "teszt.admin");
  await page.goto("/beallitasok");
  const sw = page.getByTestId("save-reminder").getByRole("switch");
  await expect(sw).toBeChecked();
  await sw.uncheck();
  await expect(page.getByTestId("save-reminder").getByRole("status")).toHaveText("Mentve.");
  try {
    await fillAndTryToLeave(page, form(info.project.name));
    // the question came (the leave warning is not the reminder's), and a beat later still no reminder
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="helper-notice"][data-kind="reminder"]')).toHaveCount(0);
  } finally {
    // back on, for the other project and the next run: the drafts are left unsaved, so the page asks once more
    page.once("dialog", (d) => void d.accept());
    await page.goto("/beallitasok");
    const back = page.getByTestId("save-reminder").getByRole("switch");
    if (!(await back.isChecked())) {
      await back.check();
      await expect(page.getByTestId("save-reminder").getByRole("status")).toHaveText("Mentve.");
    }
  }
});
