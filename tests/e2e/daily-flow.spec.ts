// The first working flow (feladat-4, 4. pont): login -> pool group -> record -> saved in the DB -> log.
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const PASSWORD = process.env.SEED_TEST_PASSWORD ?? "";

async function login(page: Page, loginId: string) {
  await page.goto("/belepes");
  await page.getByLabel("Felhasználónév").fill(loginId);
  await page.getByLabel("Jelszó").fill(PASSWORD);
  await page.getByRole("button", { name: "Bejelentkezés" }).click();
  await expect(page.getByRole("heading", { name: "Jó munkát!" })).toBeVisible();
}

// each layout writes its own group, so the two projects never touch the same cell
function plan(projectName: string) {
  return projectName === "tablet"
    ? { tab: "Kismedencék", pool: "Korallos" }
    : { tab: "Nagy medencék", pool: "Nagymedence" };
}

test.beforeAll(() => {
  if (!PASSWORD) throw new Error("SEED_TEST_PASSWORD must be set for the e2e run");
});

test("login, record a daily measurement, it survives a reload and shows in the log with history", async ({ page }, info) => {
  const p = plan(info.project.name);
  await login(page, "teszt.akvarista1");

  await page.getByRole("link", { name: "Napi vízmérés" }).first().click();
  await page.getByRole("tab", { name: p.tab }).click();
  await expect(page.getByRole("heading", { name: /Napi paraméterek/ })).toBeVisible();

  // the first pool is the active row; tap it anyway, as on the tablet
  await page.getByRole("button", { name: p.pool, exact: true }).click();
  const ph = page.getByTestId(`cell-${p.pool}-pH`);
  await ph.fill("7,88");
  await ph.press("Enter");
  await expect(page.getByTestId(`cell-${p.pool}-pH`)).toHaveClass(/out/);
  await expect(page.getByText("Eltérés a referenciaértéktől")).toBeVisible();

  const sal = page.getByTestId(`cell-${p.pool}-Sűrűség`);
  await sal.fill("35,0");
  await page.getByTestId("save-all").click();
  await expect(page.getByTestId("banner")).toHaveText("Minden érték mentve.");

  // persisted in the database, not in the browser
  await page.reload();
  await expect(page.getByTestId(`cell-${p.pool}-pH`)).toHaveValue("7,88");
  await expect(page.getByTestId(`cell-${p.pool}-Sűrűség`)).toHaveValue("35");

  // the log finds it, and the history shows who recorded it
  await page.getByRole("link", { name: "Vízmérési napló" }).first().click();
  const row = page.getByTestId("log-table").getByRole("row").filter({ hasText: p.pool }).filter({ hasText: "pH" }).first();
  await expect(row).toContainText("7,88");
  await expect(row.locator(".value-out")).toBeVisible();
  await row.getByRole("link").click();
  await expect(page.getByTestId("history-entry").first()).toContainText("Rögzítés");
  await expect(page.getByTestId("history-entry").first()).toContainText("Teszt Akvarista Egy");
});

test("an aquarist sees an earlier day read-only", async ({ page }) => {
  await login(page, "teszt.akvarista2");
  await page.goto("/vizmeres?nap=2026-01-05");
  await expect(page.getByText("Korábbi nap: csak megtekintés.")).toBeVisible();
  await expect(page.getByTestId("save-all")).toHaveCount(0);
  await expect(page.locator("input.cell-input")).toHaveCount(0);
});

test("a second editor of the same cell gets a conflict, not a silent overwrite", async ({ browser }, info) => {
  const p = plan(info.project.name);
  const a = await browser.newPage();
  const b = await browser.newPage();
  await login(a, "teszt.akvarista1");
  await login(b, "teszt.akvarista2");
  for (const page of [a, b]) {
    await page.goto("/vizmeres");
    await page.getByRole("tab", { name: p.tab }).click();
    await page.getByRole("button", { name: p.pool, exact: true }).click();
  }
  // a writes ORP first; b's page still shows the empty cell and writes too
  const orpA = a.getByTestId(`cell-${p.pool}-ORP`);
  await orpA.fill("305");
  await orpA.press("Enter");
  await expect(a.getByTestId(`cell-${p.pool}-ORP`)).toHaveValue("305");
  await a.waitForLoadState("networkidle");
  const orpB = b.getByTestId(`cell-${p.pool}-ORP`);
  await orpB.fill("310");
  await orpB.press("Enter");
  await expect(b.getByTestId("conflict")).toBeVisible();
  await expect(b.getByTestId("conflict")).toContainText("305");
  await b.getByRole("button", { name: "Friss adat betöltése" }).click();
  await expect(b.getByTestId(`cell-${p.pool}-ORP`)).toHaveValue("305");
  await a.close();
  await b.close();
});

test("weekly measurement: value with dilution and RO/SW, kept after a reload, shown in the log", async ({ page }, info) => {
  const pool = info.project.name === "tablet" ? "Korallos" : "Nagymedence";
  await login(page, "teszt.akvarista1");
  await page.getByRole("link", { name: "Heti vízmérés" }).first().click();
  await expect(page.getByRole("heading", { name: "Heti vízmérések" })).toBeVisible();
  await page.getByRole("button", { name: pool, exact: true }).click();

  // the dilution and RO/SW pickers belong to the nitrate and the phosphate only (caparium-hibak-1), in EVERY
  // pool's row, not only the active one (caparium-hibak-2: Balázs saw them under one pool at a time)
  for (const p of ["Nagymedence", "Kismedence", "Karantén", "Korallos", "Inkubátor", "Ragadozós"]) {
    for (const param of ["NO3", "PO4"]) {
      await expect(page.getByTestId(`dilution-${p}-${param}`), `${p} ${param}`).toBeVisible();
      await expect(page.getByTestId(`diluent-${p}-${param}`), `${p} ${param}`).toBeVisible();
    }
    await expect(page.getByTestId(`dilution-${p}-KH`)).toHaveCount(0);
  }
  // a pick in another pool's row makes that row the active one, so its value can be typed
  await page.getByTestId("diluent-Ragadozós-PO4").selectOption("SW");
  await expect(page.getByTestId("cell-Ragadozós-PO4")).toBeVisible();
  await page.getByRole("button", { name: pool, exact: true }).click();
  const no3 = page.getByTestId(`cell-${pool}-NO3`);
  await no3.fill("8,4");
  await page.getByTestId(`dilution-${pool}-NO3`).selectOption("10");
  await page.getByTestId(`diluent-${pool}-NO3`).selectOption("RO");
  await page.getByTestId("save-all").click();
  await expect(page.getByTestId("banner")).toHaveText("Minden érték mentve.");

  await page.reload();
  await page.getByRole("button", { name: pool, exact: true }).click();
  await expect(page.getByTestId(`cell-${pool}-NO3`)).toHaveValue("8,4");
  await expect(page.getByTestId(`dilution-${pool}-NO3`)).toHaveValue("10");
  await expect(page.getByTestId(`diluent-${pool}-NO3`)).toHaveValue("RO");

  await page.getByRole("link", { name: "Vízmérési napló" }).first().click();
  const row = page.getByTestId("log-table").getByRole("row").filter({ hasText: pool }).filter({ hasText: "NO3" }).first();
  await expect(row).toContainText("8,4");
  await expect(row).toContainText("1:10, RO");
});

function budapestDay(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest" }).format(d);
}

test("admin corrects and invalidates an earlier day's measurement with a reason; an aquarist gets no form", async ({ page, browser }, info) => {
  const pool = info.project.name === "tablet" ? "Inkubátor" : "Ragadozós";
  const yesterday = budapestDay(-1);
  page.on("dialog", (d) => void (d.type() === "prompt" ? d.accept("papírról utólag bevitt mérés") : d.accept()));

  await login(page, "teszt.admin");
  await page.goto(`/vizmeres?csoport=NAPI_KIS&nap=${yesterday}`);
  await expect(page.getByText("Korábbi nap: minden módosításhoz indoklás kell")).toBeVisible();
  await page.getByRole("button", { name: pool, exact: true }).click();
  const ph = page.getByTestId(`cell-${pool}-pH`);
  await ph.fill("8,05");
  await ph.press("Enter");
  await expect(page.getByTestId(`cell-${pool}-pH`)).toHaveValue("8,05");
  await page.waitForLoadState("networkidle");

  await page.goto(`/naplo?tol=${yesterday}&ig=${yesterday}`);
  const row = page.getByTestId("log-table").getByRole("row").filter({ hasText: pool }).filter({ hasText: "pH" }).first();
  await row.getByRole("link").click();
  await page.waitForURL(/\/naplo\/[0-9a-f-]{36}$/);
  const historyUrl = page.url();
  await expect(page.getByTestId("correction")).toContainText("Adminisztrátori művelet");
  await page.getByLabel("Új érték").fill("8,07");
  await page.getByLabel(/Indoklás/).fill("mérőműszer adatának helyesbítése");
  await page.getByRole("button", { name: "Változtatás naplózása" }).click();
  await expect(page.getByTestId("history-value")).toContainText("8,07");
  const update = page.getByTestId("history-entry").filter({ hasText: "Módosítás" });
  await expect(update).toContainText("8.05 → 8.07");
  await expect(update).toContainText("mérőműszer adatának helyesbítése");

  // an aquarist sees the history, but no correction form for someone else's earlier entry
  const other = await browser.newPage();
  await login(other, "teszt.akvarista1");
  await other.goto(historyUrl);
  await expect(other.getByTestId("correction-denied")).toBeVisible();
  await expect(other.getByTestId("correction")).toHaveCount(0);
  await other.close();

  await page.getByLabel("Az érvénytelenítés oka").fill("rossz medencébe került");
  await page.getByRole("button", { name: "Érvénytelenítés" }).click();
  await expect(page.getByTestId("history-status")).toHaveText("érvénytelenített");
  await expect(page.getByTestId("history-entry").filter({ hasText: "Érvénytelenítés" })).toContainText("rossz medencébe került");
});

test("the pending list is for admins; an aquarist is sent to the no-access page", async ({ page }) => {
  await login(page, "teszt.admin");
  await page.getByRole("link", { name: "Függő mentések" }).click();
  await expect(page.getByRole("heading", { name: "Késve érkezett mentések" })).toBeVisible();
  await page.getByRole("button", { name: "Kilépés" }).click();
  await login(page, "teszt.akvarista2");
  await expect(page.getByRole("link", { name: "Függő mentések" })).toHaveCount(0);
  await page.goto("/fuggo");
  await expect(page.getByTestId("no-access")).toBeVisible();
});

test("the day's lock is shown on the grid", async ({ page }) => {
  await login(page, "teszt.akvarista1");
  await page.goto("/vizmeres");
  await expect(page.getByTestId("day-status")).toContainText("Nyitott");
});

test("settings: an admin changes a reference range and creates a user who can log in", async ({ page }, info) => {
  const tablet = info.project.name === "tablet";
  const login1 = tablet ? "uj.akvarista.t" : "uj.akvarista.d";
  await login(page, "teszt.admin");
  await page.getByRole("link", { name: "Beállítások" }).click();
  await expect(page.getByRole("heading", { name: "Vízparaméterek és referenciaértékek" })).toBeVisible();

  const row = page.getByTestId("ref-NO3");
  await row.getByLabel("NO3 maximum").fill(tablet ? "5" : "4");
  await row.getByRole("button", { name: "Mentés" }).click();
  await expect(row.getByRole("status")).toHaveText("Mentve.");
  await page.waitForLoadState("networkidle"); // the save refreshes the page; let it finish first

  // a value outside the old range (max 10) AND the new one: the grid sends the measurement time
  // rounded to the minute, so within the same minute the measurement may still bind the old range
  const pool = tablet ? "Korallos" : "Nagymedence";
  await page.goto("/heti");
  await page.getByRole("button", { name: pool, exact: true }).click();
  const no3 = page.getByTestId(`cell-${pool}-NO3`);
  await no3.fill("12");
  await no3.press("Enter");
  await expect(page.getByTestId(`cell-${pool}-NO3`)).toHaveClass(/out/);

  await page.goto("/beallitasok");
  const nu = page.getByTestId("new-user");
  await nu.getByLabel("Új felhasználónév").fill(login1);
  await nu.getByLabel("Teljes név").fill("Új Akvarista");
  await nu.getByLabel("Monogram").fill(tablet ? "UT" : "UD");
  await nu.getByLabel("ZIMS-név").fill("New Aquarist");
  await nu.getByLabel("Kezdő jelszó").fill("uj-akvarista-jelszo");
  await nu.getByRole("button", { name: "Felhasználó létrehozása" }).click();
  await expect(nu.getByRole("status")).toHaveText("Felhasználó létrehozva.");
  await expect(page.getByTestId(`user-${login1}`)).toBeVisible();

  await page.getByRole("button", { name: "Kilépés" }).click();
  await page.getByLabel("Felhasználónév").fill(login1);
  await page.getByLabel("Jelszó").fill("uj-akvarista-jelszo");
  await page.getByRole("button", { name: "Bejelentkezés" }).click();
  await expect(page.getByTestId("current-user")).toContainText("Új Akvarista");
  await expect(page.getByRole("link", { name: "Beállítások" })).toHaveCount(0);
});

test("export: a real .xlsx download and a ZIMS CSV run whose file can be downloaded", async ({ page }, info) => {
  const tablet = info.project.name === "tablet";
  await login(page, "teszt.admin");
  // a measurement today, so the export has something to carry
  await page.goto("/vizmeres?csoport=NAPI_KIS");
  const pool = tablet ? "Korallos" : "Ragadozós";
  await page.getByRole("button", { name: pool, exact: true }).click();
  const orp = page.getByTestId(`cell-${pool}-ORP`);
  if ((await orp.inputValue()) === "") {
    await orp.fill(tablet ? "301" : "302");
    await orp.press("Enter");
    await expect(page.getByTestId(`cell-${pool}-ORP`)).not.toHaveValue("");
  }
  await page.waitForLoadState("networkidle");

  await page.getByRole("link", { name: "Export" }).first().click();
  const [xlsx] = await Promise.all([page.waitForEvent("download"), page.getByTestId("excel-download").click()]);
  expect(xlsx.suggestedFilename()).toMatch(/^Vizmeres_.*\.xlsx$/);
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await xlsx.path());
  expect(wb.worksheets[0].name).toBe("Vízmérés teljes");
  expect((wb.worksheets[0].getRow(1).values as unknown[]).slice(1)).toContain("Mérést végezte");

  await page.getByLabel("Az export célja").selectOption("PREVIEW");
  await page.getByRole("button", { name: "ZIMS CSV készítése" }).click();
  await expect(page.getByTestId("zims-message")).toContainText("Elkészült");
  const link = page.getByTestId("runs-table").getByRole("link").first();
  const [csv] = await Promise.all([page.waitForEvent("download"), link.click()]);
  const fs = await import("node:fs/promises");
  const text = await fs.readFile(await csv.path(), "utf8");
  expect(text.startsWith("Date,Time,Measurement,MeasurementValue,UnitofMeasure,MeasuredBy\r\n")).toBe(true);
  expect(text).toMatch(/"[A-Z][a-z]{2} \d{1,2}, \d{4}",\d{2}:\d{2},/);
});

test("animals: the list from the events, a transfer recorded, the history kept; the feed list by type", async ({ page }, info) => {
  const tablet = info.project.name === "tablet";
  const name = tablet ? "Teszt Három" : "Teszt Négy";
  const target = tablet ? "Karantén" : "Kismedence";
  await login(page, "teszt.akvarista1");
  await page.getByRole("link", { name: "Állatok" }).click();
  await expect(page.getByTestId("animals-table")).toContainText("Teszt Egy");
  await page.getByTestId("animals-table").getByRole("link", { name }).click();
  await expect(page.getByTestId("animal-detail")).toContainText("Érkezés");
  const actions = page.getByTestId("animal-actions");
  await actions.getByLabel("Esemény", { exact: true }).selectOption("TRANSFER");
  await actions.getByLabel("Cél medence").selectOption({ label: target });
  await actions.getByRole("button", { name: "Rögzítés" }).click();
  await expect(actions.getByRole("status")).toHaveText("Áthelyezés rögzítve.");
  await expect(page.getByTestId("animal-detail")).toContainText("Áthelyezés");
  await expect(page.getByTestId("animals-table").getByRole("row").filter({ hasText: name })).toContainText(target);
  // an aquarist sees no arrival form (a new animal is admin work)
  await expect(page.getByTestId("new-arrival")).toHaveCount(0);

  await page.getByRole("link", { name: "Takarmánylista" }).click();
  await expect(page.getByTestId("feeds-RAK")).toContainText("Litopenaeus vannamei");
  await expect(page.getByTestId("feeds-RAK")).toContainText("tömeg és darab");
});

test("feeding: the daily list, an item in pieces and grams, the list finalized; the eating log", async ({ page }, info) => {
  // each layout feeds its own animal: the day is shared, the cells are not
  const name = info.project.name === "tablet" ? "Teszt Egy" : "Teszt Kettő";
  await login(page, "teszt.akvarista1");
  await page.getByRole("link", { name: "Takarmánynapló" }).click();
  const box = page.getByLabel(`${name} a mai listán`);
  await box.check();
  await expect(box).toBeChecked();
  const form = page.getByTestId("item-form");
  await form.getByLabel("Kinek", { exact: true }).selectOption({ label: name });
  await form.getByLabel("Takarmány", { exact: true }).selectOption({ label: "Litopenaeus vannamei" });
  await form.getByLabel("Mennyiség (darab)", { exact: true }).fill("6");
  await form.getByLabel("Mennyiség (tömeg)", { exact: true }).fill("42,5");
  await form.getByRole("button", { name: "Tétel mentése" }).click();
  await expect(form.getByRole("status")).toHaveText("Tétel mentve.");
  const row = page.getByTestId("feeding-list").getByRole("row").filter({ hasText: name });
  await expect(row).toContainText("6 db");
  await expect(row).toContainText("42,5 g");
  // EGY-06, EGY-07: the clicked row is active, the form follows it, the live line adds what is typed
  // (the form first points at the group, so only the click can bring the animal back)
  await form.getByLabel("Kinek", { exact: true }).selectOption({ label: "Teszt csoport (csoport)" });
  await expect(page.getByTestId("live-total")).toContainText("Teszt csoport (csoport): eddig");
  await row.getByRole("cell", { name, exact: true }).click();
  const live = page.getByTestId("live-total");
  await expect(live).toContainText(`${name}: eddig`);
  await form.getByLabel("Mennyiség (tömeg)", { exact: true }).fill("10");
  await expect(live).toContainText("most beírva 10 g");
  await expect(live).toContainText("együtt 52,5 g");
  await form.getByLabel("Mennyiség (tömeg)", { exact: true }).fill("");
  const finalize = page.getByRole("button", { name: "Lista kész" });
  if (await finalize.count()) await finalize.click();
  await expect(page.getByTestId("list-state")).toHaveText("Lista kész");

  await page.getByRole("link", { name: "Evési napló" }).click();
  // not on the list: a fasting day once the finalized list is closed, shown as pending until then
  await expect(page.getByTestId("state-Teszt Négy")).toHaveText("koplal, még nem végleges");
  const eat = page.getByTestId(`eating-${name}`);
  await eat.getByLabel(`${name} evési állapota`).selectOption({ label: "nem evett meg mindent" });
  await eat.getByLabel(`${name} vitamin`).check();
  await eat.getByRole("button", { name: "Mentés" }).click();
  await expect(page.getByTestId(`state-${name}`)).toHaveText("nem evett meg mindent");
  await page.reload();
  await expect(page.getByTestId(`state-${name}`)).toHaveText("nem evett meg mindent");
  await expect(page.getByTestId("eating-table").getByRole("row").filter({ hasText: name })).toContainText("V");

  // TAK-04: the period log shows the item and the eating pattern; TAK-05: printable as PDF
  await page.getByRole("link", { name: "Takarmányozási napló" }).click();
  await expect(page.getByTestId("feeding-log")).toContainText(name);
  await expect(page.getByTestId("eating-pattern")).toContainText(name);
  await expect(page.getByTestId("print")).toBeVisible();

  // EGY-10, EVE-07: both Excel files are real downloads from the export page
  await page.getByRole("link", { name: "Export" }).click();
  for (const [id, prefix] of [["excel-etetes", "Egyedi_takarmanynaplo_"], ["excel-evesi", "Evesi_minta_"]] as const) {
    const [file] = await Promise.all([page.waitForEvent("download"), page.getByTestId(id).click()]);
    expect(file.suggestedFilename()).toMatch(new RegExp(`^${prefix}\\d{4}-\\d{2}-\\d{2}`));
  }
});

test("withdrawal: an item for tomorrow, the day's total, taken against given, the Excel", async ({ page }, info) => {
  // each layout takes out its own feed: one item per feed and day
  const feedName = info.project.name === "tablet" ? "Teszt hal" : "Teszt kagyló";
  await login(page, "teszt.akvarista1");
  await page.getByRole("link", { name: "Takarmánykivétel" }).click();
  const form = page.getByTestId("withdrawal-form");
  await form.getByLabel("Takarmány", { exact: true }).selectOption({ label: feedName });
  await form.getByLabel("Mennyiség (tömeg)", { exact: true }).fill("200");
  await form.getByRole("button", { name: "Kivétel mentése" }).click();
  await expect(form.getByRole("status")).toHaveText("Kivétel mentve.");
  await expect(page.getByTestId("withdrawal-list")).toContainText(feedName);
  await expect(page.getByTestId("withdrawal-total")).toContainText("g");
  await expect(page.getByTestId("taken-given")).toBeVisible();
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByTestId("excel-kivetel").click()]);
  expect(file.suggestedFilename()).toMatch(/^Takarmanykivetel_\d{4}-\d{2}-\d{2}/);
});

test("calculator: general, no animal on top, saved as the reference of the animal picked next to the button", async ({ page }, info) => {
  const name = info.project.name === "tablet" ? "Teszt Három" : "Teszt Négy";
  await login(page, "teszt.akvarista1");
  await page.getByRole("link", { name: "Takarmánykalkulátor" }).click();
  await expect(page.getByRole("heading", { name: "Kalkulátor", exact: true })).toBeVisible();
  // caparium-hibak-2: no animal tabs, no "Számítás mentése", and the body weight log is hidden (switched off)
  await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Számítás mentése" })).toHaveCount(0);
  await expect(page.getByTestId("body-weight-form")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Testtömeg-napló" })).toHaveCount(0);
  const calc = page.getByTestId("calculator");
  await calc.getByLabel("Testtömeg (kg)").fill("50");
  await calc.getByLabel("Heti FR (%)").selectOption("2");
  await calc.getByLabel("Heti etetésszám (N)").selectOption("4");
  await expect(page.getByTestId("calc-result")).toContainText("250 g");
  await expect(page.getByTestId("calc-result")).toContainText("1000 g");
  const save = calc.getByRole("button", { name: "Mentés referenciaként" });
  await expect(save, "nothing to save to before an animal is picked").toBeDisabled();
  await calc.getByLabel("Állat", { exact: true }).selectOption({ label: name });
  await save.click();
  await expect(calc.getByRole("status")).toHaveText("Mentve referenciaként.");
  await expect(page.getByTestId("current-reference")).toContainText("250 g");
  await expect(page.getByTestId("saved-references").getByRole("row").filter({ hasText: name }).first()).toContainText("250 g");
  // EGY-08: the feeding page shows the reference in the animal's row
  await page.getByRole("link", { name: "Takarmánynapló" }).click();
  await expect(page.getByTestId("feeding-list").getByRole("row").filter({ hasText: name })).toContainText("ref 250 g");
});

test("body weight log: hidden, not deleted; a setting row brings it back on the calculator page", async ({ page }, info) => {
  const name = info.project.name === "tablet" ? "Teszt Három" : "Teszt Négy";
  const db = new PrismaClient();
  const flip = (value: "true" | "false") =>
    db.setting.create({ data: { key: "body_weight_log_visible", value, changedById: "00000000-0000-0000-0000-000000000001" } });
  try {
    await flip("true");
    await login(page, "teszt.akvarista1");
    await page.getByRole("link", { name: "Takarmánykalkulátor" }).click();
    await page.getByRole("link", { name, exact: true }).click();
    const weight = page.getByTestId("body-weight-form");
    await weight.getByLabel("Mért testtömeg (kg)").fill("50");
    await weight.getByRole("button", { name: "Testtömeg mentése" }).click();
    await expect(weight.getByRole("status")).toHaveText("Testtömeg mentve.");
    await expect(page.getByTestId("body-weights")).toContainText("50 kg");
    // the picked animal's last weight is the calculator's starting BW, and the animal is preselected
    await page.reload();
    await expect(page.getByTestId("calculator").getByLabel("Testtömeg (kg)")).toHaveValue("50");
    await expect(page.getByTestId("calculator").getByLabel("Állat", { exact: true })).toHaveValue(/.+/);
  } finally {
    await flip("false");
    await db.$disconnect();
  }
  await page.reload();
  await expect(page.getByTestId("body-weight-form")).toHaveCount(0);
});

test("dosing: a dose in g, the log, the stock kept in kg, printable", async ({ page }) => {
  await login(page, "teszt.akvarista1");
  await page.getByRole("link", { name: "Vegyszeradagolás" }).click();
  const form = page.getByTestId("dosing-form");
  await form.getByLabel("Medence", { exact: true }).selectOption({ label: "Sózó" });
  await form.getByLabel("Szer", { exact: true }).selectOption({ label: "Teszt só" });
  await form.getByLabel("Mennyiség", { exact: true }).fill("500");
  await form.getByLabel("Egység", { exact: true }).selectOption({ label: "g" });
  await form.getByRole("button", { name: "+ Adagolás mentése" }).click();
  await expect(form.getByRole("status")).toHaveText("Adagolás mentve.");
  await expect(page.getByTestId("dosing-log")).toContainText("Teszt só");
  await expect(page.getByTestId("dosing-log")).toContainText("500 g");
  await expect(page.getByTestId("stock").getByRole("row").filter({ hasText: "Teszt só" })).toContainText("kg");
  await expect(page.getByTestId("print")).toBeVisible();
});

test("a pool's own band and volume in the settings; the chemical calculator under dosing works with them", async ({ page }, info) => {
  // caparium-hibak-3; each project its own pool, so the second run does not meet the first one's values
  const pool = info.project.name === "tablet" ? "Ragadozós" : "Inkubátor";
  await login(page, "teszt.admin");
  await page.getByRole("link", { name: "Beállítások" }).click();
  const volumes = page.getByTestId("pool-volumes");
  await volumes.getByLabel(`${pool} űrtartalma (liter)`).fill("1000");
  await volumes.getByRole("row").filter({ hasText: pool }).getByRole("button", { name: "Mentés" }).click();
  await expect(volumes.getByRole("row").filter({ hasText: pool }).getByRole("status")).toHaveText("Mentve.");
  await page.waitForLoadState("networkidle");

  const block = page.getByTestId(`pool-ref-${pool}`);
  await block.locator("summary").click();
  const ca = block.getByTestId(`ref-${pool}-Ca`);
  await expect(ca, "a pool without its own range shows the common one").toContainText("a közös érték");
  await ca.getByLabel(`${pool} Ca minimum`).fill("400");
  await ca.getByLabel(`${pool} Ca maximum`).fill("440");
  await ca.getByRole("button", { name: "Mentés" }).click();
  await expect(ca.getByRole("status")).toHaveText("Mentve.");
  await page.waitForLoadState("networkidle");
  await page.reload();
  await page.getByTestId(`pool-ref-${pool}`).locator("summary").click();
  await expect(page.getByTestId(`ref-${pool}-Ca`)).not.toContainText("a közös érték");

  await page.getByRole("link", { name: "Vegyszeradagolás" }).click();
  const calc = page.getByTestId("chemistry-calculator");
  await calc.getByLabel("Medence", { exact: true }).selectOption({ label: pool });
  await expect(calc.getByLabel("Térfogat (liter)")).toHaveValue("1000");
  const card = calc.getByTestId("chem-CA");
  await expect(card).toContainText("A medence célsávja: 400 … 440 ppm"); // the range is stored in the parameter unit
  await card.getByLabel("Kalcium emelése: jelenlegi érték").fill("380");
  await card.getByLabel("Kalcium emelése: célérték").fill("420");
  // the OS module's own hand-computed case: 1000 l, 380 -> 420 mg/l is about 146,7 g CaCl2·2H2O
  await expect(calc.getByTestId("chem-CA-result")).toHaveText("Szükséges mennyiség: 146,7 g");
  await card.getByLabel("Kalcium emelése: célérték").fill("370");
  await expect(calc.getByTestId("chem-CA-result")).toHaveText("A célérték nem magasabb a jelenlegi értéknél, nincs szükség adagolásra.");
});

test("reports and the daily water report: the tables, the Excel, a printable page", async ({ page }) => {
  await login(page, "teszt.akvarista1");
  await page.getByRole("link", { name: "Kimutatások" }).click();
  await expect(page.getByTestId("report-by-day")).toContainText("Összesen");
  await expect(page.getByTestId("report-by-recipient")).toBeVisible();
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByTestId("excel-kimutatas").click()]);
  expect(file.suggestedFilename()).toMatch(/^Kimutatas_\d{4}-\d{2}-\d{2}/);
  await page.getByRole("link", { name: "Napi jelentő" }).click();
  await expect(page.getByTestId("report-day")).toContainText("Vízmérés");
  await expect(page.getByTestId("print")).toBeVisible();
  // VIZ-15 (no e-mail): the day's measurements as a file
  const [daily] = await Promise.all([page.waitForEvent("download"), page.getByTestId("daily-excel").click()]);
  expect(daily.suggestedFilename()).toMatch(/^Vizmeres_\d{4}-\d{2}-\d{2}\.xlsx$/);
  // VIZ-20: the monthly package's card on the export page; the overview's feeding tile
  await page.getByRole("link", { name: "Export" }).click();
  await expect(page.getByTestId("monthly-package")).toContainText("Havi ZIMS-csomag");
  await page.getByRole("link", { name: "Áttekintés" }).click();
  await expect(page.getByTestId("tile-feeding")).toBeVisible();
});

test("conveniences: a feeding plan, the list from it, the feed type icons", async ({ page }) => {
  // Teszt Három: the feeding test expects Teszt Négy OFF today's list, and the plan adds to it
  await login(page, "teszt.akvarista1");
  await page.getByRole("link", { name: "Állatok" }).click();
  await page.getByTestId("animals-table").getByRole("link", { name: "Teszt Három" }).click();
  const plan = page.getByTestId("plan-form");
  for (const d of ["H", "K", "Sze", "Cs", "P", "Szo", "V"]) await plan.getByLabel(`Etetési nap: ${d}`).check();
  await plan.getByRole("button", { name: "Terv mentése" }).click();
  await expect(plan.getByRole("status")).toHaveText("Terv mentve.");
  await page.getByRole("link", { name: "Takarmánynapló" }).click();
  await page.getByRole("button", { name: "Lista a terv szerint" }).click();
  await expect(page.getByLabel("Teszt Három a mai listán")).toBeChecked();
  await page.getByRole("link", { name: "Takarmánylista" }).click();
  await expect(page.getByRole("heading", { name: "🦐 Rákok" })).toBeVisible();
});

test("the helper: a quick question about the page, switched off and on", async ({ page }) => {
  await login(page, "teszt.akvarista1");
  // its own dose leaves "Teszt só" below zero, whatever ran before (review of #21)
  await page.getByRole("link", { name: "Vegyszeradagolás" }).click();
  const form = page.getByTestId("dosing-form");
  await form.getByLabel("Medence", { exact: true }).selectOption({ label: "Sózó" });
  await form.getByLabel("Szer", { exact: true }).selectOption({ label: "Teszt só" });
  await form.getByLabel("Mennyiség", { exact: true }).fill("100");
  await form.getByLabel("Egység", { exact: true }).selectOption({ label: "g" });
  await form.getByRole("button", { name: "+ Adagolás mentése" }).click();
  await expect(form.getByRole("status")).toHaveText("Adagolás mentve.");
  // a fresh session on the overview: the pages before may already have shown the alert
  await page.getByRole("link", { name: "Áttekintés" }).click();
  await expect(page.getByRole("heading", { name: "Mai áttekintés" })).toBeVisible();
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  // AST-03: the overview's helper opens by itself, once
  const first = page.getByTestId("helper");
  await expect(first).toHaveAttribute("data-ready", "1");
  await expect(first.getByTestId("helper-button")).toHaveAttribute("aria-expanded", "true");
  await expect(first.getByTestId("helper-answer")).toContainText("Teszt só");
  await page.getByRole("link", { name: "Napi vízmérés" }).click();
  // the overview has a helper too: wait for the new page, or the clicks below land on the old one
  await expect(page).toHaveURL(/\/vizmeres/);
  await expect(page.getByRole("heading", { name: "Napi vízmérések" })).toBeVisible();
  const helper = page.getByTestId("helper");
  // wait until the component has read its stored state, or the click races the auto-open
  await expect(helper).toHaveAttribute("data-ready", "1");
  // the same alert again: it stays closed on the next page (review of #20, c)
  await expect(helper.getByTestId("helper-button")).toHaveAttribute("aria-expanded", "false");
  await helper.getByTestId("helper-button").click();
  await helper.getByRole("button", { name: "Mi van még hátra ma?" }).click();
  await expect(helper.getByTestId("helper-answer")).not.toBeEmpty();
  await helper.getByRole("button", { name: "Segítő kikapcsolása" }).click();
  await expect(page.getByTestId("helper-on")).toBeVisible();
  // a new session while switched off: the alert must not be marked seen behind the closed helper (review of #20, a)
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.getByTestId("helper-on")).toBeVisible();
  await page.getByTestId("helper-on").click();
  // switched back on, the alert not seen in this session opens right here, not only on the next page (review of #21)
  await expect(page.getByTestId("helper-button")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("helper-answer")).toContainText("Teszt só");
});

// Last in the file: it loads the description's 25 animals into the shared e2e database (acrobot 33380). The tablet
// run meets 0 of 25 (no switch and no synthetic seed arrival before the basic data on this database) and clicks;
// the desktop run meets them in.
test("animals: the starting list's status line, and an admin loads it with one click", async ({ page }) => {
  await login(page, "teszt.admin");
  await page.goto("/allatok");
  const box = page.getByTestId("initial-animals");
  const status = page.getByTestId("initial-animals-status");
  const button = box.getByRole("button", { name: "Kezdő állatlista betöltése a leírásból" });
  if (await button.isVisible()) {
    // the reason depends on this database's history (the CI fallback seeds the synthetic data after the basic data)
    await expect(status).toContainText("0 / 25");
    await button.click();
    await expect(box.getByRole("status")).toHaveText("Kezdő állatlista betöltve.");
  }
  await expect(status).toContainText("25 / 25 állat van bent; mind bent van.");
  await expect(button).toHaveCount(0);
  await expect(page.getByTestId("animals-table")).toContainText("Nokedli");
  await expect(page.getByTestId("animals-table")).toContainText("Ráják");
});
