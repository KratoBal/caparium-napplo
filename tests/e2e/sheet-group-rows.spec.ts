// Lili 2026-10-30 (msg 1565798789183447103 and 1565799264188371058, task caparium-csoport-sor; acrobot 38947): on TODAY's feeding sheet an animal that
// is in a group has no row of its own, the group's row stands for it; an animal that already has an individual item keeps its row, with the note
// "csoporttag, egyedi tétellel"; an animal outside every group is a row of its own; an earlier day is as it was. The rows' rule itself is
// measured in tests/unit/sheet-recipients.test.ts; here it is the real page. Teszt Egy and Teszt Kettő are the seed's group members ("Teszt
// csoport"), Teszt Három is outside every group. Other tests leave individual items of the group members behind, so the first half reads
// each member's item state and asserts the matching side, and the second half makes sure Teszt Egy has an item and asserts the note.
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_TEST_PASSWORD ?? "";
const NOTE = "csoporttag, egyedi tétellel";

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

// the animals on the day's list, Mysis chosen as the day's feed, the list finalized: the sheet is there
async function prepare(page: Page, url: string, animals: string[]) {
  page.on("dialog", (d) => void d.accept());
  await page.goto(url);
  for (const a of animals) {
    const box = page.getByLabel(`${a} a mai listán`);
    await expect(box).toBeVisible();
    if (!(await box.isChecked())) {
      await box.check();
      await expect(box).toBeChecked();
      await page.waitForLoadState("networkidle");
    }
  }
  const dayFeeds = page.getByTestId("day-feeds");
  await dayFeeds.getByLabel("A nap takarmánya: Mysis").check();
  const saveFeeds = dayFeeds.getByRole("button", { name: "A nap takarmányainak mentése" });
  const ready = dayFeeds.getByRole("button", { name: "Takarmánylap kész" });
  if (await saveFeeds.count()) await saveFeeds.click();
  else if (await ready.count()) await ready.click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("feeding-sheet").getByRole("columnheader", { name: /^Mysis/ })).toBeVisible();
}

const sheetRow = (page: Page, name: string) =>
  page.getByTestId("feeding-sheet").getByRole("row").filter({ has: page.getByRole("cell", { name, exact: true }) });

// whether the "Mai tételek" list shows an item on the animal's line
async function hasItem(page: Page, name: string): Promise<boolean> {
  const cell = page.getByTestId("feeding-list").getByRole("row").filter({ hasText: name }).locator("td").nth(1);
  return ((await cell.innerText()).trim() !== "");
}

test("today: a group member has no row of its own unless it has an individual item (then with the note); an animal outside every group has one", async ({ page }) => {
  await login(page, "teszt.admin");
  await prepare(page, "/etetes", ["Teszt Egy", "Teszt Kettő", "Teszt Három"]);
  const sheet = page.getByTestId("feeding-sheet");
  // the group's row stands for its members; the animal outside every group is a row of its own, without a note
  await expect(sheetRow(page, "Teszt csoport (csoport)")).toHaveCount(1);
  await expect(sheetRow(page, "Teszt Három")).toHaveCount(1);
  await expect(sheetRow(page, "Teszt Három")).not.toContainText(NOTE);
  // each group member: no row without an item, the row with the note with one
  for (const member of ["Teszt Egy", "Teszt Kettő"]) {
    if (await hasItem(page, member)) {
      await expect(sheetRow(page, member), `${member} has an item: its row stays`).toHaveCount(1);
      await expect(sheetRow(page, member)).toContainText(NOTE);
    } else {
      await expect(sheetRow(page, member), `${member} has no item: the group's row stands for it`).toHaveCount(0);
    }
  }
  // make sure Teszt Egy has an individual item, through the item form, and the row must be there with the note
  if (!(await hasItem(page, "Teszt Egy"))) {
    const item = page.getByTestId("item-form");
    await item.getByLabel("Kinek", { exact: true }).selectOption({ label: "Teszt Egy" });
    await item.getByLabel("Takarmány", { exact: true }).selectOption({ label: "Mysis" });
    await item.getByLabel("Mennyiség (tömeg)", { exact: true }).fill("5");
    await item.getByRole("button", { name: "Tétel mentése" }).click();
    await expect(item.getByRole("status")).toHaveText("Tétel mentve.");
    await page.reload();
  }
  await expect(sheetRow(page, "Teszt Egy")).toHaveCount(1);
  await expect(sheetRow(page, "Teszt Egy")).toContainText(NOTE);
  // the row with the note is a row as any: its cell is the item's, and the sheet still names the group member in its aria name only
  await expect(sheet.getByRole("cell", { name: "Teszt Egy", exact: true })).toHaveCount(1);
  await expect(sheet.getByTestId("sheet-cell-Teszt Egy-Mysis")).toBeVisible();
});

test("an earlier day is as it was: the group member has its row, and the group its own", async ({ page }, info) => {
  const day = budapestDay(info.project.name === "tablet" ? -58 : -60);
  await login(page, "teszt.admin");
  await prepare(page, `/etetes?nap=${day}`, ["Teszt Egy"]);
  await expect(sheetRow(page, "Teszt Egy"), "an earlier day keeps every selected animal's row").toHaveCount(1);
  await expect(sheetRow(page, "Teszt Egy")).not.toContainText(NOTE);
  await expect(sheetRow(page, "Teszt csoport (csoport)")).toHaveCount(1);
});
