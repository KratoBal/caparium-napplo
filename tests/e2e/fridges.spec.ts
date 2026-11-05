// Lili 2026-11-02 (task caparium-hutok): the fridges' temperature book on the real pages. An admin adds a fridge in Beállítások,
// an aquarist records it on the daily water page under the big pools' table: red already while an out-of-range value is typed,
// red in the saved row; the export page offers the book apart from the water exports. The server rules, the range kept per
// reading, the correction and the files are measured in tests/integration/fridges.test.ts.
import { expect, test, type Page } from "@playwright/test";
import { openAllSettings } from "../support/settings-folds";

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

test("a fridge added in the settings is recorded behind the Fagyasztók hőmérséklete tile; out of range is red", async ({ page, browser }, info) => {
  // a fridge of its own per project and per attempt, so a retry or the other project does not find this one's readings
  const name = `E2E hűtő ${info.project.name} ${info.retry}`;
  await login(page, "teszt.admin");
  await page.goto("/beallitasok");
  await openAllSettings(page);
  const box = page.getByTestId("new-fridge");
  await box.getByLabel("Név").fill(name);
  await box.getByLabel("Minimum (°C)").fill("2");
  await box.getByLabel("Maximum (°C)").fill("8");
  await box.getByRole("button", { name: "Hűtő felvétele" }).click();
  await expect(box.getByRole("status")).toHaveText("Felvéve.");
  await expect(page.getByTestId(`fridge-setting-${name}`)).toBeVisible();

  const aq = await browser.newPage();
  await login(aq, "teszt.akvarista1");
  // Lili 2026-11-03 (task caparium-fagyaszto-csempe): the card is no longer under the big pools' table; the third tile
  // opens it, and its corner mark says a fridge has no reading yet today
  await aq.goto("/vizmeres?csoport=NAPI_NAGY");
  await expect(aq.getByTestId("fridge-card")).toHaveCount(0);
  const tile = aq.getByTestId("fridge-tile");
  await expect(tile.getByTestId("fridge-alert")).toHaveAttribute("aria-label", /még nincs beírva/);
  await tile.click();
  await expect(aq).toHaveURL(/\/vizmeres\/hutok\?nap=/);
  await expect(aq.getByTestId("fridge-tile")).toHaveAttribute("aria-selected", "true");
  const card = aq.getByTestId("fridge-card");
  const row = card.getByTestId(`fridge-${name}`);
  const temp = row.getByLabel(`${name} hőmérséklete (°C)`);
  await temp.fill("9,5");
  await expect(temp).toHaveAttribute("aria-invalid", "true");
  await row.getByLabel(`${name}: leolvasztás`).check();
  await row.getByLabel(`${name}: megjegyzés`).fill("ajtó nyitva maradt");
  await row.getByRole("button", { name: "Mentés" }).click();
  await expect(row.getByRole("status")).toHaveText("Mentve; a hőmérséklet a tartományon kívül van.");
  const saved = card.getByTestId("fridge-reading").filter({ hasText: "ajtó nyitva maradt" });
  await expect(saved).toHaveCount(1);
  await expect(saved.locator("td.fridge-out")).toHaveText("9,5 °C");
  await expect(saved).toContainText("Leolvasztás");
  // after a reload the mark names the out-of-range reading
  await aq.reload();
  await expect(aq.getByTestId("fridge-alert")).toHaveAttribute("aria-label", /tartományon kívüli érték/);

  // the small tanks' table has no fridge card
  await aq.goto("/vizmeres?csoport=NAPI_KIS");
  await expect(aq.getByTestId("fridge-card")).toHaveCount(0);

  await aq.goto("/export");
  await expect(aq.getByTestId("fridge-export").getByRole("button", { name: /^Excel/ })).toBeVisible();
  await expect(aq.getByTestId("fridge-export").getByRole("button", { name: /^PDF/ })).toBeVisible();
  await aq.close();
});

// Lili 2026-11-05: the iPhone's decimal keypad has no minus sign. A sign button sits beside every reading field; a freezer starts
// on minus, a fridge on plus, and what is typed as 20 in a freezer is saved as -20. Run on the phone and on the tablet projects.
test("the sign button: a freezer's 18 is saved as -18, a fridge starts on plus, the button flips both", async ({ page, browser }, info) => {
  const freezer = `E2E fagyasztó ${info.project.name} ${info.retry}`;
  const fridge = `E2E hűtő előjel ${info.project.name} ${info.retry}`;
  await login(page, "teszt.admin");
  await page.goto("/beallitasok");
  await openAllSettings(page);
  const box = page.getByTestId("new-fridge");
  await box.getByLabel("Név").fill(freezer);
  await box.getByLabel("Új hűtő fajtája").selectOption("FREEZER");
  await box.getByLabel("Minimum (°C)").fill("-23");
  await box.getByLabel("Maximum (°C)").fill("-18");
  await box.getByRole("button", { name: "Hűtő felvétele" }).click();
  await expect(box.getByRole("status")).toHaveText("Felvéve.");
  await box.getByLabel("Név").fill(fridge);
  await box.getByLabel("Új hűtő fajtája").selectOption("FRIDGE");
  await box.getByLabel("Minimum (°C)").fill("2");
  await box.getByLabel("Maximum (°C)").fill("8");
  await box.getByRole("button", { name: "Hűtő felvétele" }).click();
  await expect(box.getByRole("status")).toHaveText("Felvéve.");

  const aq = await browser.newPage();
  await login(aq, "teszt.akvarista1");
  await aq.goto("/vizmeres?csoport=NAPI_NAGY");
  await aq.getByTestId("fridge-tile").click();
  const card = aq.getByTestId("fridge-card");

  // the freezer: the button starts on minus, the digits typed without a sign are in range and saved negative
  const fRow = card.getByTestId(`fridge-${freezer}`);
  await expect(fRow.getByTestId("sign-toggle")).toHaveText("−");
  await expect(fRow.getByTestId("sign-toggle")).toHaveAttribute("aria-pressed", "true");
  const fTemp = fRow.getByLabel(`${freezer} hőmérséklete (°C)`);
  await fTemp.fill("20");
  await expect(fTemp).not.toHaveAttribute("aria-invalid", "true");
  await fRow.getByRole("button", { name: "Mentés" }).click();
  await expect(fRow.getByRole("status")).toHaveText("Mentve.");
  await expect(card.getByTestId("fridge-reading").filter({ hasText: /-20/ })).toHaveCount(1);

  // pressing the button turns the freezer's sign to plus: 5 is then a warm reading, out of range
  await fRow.getByTestId("sign-toggle").click();
  await expect(fRow.getByTestId("sign-toggle")).toHaveText("+");
  await fTemp.fill("5");
  await expect(fTemp).toHaveAttribute("aria-invalid", "true");

  // the fridge: the button starts on plus, a typed 4 is in range; pressing the button makes it -4, out of range
  const rRow = card.getByTestId(`fridge-${fridge}`);
  await expect(rRow.getByTestId("sign-toggle")).toHaveText("+");
  const rTemp = rRow.getByLabel(`${fridge} hőmérséklete (°C)`);
  await rTemp.fill("4");
  await expect(rTemp).not.toHaveAttribute("aria-invalid", "true");
  await rRow.getByTestId("sign-toggle").click();
  await expect(rRow.getByTestId("sign-toggle")).toHaveText("−");
  await expect(rTemp).toHaveAttribute("aria-invalid", "true");
  // a minus typed on a keyboard still works and wins over the button
  await rTemp.fill("-3");
  await expect(rRow.getByTestId("sign-toggle")).toHaveText("−");
  await aq.close();
});

// Lili 2026-11-05: the Beállítások range fields get the same sign button (a freezer's range is negative, the phone keypad has no
// minus). A new freezer's range typed without a minus (23 and 18) is saved as -23 and -18; a fridge's stays plus; the button flips.
test("the range fields' sign button: a freezer's 23..18 is saved as -23..-18, the button flips a field", async ({ page }, info) => {
  const freezer = `E2E tartomány ${info.project.name} ${info.retry}`;
  await login(page, "teszt.admin");
  await page.goto("/beallitasok");
  await openAllSettings(page);
  const box = page.getByTestId("new-fridge");
  await box.getByLabel("Név").fill(freezer);
  await box.getByLabel("Új hűtő fajtája").selectOption("FREEZER");
  // both range buttons start on minus for a freezer
  await expect(box.getByTestId("sign-toggle").nth(0)).toHaveText("−");
  await expect(box.getByTestId("sign-toggle").nth(1)).toHaveText("−");
  await box.getByLabel("Minimum (°C)").fill("23");
  await box.getByLabel("Maximum (°C)").fill("18");
  await box.getByRole("button", { name: "Hűtő felvétele" }).click();
  await expect(box.getByRole("status")).toHaveText("Felvéve.");
  const row = page.getByTestId(`fridge-setting-${freezer}`);
  await expect(row.getByLabel(`${freezer} minimuma (°C)`)).toHaveValue(/^-23/);
  await expect(row.getByLabel(`${freezer} maximuma (°C)`)).toHaveValue(/^-18/);
  // the row's button flips the saved minus to plus (text without the sign, the button on plus)
  await row.getByTestId("sign-toggle").nth(1).click();
  await expect(row.getByTestId("sign-toggle").nth(1)).toHaveText("+");
  await expect(row.getByLabel(`${freezer} maximuma (°C)`)).toHaveValue(/^18/);
  // a fridge's range fields start on plus
  await box.getByLabel("Új hűtő fajtája").selectOption("FRIDGE");
  await expect(box.getByTestId("sign-toggle").nth(0)).toHaveText("+");
});
