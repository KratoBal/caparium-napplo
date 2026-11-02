// Lili 2026-11-02, keying in old data on an iPhone (acrobot 40123..40125, 40253; task caparium-regi-nap-e2e): an old withdrawal day
// closed by itself between her rows while the page still said "Nyitott", and its "Nap lezárása" was refused. The cause was the
// difference between the page and the server: only a browser test sees it. Here Lili's path: an old day on Takarmánykivétel and on
// the daily water page, rows keyed in with the scheduled close running between them, the page "Nyitott (visszamenőleges bevitel)"
// throughout, and one close at the end that works. And an old dosing that leaves today's chemical stock and the "fogy" notice as
// they were. The scheduled close is the server's own minute job; the test runs it directly (runJournalJob), so nobody waits a minute.
import { expect, test, type Page } from "@playwright/test";
import { runJournalJob } from "../../src/lib/journal";

const PASSWORD = process.env.SEED_TEST_PASSWORD ?? "";
const BACKFILL = "Nyitott (visszamenőleges bevitel)";

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

// an old day of its own per project and per attempt: the test closes it, and a retry must find it untouched
const oldDay = (project: string, retry: number, base: number) => `2019-04-${String(base + (project === "tablet" ? 0 : 1) + 2 * retry).padStart(2, "0")}`;

test("an old withdrawal day: three rows with the scheduled close between them, open all along, closed once at the end", async ({ page }, info) => {
  const day = oldDay(info.project.name, info.retry, 1);
  await login(page, "teszt.admin");
  await page.goto(`/kivetel?nap=${day}`);
  const status = page.getByTestId("day-status");
  const form = page.getByTestId("withdrawal-form");
  for (const [i, feed] of ["Teszt hal", "Teszt kagyló", "Teszt hal"].entries()) {
    await form.getByLabel("Takarmány", { exact: true }).selectOption({ label: feed });
    // the third row: the same feed for another use day (one item per feed and use day)
    if (i === 2) await form.getByLabel("Felhasználás napja", { exact: true }).fill(day);
    await form.getByLabel("Mennyiség (tömeg)", { exact: true }).fill(String(100 + i));
    await form.getByRole("button", { name: "Kivétel mentése" }).click();
    await expect(form.getByRole("status")).toHaveText("Kivétel mentve.");
    // the page as it stands after the save says what the server holds
    await expect(status).toContainText(BACKFILL);
    // the minute job between two rows: it used to close the day here
    await runJournalJob();
    await page.reload();
    await expect(status).toContainText(BACKFILL);
  }
  await expect(page.getByTestId("withdrawal-list").getByRole("row")).toHaveCount(4); // the header and three rows
  await status.getByRole("button", { name: "Nap lezárása" }).click();
  await expect(status).toContainText("Lezárva");
  await expect(page.getByText("Csak újranyitott napot lehet kézzel lezárni.")).toHaveCount(0);
  await runJournalJob();
  await page.reload();
  await expect(status).toContainText("Lezárva");
});

test("an old water day: a value, the scheduled close, still open, closed once by hand", async ({ page }, info) => {
  const day = oldDay(info.project.name, info.retry, 11);
  await login(page, "teszt.admin");
  await page.goto(`/vizmeres?csoport=NAPI_NAGY&nap=${day}`);
  const status = page.getByTestId("day-status");
  await page.getByRole("button", { name: "Nagymedence", exact: true }).click();
  await page.getByTestId("cell-Nagymedence-pH").fill("8,1");
  await page.getByTestId("save-all").click();
  await expect(page.getByTestId("banner")).toHaveText("Minden érték mentve.");
  await expect(status).toContainText(BACKFILL);
  await runJournalJob();
  await page.reload();
  await expect(status).toContainText(BACKFILL);
  await status.getByRole("button", { name: "Nap lezárása" }).click();
  await expect(status).toContainText("Lezárva");
  await runJournalJob();
  await page.reload();
  await expect(status).toContainText("Lezárva");
});

test("an old dosing leaves today's chemical stock and the 'fogy' notice as they were", async ({ page }, info) => {
  const stamp = `${oldDay(info.project.name, info.retry, 21)}T09:00`;
  await login(page, "teszt.admin");
  const notice = async () => ((await page.getByTestId("notice-stock").count()) ? await page.getByTestId("notice-stock").innerText() : "");
  const before = { notice: await notice() };
  await page.goto("/adagolas");
  const row = page.getByTestId("stock").getByRole("row").filter({ hasText: "Teszt kalcium" });
  const stockBefore = await row.innerText();
  const form = page.getByTestId("dosing-form");
  await form.getByLabel("Időpont").fill(stamp);
  await form.getByLabel("Medence", { exact: true }).selectOption({ label: "Sózó" });
  await form.getByLabel("Szer", { exact: true }).selectOption({ label: "Teszt kalcium" });
  await form.getByLabel("Mennyiség", { exact: true }).fill("5");
  await form.getByLabel("Egység", { exact: true }).selectOption({ label: "l" });
  await form.getByRole("button", { name: "+ Adagolás mentése" }).click();
  await expect(form.getByRole("status")).toHaveText("Adagolás mentve.");
  await page.reload();
  // the same reading on both sides (innerText keeps the cells' tabs): the level, the week and the month as they were
  await expect.poll(() => row.innerText()).toBe(stockBefore);
  await page.goto("/");
  expect(await notice()).toBe(before.notice);
});
