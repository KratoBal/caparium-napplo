// t-20261117-caparium-angol-alap (Lili 2026-11-17, acrobot 54635): one account serves a Hungarian colleague and a foreign
// student in turn, so the language is the device's: the header's HU/EN switch, remembered on the device across a reload;
// the profile's language is only the default a device without a choice gets at login. Until Lili's English arrives the
// dictionary holds only the switch's own words, so the page text stays Hungarian on an English device (the fallback);
// what is measured here is the choice, its memory and its default. The user's default is set back at the end.
import { expect, test, type Browser, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_TEST_PASSWORD ?? "";
const USER = "teszt.akvarista2";

async function login(page: Page) {
  await page.goto("/belepes");
  await page.getByLabel("Felhasználónév").fill(USER);
  await page.getByLabel("Jelszó").fill(PASSWORD);
  await page.getByRole("button", { name: "Bejelentkezés" }).click();
  await expect(page.getByRole("heading", { name: "Jó munkát!" })).toBeVisible();
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

test("the header's HU/EN switch: the device's choice, kept across a reload; the page falls back to Hungarian", async ({ browser }) => {
  const { context, page } = await freshDevice(browser);
  try {
    await login(page);
    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", "hu");
    await expect(page.getByTestId("lang-hu")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("lang-en").click();
    await expect(html).toHaveAttribute("lang", "en");
    await expect(page.getByTestId("lang-en")).toHaveAttribute("aria-pressed", "true");
    // the switch's own words are in the dictionary: the group is named in English
    await expect(page.getByTestId("lang-switch")).toHaveAttribute("aria-label", "Language");
    // a text without English yet stays Hungarian, nothing breaks
    await expect(page.getByRole("heading", { name: "Jó munkát!" })).toBeVisible();
    await page.reload();
    await expect(html).toHaveAttribute("lang", "en");
    await expect(page.getByTestId("lang-en")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("lang-hu").click();
    await expect(html).toHaveAttribute("lang", "hu");
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
