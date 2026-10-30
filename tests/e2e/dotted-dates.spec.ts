// Lili 2026-10-30 (task caparium-datum-ponttal): a date a person reads has the dotted shape, 2026.10.30., on every page
// (the date input fields keep the browser's own shape and are not text, so `innerText` leaves them out; the ZIMS CSV is
// not a page, and a download link's text is a file name). A hyphenated ISO date in the visible text of any page is the miss this test names.
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

const PAGES = [
  "/",
  "/vizmeres",
  "/heti",
  "/naplo",
  "/fuggo",
  "/aktivitas",
  "/allatok",
  "/kalkulator",
  "/adagolas",
  "/kimutatasok",
  "/kivetel",
  "/export",
  "/etetes",
  "/evesi-naplo",
  "/takarmany-naplo",
  "/takarmanyhuto",
  "/beallitasok",
];

test("no page shows a hyphenated ISO date as text; the day pages show the dotted one", async ({ page }) => {
  await login(page, "teszt.admin");
  const isoDate = /\d{4}-\d{2}-\d{2}/;
  const dotted = /\d{4}\.\d{2}\.\d{2}\./;
  const seen: string[] = [];
  for (const path of PAGES) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBeLessThan(500);
    await page.waitForLoadState("networkidle");
    let text = await page.locator("body").innerText();
    // a file name keeps its ISO day (the ZIMS files' names are fixed): the download links are not date text
    for (const name of await page.locator("a[download]").allInnerTexts()) text = text.split(name).join("");
    const hit = text.match(isoDate);
    expect(hit ? `${path}: ${hit[0]}` : null, `${path} shows an ISO date`).toBeNull();
    if (dotted.test(text)) seen.push(path);
  }
  // the pages with a day in their heading or pill carry the dotted shape (not asserted for every list: an empty list has no date)
  expect(seen).toEqual(expect.arrayContaining(["/vizmeres", "/etetes", "/takarmanyhuto"]));
});
