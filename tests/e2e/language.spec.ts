// t-20261117-caparium-angol-alap (Lili 2026-11-17, acrobot 54635): one account serves a Hungarian colleague and a foreign
// student in turn, so the language is the device's: the header's HU/EN switch, remembered on the device across a reload;
// the profile's language is only the default a device without a choice gets at login. Since Lili's first sheet
// (t-20261118-caparium-angol-1) the Start page's heading has its English, so an English page shows it; a text without English
// still falls back to Hungarian, which tests/unit/i18n.test.ts pins (that list shrinks with every sheet, so the e2e does not name
// one). What is measured here is the choice, its memory and its default. The user's default is set back at the end.
import { expect, test, type Browser, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_TEST_PASSWORD ?? "";
const USER = "teszt.akvarista2";

async function login(page: Page) {
  await page.goto("/belepes");
  await page.getByLabel("Felhasználónév").fill(USER);
  await page.getByLabel("Jelszó").fill(PASSWORD);
  await page.getByRole("button", { name: "Bejelentkezés" }).click();
  // the device's language decides the heading: a device that gets the English default lands on the English Start
  await expect(page.getByRole("heading", { name: /^(Jó munkát!|Keep up the good work!)$/ })).toBeVisible();
}

async function setDefault(page: Page, value: "HU" | "EN") {
  await page.goto("/profil");
  const box = page.getByTestId("own-language");
  await box.getByLabel("Alapértelmezett nyelv").selectOption(value);
  if (await box.getByRole("button", { name: "Nyelv mentése" }).isEnabled()) {
    await box.getByRole("button", { name: "Nyelv mentése" }).click();
    await expect(box.getByRole("status")).toHaveText("Nyelv mentve.");
  }
}

async function freshDevice(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

test.beforeAll(() => {
  if (!PASSWORD) throw new Error("SEED_TEST_PASSWORD must be set for the e2e run");
});

test("the header's HU/EN switch: the device's choice, kept across a reload; the page reads the dictionary", async ({ browser }) => {
  const { context, page } = await freshDevice(browser);
  try {
    await login(page);
    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", "hu");
    await expect(page.getByTestId("lang-hu")).toHaveAttribute("aria-pressed", "true");
    // the Hungarian header is unchanged (Lili 2026-11-18): CÁPÁRIUM over nAPPló
    await expect(page.locator(".brand-title")).toHaveText("CÁPÁRIUM");
    await expect(page.locator(".brand-sub")).toHaveText("nAPPló");
    await page.getByTestId("lang-en").click();
    await expect(html).toHaveAttribute("lang", "en");
    await expect(page.getByTestId("lang-en")).toHaveAttribute("aria-pressed", "true");
    // the switch's own words are in the dictionary: the group is named in English
    await expect(page.getByTestId("lang-switch")).toHaveAttribute("aria-label", "Language");
    // the page's own text comes from the dictionary (Lili's sheet): the Start heading in English
    await expect(page.getByRole("heading", { name: "Keep up the good work!" })).toBeVisible();
    // and the menu's labels, translated where shown (src/lib/nav.ts on the guard's list)
    await expect(page.getByRole("link", { name: "Daily WQ", exact: true }).first()).toBeVisible();
    await page.reload();
    await expect(html).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { name: "Keep up the good work!" })).toBeVisible();
    await expect(page.getByTestId("lang-en")).toHaveAttribute("aria-pressed", "true");
    // a wrapped module reads the dictionary too: the WQ diary (t-20261118-caparium-angol-naplo)
    await page.goto("/naplo");
    await expect(page.getByRole("heading", { name: "Recorded measurements" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Filter" })).toBeVisible();
    // a measurement's name is data, translated where shown (Lili 2026-11-18 13:08 UTC: Salinity in the daily table's header)
    await page.goto("/vizmeres?csoport=NAPI_NAGY");
    await expect(page.getByRole("columnheader", { name: /^Salinity/ })).toBeVisible();
    // the header in English (Lili 2026-11-18): Shark Nursery big, SnAPPs' (the apostrophe is the word's) below it
    await expect(page.locator(".brand-title")).toHaveText("Shark Nursery");
    await expect(page.locator(".brand-sub")).toHaveText("SnAPPs'");
    // the removed-feed page's header chip key: Removed:, not Except:
    await page.goto("/kivetel");
    await expect(page.locator(".head-chip")).toContainText("Removed:");
    await expect(page.locator(".head-chip")).not.toContainText("Except:");
    await page.goto("/");
    await page.getByTestId("lang-hu").click();
    await expect(html).toHaveAttribute("lang", "hu");
    await expect(page.getByRole("heading", { name: "Jó munkát!" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("the profile's language is the default a device without a choice gets at login; a device's own choice wins", async ({ browser }) => {
  const first = await freshDevice(browser);
  try {
    await login(first.page);
    await setDefault(first.page, "EN");
    // this device chose HU at login (the default was HU then): its own choice stays
    await first.page.reload();
    await expect(first.page.locator("html")).toHaveAttribute("lang", "hu");
    // a device with no choice yet gets the user's default at login
    const second = await freshDevice(browser);
    try {
      await login(second.page);
      await expect(second.page.locator("html")).toHaveAttribute("lang", "en");
      await expect(second.page.getByTestId("lang-en")).toHaveAttribute("aria-pressed", "true");
    } finally {
      await second.context.close();
    }
  } finally {
    await setDefault(first.page, "HU");
    await first.context.close();
  }
});
