// Lili 2026-10-30 17:17 UTC (msg 1565776571346976861, task caparium-takarmanylap-telefon): on a phone every row of the feeding sheet is a collapsed
// card: the name and the row's total on top, a tap on the name opens it (its fields under their feeds' names), a second tap closes it; an unsaved
// value stays visible on the closed card as a dot. Tablet and desktop keep the table (no button in the name cell there). Nothing is saved here: the
// test types a draft and leaves it, so the day stays as the setup made it. A past day of its own per project, so no other test shares it.
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_TEST_PASSWORD ?? "";

async function login(page: Page, loginId: string) {
  await page.goto("/belepes");
  await page.getByLabel("Felhasználónév").fill(loginId);
  await page.getByLabel("Jelszó").fill(PASSWORD);
  await page.getByRole("button", { name: "Bejelentkezés" }).click();
  await expect(page.getByRole("heading", { name: "Jó munkát!" })).toBeVisible();
}

function budapestDay(offsetDays: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest" }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

test.beforeAll(() => {
  if (!PASSWORD) throw new Error("SEED_TEST_PASSWORD must be set for the e2e run");
});

// the day's list: Teszt Egy on it, the Mysis feed ticked, the list finalized so the sheet is there; idempotent for a retry
async function prepareSheet(page: Page, day: string) {
  page.on("dialog", (d) => void d.accept());
  await login(page, "teszt.admin");
  await page.goto(`/etetes?nap=${day}`);
  const dayFeeds = page.getByTestId("day-feeds");
  const ready = dayFeeds.getByRole("button", { name: "Takarmánylap kész" });
  const sheet = page.getByTestId("feeding-sheet");
  if (!(await sheet.getByRole("columnheader", { name: /^Mysis/ }).count()) && (await ready.count())) {
    await page.getByLabel("Teszt Egy a mai listán").check();
    await expect(page.getByLabel("Teszt Egy a mai listán")).toBeChecked();
    await dayFeeds.getByLabel("A nap takarmánya: Mysis").check();
    await ready.click();
    await expect(dayFeeds.getByTestId("list-state")).toHaveText("Takarmánylap kész");
  }
  await expect(sheet.getByTestId("feeding-sheet-table")).toBeAttached();
}

test.describe("phone, 390 px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a collapsed card per row: a tap on the name opens it, a second closes it, an unsaved value shows as a dot", async ({ page }, info) => {
    await prepareSheet(page, budapestDay(info.project.name === "tablet" ? -50 : -52));
    const sheet = page.getByTestId("feeding-sheet");
    const toggle = sheet.getByTestId("sheet-toggle-Teszt Egy");
    const field = sheet.getByLabel("Teszt Egy: Mysis (g)");
    // the hint speaks of a tap on a name here (on a tablet and a desktop of a click on a row)
    await expect(sheet.locator(".hint").first()).toContainText("Koppints egy névre");
    // closed: the name is a button with aria-expanded, no field, no header row, nothing scrolls sideways
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(field).toBeHidden();
    const closed = await page.evaluate(() => {
      const box = document.querySelector(".sheet-scroll") as HTMLElement;
      return {
        head: getComputedStyle(document.querySelector('[data-testid="feeding-sheet-table"] thead')!).display,
        boxOver: box.scrollWidth - box.clientWidth,
        docOver: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    expect(closed.head).toBe("none");
    expect(closed.boxOver).toBeLessThanOrEqual(0);
    expect(closed.docOver).toBeLessThanOrEqual(0);
    expect((await toggle.boundingBox())!.height, "a finger-sized name button").toBeGreaterThanOrEqual(44);
    // a tap opens it: the field is there under its feed's name and unit, at least 44 px high
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(field).toBeVisible();
    expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(sheet.locator("tr[data-open] .sheet-cell-label").filter({ hasText: "Mysis" }).first()).toBeVisible();
    // a draft: the dot appears on the name, stays when the card is closed, and the field is still filled when it is opened again
    await field.fill("12");
    await field.blur();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(field).toBeHidden();
    await expect(sheet.getByTestId("sheet-mark-Teszt Egy")).toHaveAttribute("aria-label", "Nem mentett érték");
    await expect(toggle).toContainText("12 g");
    await toggle.click();
    await expect(field).toHaveValue("12");
    // the keyboard works too: Enter closes, Space opens
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});

test.describe("tablet, 1024 px", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("the table stays: no name button, the header row, every field in its row", async ({ page }, info) => {
    await prepareSheet(page, budapestDay(info.project.name === "tablet" ? -50 : -52));
    const sheet = page.getByTestId("feeding-sheet");
    await expect(sheet.locator(".sheet-toggle")).toHaveCount(0);
    expect(await sheet.locator("thead").evaluate((el) => getComputedStyle(el).display)).toBe("table-header-group");
    expect(await sheet.locator("tbody tr").first().evaluate((el) => getComputedStyle(el).display)).toBe("table-row");
    await expect(sheet.locator(".sheet-cell-label")).toHaveCount(0);
    await expect(sheet.locator(".hint").first()).toContainText("Kattints egy sorra");
  });
});
