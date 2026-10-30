// The admin's activity page (card 70cadcf8): an admin sees who recorded what and opens a cell; an aquarist does not
// get in. The save it opens is the admin's own Excel export, made here: it writes an audit row and changes no data.
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

test("an admin sees the day's saves per person and opens one cell", async ({ page, baseURL }) => {
  await login(page, "teszt.admin");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest" }).format(new Date());
  const exported = await page.request.post("/api/exports/excel", {
    form: { from: today, to: today },
    headers: { Origin: baseURL! },
  });
  expect(exported.status()).toBe(200);

  await page.goto("/aktivitas");
  await expect(page.getByRole("heading", { name: "Ki mit rögzített" })).toBeVisible();
  const cell = page.getByTestId(`activity-cell-${today}-teszt.admin-export`);
  await expect(cell.getByRole("link")).toHaveText(/^\d+$/);
  await cell.getByRole("link").click();

  const detail = page.getByTestId("activity-detail");
  await expect(detail.getByRole("heading")).toContainText("Export, levél, napzárás");
  await expect(detail).toContainText("export: export");

  // a second click from the opened page, and a click from a view filtered to one person: the detail stays
  // (barracuda, #136: the person key was written twice and the detail vanished)
  // the URL first: the old detail stays on screen until a new page renders, so the text alone would pass too early
  await cell.getByRole("link").click();
  await expect(page).toHaveURL((url) => {
    const q = url.searchParams;
    return [...new Set(q.keys())].every((k) => q.getAll(k).length === 1) && q.get("ki") !== null;
  });
  await expect(detail).toContainText("export: export");
  await page.getByLabel("Felhasználó").selectOption({ label: "Teszt Admin" });
  await page.getByRole("button", { name: "Szűrés" }).click();
  await expect(page.getByTestId("activity-detail")).toHaveCount(0);
  await page.getByTestId(`activity-cell-${today}-teszt.admin-export`).getByRole("link").click();
  await expect(page.getByTestId("activity-detail")).toContainText("export: export");
});

test("an aquarist is sent to the no-access page", async ({ page }) => {
  await login(page, "teszt.akvarista1");
  await page.goto("/aktivitas");
  await expect(page).toHaveURL(/\/nincs-jogosultsag$/);
});
