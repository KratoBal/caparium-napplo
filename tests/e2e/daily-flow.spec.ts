// The first working flow (feladat-4, 4. pont): login -> pool group -> record -> saved in the DB -> log.
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const PASSWORD = process.env.SEED_TEST_PASSWORD ?? "";

// "Kilépés" is a form POST that clears the session and answers 303 to /belepes. The next login's goto("/belepes") must
// wait for it: while the old session still stands, /belepes sends a logged-in user to "/", and the login form never
// comes (the tablet run of the feeding day restore timed out so on #139's CI, 41050732517).
async function logout(page: Page) {
  await page.getByRole("button", { name: "Kilépés" }).click();
  await expect(page).toHaveURL(/\/belepes(\?|$)/);
  await expect(page.getByLabel("Felhasználónév")).toBeVisible();
}

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
    ? { tab: "Kis Akváriumok", pool: "Korallos" }
    : { tab: "Nagy medencék", pool: "Nagymedence" };
}

test.beforeAll(() => {
  if (!PASSWORD) throw new Error("SEED_TEST_PASSWORD must be set for the e2e run");
});

test("login, record a daily measurement, it survives a reload and shows in the log with history", async ({ page }, info) => {
  const p = plan(info.project.name);
  await login(page, "teszt.akvarista1");

  await page.getByRole("link", { name: "Napi vízmérés", exact: true }).first().click();
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

  // persisted in the database, not in the browser; after a reload the first pool's row is the active one, so the
  // pool is tapped again (Korallos is the small tanks' last row since 2026-10-29)
  await page.reload();
  await page.getByRole("button", { name: p.pool, exact: true }).click();
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

// Balázs 2026-10-21 (Caparium thread): one date on the page, and nothing is saved until the Mentés button; an
// autosave on leaving a field mixed things up when a wrong value was corrected. MI PIROSÍT: a value saved on
// Enter or on leaving the field; leaving the page with an unsaved value without a question; a date-and-time
// field next to the day.
test("a value is saved only by the Mentés button, leaving with it asks first, and the time is a time of day", async ({ browser }, info) => {
  const p = plan(info.project.name);
  const page = await browser.newPage();
  await login(page, "teszt.akvarista1");
  await page.goto("/vizmeres");
  await page.getByRole("tab", { name: p.tab }).click();
  await page.getByRole("button", { name: p.pool, exact: true }).click();
  await expect(page.getByTestId("measured-at")).toHaveAttribute("type", "time");

  const temp = page.getByTestId(`cell-${p.pool}-Hőmérséklet`);
  await temp.fill("24,6");
  await temp.press("Enter");
  await page.getByTestId(`cell-${p.pool}-pH`).focus(); // leaving the field saves nothing either

  // another session sees nothing yet: no autosave
  const other = await browser.newPage();
  await login(other, "teszt.akvarista2");
  await other.goto("/vizmeres");
  await other.getByRole("tab", { name: p.tab }).click();
  await other.getByRole("button", { name: p.pool, exact: true }).click();
  await expect(other.getByTestId(`cell-${p.pool}-Hőmérséklet`)).toHaveValue("");

  // leaving through an in-app link asks; declining keeps the page and the typed value
  let asked = "";
  page.once("dialog", (d) => {
    asked = d.message();
    void d.dismiss();
  });
  await page.getByRole("link", { name: "Vízmérési napló" }).first().click();
  expect(asked).toContain("nem mentett mérési érték");
  await expect(page.getByTestId(`cell-${p.pool}-Hőmérséklet`)).toHaveValue("24,6");

  await page.getByTestId("save-all").click();
  await expect(page.getByTestId("banner")).toHaveText("Minden érték mentve.");
  await other.reload();
  await other.getByRole("tab", { name: p.tab }).click();
  await other.getByRole("button", { name: p.pool, exact: true }).click();
  await expect(other.getByTestId(`cell-${p.pool}-Hőmérséklet`)).toHaveValue("24,6");
  await other.close();
  await page.close();
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
  await a.getByTestId("save-all").click();
  await expect(a.getByTestId("banner")).toHaveText("Minden érték mentve.");
  await expect(a.getByTestId(`cell-${p.pool}-ORP`)).toHaveValue("305");
  const orpB = b.getByTestId(`cell-${p.pool}-ORP`);
  await orpB.fill("310");
  await b.getByTestId("save-all").click();
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

// Budapest's today moved by calendar days, not by 24-hour steps: across the DST change (2026-10-25) a 24-hour step lands
// an hour off, so from 23:00 to midnight "-31" was 30 calendar days back (card 61043ae0)
function budapestDay(offsetDays: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest" }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

test("admin corrects and invalidates an earlier day's measurement with a reason (the reasons on); an aquarist gets no form", async ({ page, browser }, info) => {
  // caparium-indoklas-ki: the reasons are off by default; this test is the "on" branch, the forms as they were
  const db = new PrismaClient();
  const reasons = (value: "true" | "false") =>
    db.setting.create({ data: { key: "reason_required", value, changedById: "00000000-0000-0000-0000-000000000001" } });
  await reasons("true");
  try {
    const pool = info.project.name === "tablet" ? "Inkubátor" : "Ragadozós";
    const yesterday = budapestDay(-1);
    page.on("dialog", (d) => void (d.type() === "prompt" ? d.accept("papírról utólag bevitt mérés") : d.accept()));

    await login(page, "teszt.admin");
    await page.goto(`/vizmeres?csoport=NAPI_KIS&nap=${yesterday}`);
    await expect(page.getByText("Korábbi nap: minden módosításhoz indoklás kell")).toBeVisible();
    await page.getByRole("button", { name: pool, exact: true }).click();
    const ph = page.getByTestId(`cell-${pool}-pH`);
    await ph.fill("8,05");
    await page.getByTestId("save-all").click();
    await expect(page.getByTestId("banner")).toHaveText("Minden érték mentve.");
    await expect(page.getByTestId(`cell-${pool}-pH`)).toHaveValue("8,05");

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
  } finally {
    await reasons("false");
    await db.$disconnect();
  }
});

test("the pending list is for admins; an aquarist is sent to the no-access page", async ({ page }) => {
  await login(page, "teszt.admin");
  await page.getByRole("link", { name: "Függő mentések" }).click();
  await expect(page.getByRole("heading", { name: "Késve érkezett mentések" })).toBeVisible();
  await logout(page);
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
  await page.getByTestId("save-all").click();
  await expect(page.getByTestId("banner")).toHaveText("Minden érték mentve.");
  await expect(page.getByTestId(`cell-${pool}-NO3`)).toHaveClass(/out/);

  await page.goto("/beallitasok");
  const nu = page.getByTestId("new-user");
  await nu.getByLabel("Új felhasználónév").fill(login1);
  await nu.getByLabel("Teljes név").fill("Új Akvarista");
  await nu.getByLabel("Monogram").fill(tablet ? "UT" : "UD");
  await nu.getByLabel("ZIMS-név").fill("New Aquarist");
  await nu.getByLabel("Kezdő jelszó").fill("uj-akvarista-jelszo");
  // #36 CI, tablet WebKit, both attempts: the server answered that the login id was not "3-40 lowercase" although
  // the test typed "uj.akvarista.t". Not reproduced locally (two fills without a re-render, and a fill before
  // hydration on a 30x slowed CPU, both kept the value). So the fields' actual values are asserted here, by name,
  // before the save: a failure names what WebKit really held.
  await expect(nu.getByLabel("Új felhasználónév"), "login id as typed").toHaveValue(login1);
  await expect(nu.getByLabel("Teljes név"), "full name as typed").toHaveValue("Új Akvarista");
  // ... and what the request carried (the login id only, never the password)
  const sent = page.waitForRequest((r) => r.url().endsWith("/api/admin/users") && r.method() === "POST");
  await nu.getByRole("button", { name: "Felhasználó létrehozása" }).click();
  const loginSent = (JSON.parse((await sent).postData() ?? "{}") as { loginId?: string }).loginId;
  expect(loginSent, "the login id in the request").toBe(login1);
  await expect(nu.getByRole("status")).toHaveText("Felhasználó létrehozva.");
  await expect(page.getByTestId(`user-${login1}`)).toBeVisible();

  await logout(page);
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
    await page.getByTestId("save-all").click();
    await expect(page.getByTestId("banner")).toHaveText("Minden érték mentve.");
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
  // Lili 2026-10-26: the animal list is for admins only now
  await login(page, "teszt.admin");
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

  await page.getByRole("link", { name: "Takarmánylista" }).click();
  await expect(page.getByTestId("feeds-RAK")).toContainText("Litopenaeus vannamei");
  await expect(page.getByTestId("feeds-RAK")).toContainText("tömeg és darab");

  // Lili 2026-10-27 22:42 and 22:45 UTC: a feed of the list is changed with a small quiet "Módosítás" beside the
  // activation (both buttons the small kind); the name is a correction, the unit only while nothing was recorded
  const feedName = `E2E rák ${info.project.name}`;
  const newFeed = page.getByTestId("new-feed");
  await newFeed.getByLabel("Takarmány neve").fill(feedName);
  await newFeed.getByLabel("Alapértelmezett egység").selectOption({ label: "g" });
  await newFeed.getByRole("button", { name: "Felvétel" }).click();
  await expect(newFeed.getByRole("status")).toHaveText("Takarmány felvéve.");
  const feedRow = page.getByRole("row").filter({ hasText: feedName });
  const edit = feedRow.getByRole("button", { name: `${feedName}: módosítás` });
  await expect(edit).toHaveClass(/btn-row/);
  await expect(feedRow.getByRole("button", { name: "Inaktiválás" })).toHaveClass(/btn-row/);
  page.once("dialog", (d) => void d.accept());
  await edit.click();
  const editor = feedRow.locator('[data-testid^="feed-edit-"]');
  await editor.getByLabel("Takarmány új neve").fill(`${feedName} javított`);
  await editor.getByLabel("darabban is").check();
  await editor.getByRole("button", { name: "Mentés" }).click();
  const renamed = page.getByRole("row").filter({ hasText: `${feedName} javított` });
  await expect(renamed).toContainText("tömeg és darab");
  await expect(renamed.locator('[data-testid^="feed-edit-"]'), "the editor closes after the save").toHaveCount(0);
  // acrobot 38203 (as the pools of #107): an inactive feed is hidden on the list, behind "Inaktívak mutatása"; the row
  // switched in this view stays until the page is left, so its message is read
  await renamed.getByRole("button", { name: "Inaktiválás" }).click();
  await expect(renamed.getByRole("status")).toHaveText("Inaktiválva.");
  await expect(renamed.getByRole("button", { name: "Aktiválás" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: `${feedName} javított` })).toHaveCount(0);
  await page.getByRole("switch", { name: /Inaktívak mutatása/ }).check();
  await expect(page.getByRole("row").filter({ hasText: `${feedName} javított` })).toHaveClass(/invalid/);
});

test("feeding: the daily list, an item in pieces and grams, the list finalized; the eating log", async ({ page }, info) => {
  // each layout feeds its own animal: the day is shared, the cells are not
  const name = info.project.name === "tablet" ? "Teszt Egy" : "Teszt Kettő";
  await login(page, "teszt.akvarista1");
  await page.getByRole("link", { name: "Takarmánynapló", exact: true }).click();
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
  // Lili 2026-10-27 23:08 UTC: no "Módosítás" on the day's items (the feeding sheet corrects them); "Érvénytelenítés" stays
  await expect(row.getByRole("button", { name: /módosítás/i })).toHaveCount(0);
  await expect(row.getByRole("button", { name: /Érvénytelenítés/ }).first()).toBeVisible();
  // Lili 2026-10-27 (item 5): the one button at the bottom of the choice; once finalized, the same place shows the state
  const finalize = page.getByRole("button", { name: "Takarmánylap kész" });
  if (await finalize.count()) await finalize.click();
  await expect(page.getByTestId("list-state")).toHaveText("Takarmánylap kész");
  await expect(finalize).toHaveCount(0);

  await page.getByRole("link", { name: "Evési napló" }).click();
  // caparium-hibak-5: the log lists who is on today's list; the others are folded away as fasting days
  await expect(page.getByTestId("eating-table")).toContainText(name);
  await expect(page.getByTestId("eating-table")).not.toContainText("Teszt Négy");
  await page.getByTestId("eating-fasting").locator("summary").click();
  // not on the list: a fasting day once the finalized list is closed, shown as pending until then
  await expect(page.getByTestId("eating-fasting-table").getByTestId("state-Teszt Négy")).toHaveText("koplal, még nem végleges");
  const eat = page.getByTestId(`eating-${name}`);
  await eat.getByLabel(`${name} evési állapota`).selectOption({ label: "nem evett meg mindent" });
  await eat.getByLabel(`${name} vitamin`).check();
  // caparium-hibak-4: one save for every filled-in row, no save button per row
  await expect(eat.getByRole("button", { name: "Mentés" })).toHaveCount(0);
  await page.getByTestId("eating-save-all").click();
  await expect(page.getByTestId("eating-save-result")).toHaveText("1 sor mentve.");
  await expect(page.getByTestId(`state-${name}`)).toHaveText("nem evett meg mindent");

  // review of #31: a refresh restarts only the rows whose server state changed. A filled-in, unsaved row (Teszt Négy)
  // keeps its draft while another row's status is invalidated; then it is cleared again, nothing of it is saved.
  // acrobot 34629 (Lili): a fasting row shows its state only; its controls open on request
  await expect(page.getByTestId("eating-fasting-table").getByLabel("Teszt Négy evési állapota")).toHaveCount(0);
  await page.getByRole("button", { name: "Teszt Négy: kivétel rögzítése" }).click();
  const other = page.getByTestId("eating-Teszt Négy").getByLabel("Teszt Négy evési állapota");
  await other.selectOption("FASTING");
  page.once("dialog", (d) => void d.accept("teszt: törlés a vázlat-próbához"));
  await eat.getByRole("button", { name: "Törlés (érvénytelenítés)" }).click();
  await expect(page.getByTestId(`state-${name}`)).toHaveText("nincs rögzítve");
  await expect(other, "the unsaved draft of another row survives the refresh").toHaveValue("FASTING");
  await other.selectOption("");
  await eat.getByLabel(`${name} evési állapota`).selectOption({ label: "nem evett meg mindent" });
  await eat.getByLabel(`${name} vitamin`).check();
  await page.getByTestId("eating-save-all").click();
  await expect(page.getByTestId("eating-save-result")).toHaveText("1 sor mentve.");
  await expect(page.getByTestId(`state-${name}`)).toHaveText("nem evett meg mindent");
  await page.reload();
  await expect(page.getByTestId(`state-${name}`)).toHaveText("nem evett meg mindent");
  await expect(page.getByTestId("eating-table").getByRole("row").filter({ hasText: name })).toContainText("V");
  // barracuda on #50 (the #45 lesson): an unsaved eating draft belongs to its day. The day navigation stays on the
  // same route; after going to another day and back, the row shows what is saved, not the draft
  // a row whose server state is the same on both days (Teszt Négy: not on the list, nothing recorded) is the one
  // that would carry its draft over, since only rows whose server state changed restart their drafts
  const today = await page.getByTestId("shown-day").textContent();
  await page.getByTestId("eating-fasting").locator("summary").click();
  await page.getByRole("button", { name: "Teszt Négy: kivétel rögzítése" }).click();
  await page.getByTestId("eating-Teszt Négy").getByLabel("Teszt Négy evési állapota").selectOption("FASTING");
  // acrobot 34710: with an unsaved row, leaving (the day navigation too) asks first; declined, the day and the
  // draft stay; accepted, the page goes
  const asked: string[] = [];
  page.once("dialog", (d) => {
    asked.push(d.message());
    void d.dismiss();
  });
  await page.getByRole("link", { name: "‹ előző nap" }).click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toContain("Van még nem mentett sor az evési naplóban.");
  await expect(page.getByTestId("shown-day")).toHaveText(today ?? "");
  await expect(page.getByTestId("eating-Teszt Négy").getByLabel("Teszt Négy evési állapota")).toHaveValue("FASTING");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("link", { name: "‹ előző nap" }).click();
  await expect(page.getByTestId("shown-day")).not.toHaveText(today ?? "");
  await page.getByRole("link", { name: "következő nap ›" }).click();
  await expect(page.getByTestId("shown-day")).toHaveText(today ?? "");
  // read in the DOM, not by role: the folded section is closed again after the remount, and its content is hidden
  await expect
    .poll(() => page.evaluate(() => [!!document.querySelector('[aria-label="Teszt Négy: kivétel rögzítése"]'), !!document.querySelector('[aria-label="Teszt Négy evési állapota"]')]))
    .toEqual([true, false]);

  // TAK-04: the period log shows the item and the eating pattern; TAK-05: printable as PDF
  await page.getByRole("link", { name: "Takarmányozási napló" }).click();
  await expect(page.getByTestId("feeding-log")).toContainText(name);
  await expect(page.getByTestId("eating-pattern")).toContainText(name);
  await expect(page.getByTestId("print")).toBeVisible();
  // Lili 2026-10-28: the two Excel buttons stand between the dates and the eating pattern, not after the growing lists
  const exportsBox = await page.getByTestId("feedlog-exports").boundingBox();
  const patternBox = await page.getByTestId("eating-pattern").boundingBox();
  expect(exportsBox && patternBox && exportsBox.y < patternBox.y).toBe(true);
  // Lili 2026-10-29 (package item 7): every day column carries its letter above the date, and a bar without a letter
  // is a thick one (at least 12 px), not the thin line it was
  const letters = await page.getByTestId("eating-pattern").locator(".day-letter").allTextContents();
  expect(letters.length).toBeGreaterThan(0);
  expect(letters.every((l) => ["H", "K", "Sze", "Cs", "P", "Szo", "V"].includes(l))).toBe(true);
  const bars = page.getByTestId("eating-pattern").locator(".eat-bar");
  if ((await bars.count()) > 0) expect((await bars.first().boundingBox())!.height).toBeGreaterThanOrEqual(12);
  // Lili 2026-10-29 (package item 11): no empty band after the Állat column: the first day column starts right after
  // the longest name (its own padding and a little more), not where a page-wide table would put it
  const gap = await page.getByTestId("eating-pattern").evaluate((t) => {
    const names = Array.from(t.querySelectorAll("tbody tr > td:first-child")).map((c) => {
      const r = document.createRange();
      r.selectNodeContents(c);
      return r.getBoundingClientRect().right;
    });
    const firstDay = t.querySelector("thead tr > th:nth-child(2)")!.getBoundingClientRect().left;
    return firstDay - Math.max(...names);
  });
  expect(gap).toBeLessThanOrEqual(40);
  // Lili 2026-10-29 (package item 15b): the rows banded, every second one a very pale grey (each channel at least 240,
  // all three equal), the first one white
  const bands = await page.getByTestId("eating-pattern").evaluate((t) =>
    Array.from(t.querySelectorAll("tbody tr")).slice(0, 2).map((r) => getComputedStyle(r.querySelector("td")!).backgroundColor),
  );
  if (bands.length === 2) {
    expect(bands[0]).toMatch(/^rgba\(0, 0, 0, 0\)$|^rgb\(255, 255, 255\)$/);
    const [r, g, b] = bands[1].match(/\d+/g)!.map(Number);
    expect(r === g && g === b && r >= 240 && r < 255).toBe(true);
  }

  // EGY-10, EVE-07: both Excel files are real downloads from the export page
  await page.getByRole("link", { name: "Export" }).click();
  for (const [id, prefix] of [["excel-etetes", "Egyedi_takarmanynaplo_"], ["excel-evesi", "Evesi_minta_"]] as const) {
    const [file] = await Promise.all([page.waitForEvent("download"), page.getByTestId(id).click()]);
    expect(file.suggestedFilename()).toMatch(new RegExp(`^${prefix}\\d{4}-\\d{2}-\\d{2}`));
  }
});

// 6fe63c9b (Lili's request; Balázs 2026-10-21 "mehet"): the list in two steps and the feeding sheet. Each layout
// fills its own animal's row; the day's feeds are shared, so the second run finds them saved already.
test("one button: \"Takarmánylap kész\" saves the day's feeds ticked above and finalizes; a failed save does not finalize", async ({ page }, info) => {
  // Lili 2026-10-27 22:47 UTC: the two buttons were one in the plan; finalizing alone lost the fresh ticks. A day of its
  // own per project, in the past (an admin may write there), so no other test has finalized it. Two days apart, not one:
  // each project reads the clock when it runs, and a run that crosses midnight between the two moves the later one's day
  // by one (card 61043ae0: tablet at 21:59:32 UTC, desktop at 22:02:30 UTC on 10-29, both on 09-29)
  const day = budapestDay(info.project.name === "tablet" ? -30 : -32);
  page.on("dialog", (d) => void d.accept());
  await login(page, "teszt.admin");
  await page.goto(`/etetes?nap=${day}`);
  const dayFeeds = page.getByTestId("day-feeds");
  const ready = dayFeeds.getByRole("button", { name: "Takarmánylap kész" });
  await expect(ready).toBeVisible();
  await expect(page.getByRole("button", { name: "A nap takarmányainak mentése" }), "no second button before the list is ready").toHaveCount(0);
  await page.getByLabel("Teszt Egy a mai listán").check();
  await expect(page.getByLabel("Teszt Egy a mai listán")).toBeChecked();
  await dayFeeds.getByLabel("A nap takarmánya: Mysis").check();
  // the save fails: nothing is finalized, the tick stays to try again
  await page.route("**/api/feeding/day-feeds", (route) => route.abort());
  await ready.click();
  await expect(dayFeeds.getByRole("status")).toHaveText("Nincs kapcsolat a szerverrel.");
  await expect(ready).toBeVisible();
  await expect(page.getByTestId("list-state")).toHaveCount(0);
  await expect(dayFeeds.getByLabel("A nap takarmánya: Mysis")).toBeChecked();
  await page.unroute("**/api/feeding/day-feeds");
  // one click: the tick saved, the list finalized, the sheet's column there
  await ready.click();
  await expect(dayFeeds.getByTestId("list-state")).toHaveText("Takarmánylap kész");
  await expect(ready).toHaveCount(0);
  await expect(page.getByTestId("feeding-sheet").getByRole("columnheader", { name: /^Mysis/ })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("day-feeds").getByLabel("A nap takarmánya: Mysis"), "the tick was saved, not only shown").toBeChecked();
  await expect(page.getByTestId("list-state")).toHaveText("Takarmánylap kész");
});

test("feeding sheet: a group selected from its header, the day's feeds, drafts kept on leaving a row, one save, corrections", async ({ page }, info) => {
  const name = info.project.name === "tablet" ? "Teszt Egy" : "Teszt Kettő";
  const other = info.project.name === "tablet" ? "Teszt Kettő" : "Teszt Egy";
  await login(page, "teszt.akvarista1");
  await page.getByRole("link", { name: "Takarmánynapló", exact: true }).click();
  // step 1: the pool's header row selects every animal in it at once (Lili 2026-10-26: the list is by pool)
  await expect(page.getByTestId("group-head-Nagymedence")).toBeVisible();
  // Lili 2026-10-26 (items 2 and 3): one small switch per pool instead of the two buttons, no "Kiválasztva." beside a tick,
  // the pool and feed type names bold black two steps larger with their icon before them
  await expect(page.getByRole("button", { name: /összes kijelölése|Egyik sem/i })).toHaveCount(0);
  await page.getByRole("switch", { name: "Nagymedence: mind kijelölve" }).check();
  await expect(page.getByLabel(`${name} a mai listán`)).toBeChecked();
  // Lili 2026-10-26 (Caparium channel msg 1564401863950995497): the animals only, no group names, in the "Ki eszik ma" list
  // (Teszt Egy and Teszt Kettő belong to "Teszt csoport", which the old list wrote after their names)
  await expect(page.getByTestId("animal-chooser")).toContainText(name);
  await expect(page.getByTestId("animal-chooser")).not.toContainText("Teszt csoport");
  await expect(page.getByTestId("animal-chooser").getByRole("status").filter({ hasText: /Kiválasztva|Kivéve/ })).toHaveCount(0);
  const title = page.getByTestId("group-head-Nagymedence").locator(".section-title");
  expect(await title.evaluate((el) => { const c = getComputedStyle(el); return [c.fontWeight, c.color, c.fontSize]; })).toEqual(["700", "rgb(0, 0, 0)", "18px"]);
  const typeTitle = page.getByTestId("day-feeds").locator(".section-title").first();
  expect(await typeTitle.evaluate((el) => { const c = getComputedStyle(el); return [c.fontWeight, c.color, c.fontSize]; })).toEqual(["700", "rgb(0, 0, 0)", "18px"]);
  await expect(typeTitle.locator('[aria-hidden="true"]'), "the feed type's icon stands before its name").toHaveCount(1);
  // step 2: the day's feeds
  const dayFeeds = page.getByTestId("day-feeds");
  for (const feed of ["Litopenaeus vannamei", "Mysis", "AF Power elixir"]) await dayFeeds.getByLabel(`A nap takarmánya: ${feed}`).check();
  // the earlier test finalized today, so a changed choice has its own save button; run alone, the one button does it
  const saveFeeds = dayFeeds.getByRole("button", { name: "A nap takarmányainak mentése" });
  const ready = dayFeeds.getByRole("button", { name: "Takarmánylap kész" });
  if (await saveFeeds.count()) {
    await saveFeeds.click();
    await expect(dayFeeds.getByRole("status")).toHaveText("A nap takarmányai mentve.");
  } else if (await ready.count()) {
    await ready.click();
    await expect(dayFeeds.getByTestId("list-state")).toHaveText("Takarmánylap kész");
  }
  await expect(page.getByTestId("item-form").getByLabel("Takarmány", { exact: true }).locator("option", { hasText: "Mytilus sp." })).toHaveCount(0);
  // step 3. Lili 2026-10-21 11:44 UTC (a): a feed weighed AND counted takes both units
  const sheet = page.getByTestId("feeding-sheet");
  await expect(sheet.getByRole("columnheader", { name: "Litopenaeus vannamei (g + db)" })).toBeVisible();
  // Lili 2026-10-27: the header row stays on top while the sheet scrolls down, like a frozen row in Excel. The box has
  // a height of its own; here it is made short so that this run's few rows scroll, and the header must stay at its top
  const box = sheet.locator(".sheet-scroll");
  const animalHead = sheet.getByRole("columnheader", { name: "Állat" });
  expect(await box.evaluate((el) => getComputedStyle(el).maxHeight), "the box scrolls within a height of its own").not.toBe("none");
  const scrolled = await box.evaluate((el) => {
    el.style.maxHeight = "140px";
    el.scrollTop = el.scrollHeight;
    return el.scrollTop;
  });
  expect(scrolled, "the short box did scroll").toBeGreaterThan(0);
  const [boxTop, headTop] = await Promise.all([
    box.evaluate((el) => el.getBoundingClientRect().top),
    animalHead.evaluate((el) => el.getBoundingClientRect().top),
  ]);
  expect(Math.abs(headTop - boxTop), "the header row stays at the top of the scrolled box").toBeLessThan(1);
  // and it covers the rows passing under it: an opaque background (barracuda on #82)
  expect(await animalHead.evaluate((el) => getComputedStyle(el).backgroundColor), "the stuck header covers the rows under it").not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);
  await box.evaluate((el) => {
    el.style.maxHeight = "";
    el.scrollTop = 0;
  });
  // Lili 2026-10-28 13:49 UTC: the Állat column stays at the left while the other columns scroll sideways, the header
  // cell with it; made narrow here so that this run's few columns scroll. It covers what passes under it.
  const firstCell = sheet.getByRole("row").filter({ hasText: name }).locator("td").first();
  const sideways = await box.evaluate((el) => {
    el.style.maxWidth = "300px";
    el.scrollLeft = el.scrollWidth;
    return el.scrollLeft;
  });
  expect(sideways, "the narrow box did scroll sideways").toBeGreaterThan(0);
  const [boxLeft, cellLeft, headLeft] = await Promise.all(
    [box, firstCell, animalHead].map((l) => l.evaluate((el) => el.getBoundingClientRect().left)),
  );
  expect(Math.abs(cellLeft - boxLeft), "the animal's name stays at the left of the scrolled box").toBeLessThan(1);
  expect(Math.abs(headLeft - boxLeft), "and so does its header").toBeLessThan(1);
  expect(await firstCell.evaluate((el) => getComputedStyle(el).backgroundColor), "the stuck name covers the cells under it").not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);
  await box.evaluate((el) => {
    el.style.maxWidth = "";
    el.scrollLeft = 0;
  });
  // printed, the sheet is the whole table: no scroll box, the header a plain row
  await page.emulateMedia({ media: "print" });
  expect(await box.evaluate((el) => [getComputedStyle(el).overflowY, getComputedStyle(el).maxHeight])).toEqual(["visible", "none"]);
  expect(await animalHead.evaluate((el) => getComputedStyle(el).position)).toBe("static");
  expect(await firstCell.evaluate((el) => getComputedStyle(el).position)).toBe("static");
  await page.emulateMedia({ media: "screen" });
  // Lili 2026-10-26 (msg 1564403940320346223): "Mai tételek" is last, as a summary
  const headings = await page.locator("main h2").allTextContents();
  const place = (start: string) => headings.findIndex((h) => h.startsWith(start));
  expect(place("Ki eszik ma")).toBeGreaterThanOrEqual(0);
  expect(place("A nap takarmányai")).toBeGreaterThan(place("Ki eszik ma"));
  expect(place("Takarmánylap")).toBeGreaterThan(place("A nap takarmányai"));
  expect(place("Új tétel")).toBeGreaterThan(place("Takarmánylap"));
  expect(place("Mai tételek"), "last").toBeGreaterThan(place("Új tétel"));
  const row = sheet.getByRole("row").filter({ hasText: name });
  const otherRow = sheet.getByRole("row").filter({ hasText: other });
  await row.getByRole("cell", { name, exact: true }).click();
  const mysis = row.getByLabel(`${name}: Mysis (g)`);
  // a cell that is not an amount is marked, and nothing is sent (#42)
  await mysis.fill("sok");
  await sheet.getByRole("button", { name: /Takarmánylap mentése/ }).click();
  await expect(sheet.getByRole("status")).toHaveText(`1 cella nem menthető: érvénytelen mennyiség (${name}: Mysis).`);
  await expect(mysis).toHaveAttribute("aria-invalid", "true");
  // (b): what is typed stays when the row is left, and can be changed again before the save
  await mysis.fill("12,5");
  await row.getByLabel(`${name}: Litopenaeus vannamei (g)`).fill("40");
  await row.getByLabel(`${name}: Litopenaeus vannamei (db)`).fill("5");
  await otherRow.getByRole("cell", { name: other, exact: true }).click();
  await expect(sheet.getByTestId(`sheet-cell-${name}-Mysis`)).toHaveText("12,5 g");
  await row.getByRole("cell", { name, exact: true }).click();
  await expect(mysis).toHaveValue("12,5");
  await mysis.fill("15");
  // (c): an empty cell is 0. The other animal's Litopenaeus cell is empty in both runs: on the tablet run nothing was
  // recorded for it yet, and on the desktop run the tablet run emptied it (its item invalidated, below)
  await expect(sheet.getByTestId(`sheet-cell-${other}-Litopenaeus vannamei`)).toHaveText("0");
  // one save for everything; the first request reaches the server and its answer is lost, the second click replays it
  await page.route(
    "**/api/feeding/items",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await sheet.getByRole("button", { name: /Takarmánylap mentése/ }).click();
  await expect(sheet.getByRole("status")).toHaveText("Nincs kapcsolat a szerverrel.");
  await sheet.getByRole("button", { name: /Takarmánylap mentése/ }).click();
  await expect(sheet.getByRole("status")).toHaveText("Takarmánylap mentve.");
  await otherRow.getByRole("cell", { name: other, exact: true }).click();
  await expect(sheet.getByTestId(`sheet-cell-${name}-Mysis`)).toHaveText("15 g");
  await expect(sheet.getByTestId(`sheet-cell-${name}-Litopenaeus vannamei`)).toHaveText("40 g, 5 db");
  const listRow = page.getByTestId("feeding-list").getByRole("row").filter({ hasText: name });
  await expect(listRow).toContainText("Mysis 15 g");
  // a saved cell is corrected in place (its item is updated, not a second one)
  await row.getByRole("cell", { name, exact: true }).click();
  await mysis.fill("20");
  await sheet.getByRole("button", { name: /Takarmánylap mentése/ }).click();
  await expect(sheet.getByRole("status")).toHaveText("Takarmánylap mentve.");
  await expect(listRow).toContainText("Mysis 20 g");
  await expect(listRow).not.toContainText("Mysis 15 g");
  // 6fe63c9b item 7: the coral feed is a tick, given or not, without a quantity
  await expect(sheet.getByRole("columnheader", { name: "AF Power elixir (adva)" })).toBeVisible();
  const coral = row.getByLabel(`${name}: AF Power elixir (adva)`);
  await coral.check();
  await sheet.getByRole("button", { name: /Takarmánylap mentése/ }).click();
  await expect(sheet.getByRole("status")).toHaveText("Takarmánylap mentve.");
  await expect(listRow).toContainText("AF Power elixir adva");
  await expect(coral).toBeChecked();
  page.once("dialog", (d) => void d.accept("teszt: nem kapott koralltápot"));
  await coral.uncheck();
  await sheet.getByRole("button", { name: /Takarmánylap mentése/ }).click();
  await expect(sheet.getByRole("status")).toHaveText("Takarmánylap mentve.");
  await expect(listRow).not.toContainText("AF Power elixir");
  await otherRow.getByRole("cell", { name: other, exact: true }).click();
  await expect(sheet.getByTestId(`sheet-cell-${name}-AF Power elixir`)).toHaveText("nem");
  await row.getByRole("cell", { name, exact: true }).click();
  // barracuda #45 (1): a draft is saved on the version it was TYPED on. Meanwhile the same cell is changed on another
  // sheet (another aquarist); this draft's save is refused, the other value stays, and the cell is marked
  await mysis.fill("25");
  const page2 = await page.context().newPage();
  await page2.goto(page.url());
  const sheet2 = page2.getByTestId("feeding-sheet");
  const row2 = sheet2.getByRole("row").filter({ hasText: name });
  await row2.getByRole("cell", { name, exact: true }).click();
  await row2.getByLabel(`${name}: Mysis (g)`).fill("30");
  await sheet2.getByRole("button", { name: /Takarmánylap mentése/ }).click();
  await expect(sheet2.getByRole("status")).toHaveText("Takarmánylap mentve.");
  await page2.close();
  // the first try is lost on the way; the sheet reloads, so it now holds the other value's version, the draft is kept.
  // A save sending the version read at the save would overwrite 30 now: the draft's own base must go
  await page.route("**/api/feeding/items", (route) => route.abort("failed"), { times: 1 });
  await sheet.getByRole("button", { name: /Takarmánylap mentése/ }).click();
  await expect(sheet.getByRole("status")).toHaveText("Nincs kapcsolat a szerverrel.");
  await expect(listRow).toContainText("Mysis 30 g");
  await expect(mysis).toHaveValue("25");
  await sheet.getByRole("button", { name: /Takarmánylap mentése/ }).click();
  await expect(sheet.getByRole("status")).toHaveText("A tétel időközben megváltozott.");
  await expect(sheet.getByTestId(`sheet-cell-${name}-Mysis`)).toHaveAttribute("data-failed", "true");
  await expect(listRow).toContainText("Mysis 30 g");
  await expect(listRow).not.toContainText("Mysis 25 g");
  page.once("dialog", (d) => void d.accept());
  await sheet.getByRole("button", { name: "Piszkozat elvetése" }).click();
  await expect(mysis).toHaveValue("30");
  // an emptied saved cell: its item is invalidated after a confirmation
  await row.getByLabel(`${name}: Litopenaeus vannamei (g)`).fill("");
  await row.getByLabel(`${name}: Litopenaeus vannamei (db)`).fill("");
  page.once("dialog", (d) => void d.accept("teszt: kiürített cella"));
  await sheet.getByRole("button", { name: /Takarmánylap mentése/ }).click();
  await expect(sheet.getByRole("status")).toHaveText("Takarmánylap mentve.");
  await expect(listRow).not.toContainText("Litopenaeus vannamei 40 g");
  await expect(sheet.getByTestId("sheet-grand-total")).toContainText("g");
  await expect(sheet.getByRole("button", { name: "Takarmánylap nyomtatása" })).toBeVisible();
  // barracuda #45 (3): a draft belongs to its day. The day navigation stays on the same route; after it, accepted,
  // the draft is gone, also when coming back to the day
  await mysis.fill("35");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("link", { name: "‹ előző nap" }).click();
  await expect(sheet.getByRole("button", { name: /Takarmánylap mentése \(/ })).toHaveCount(0);
  await page.getByRole("link", { name: "következő nap ›" }).click();
  await row.getByRole("cell", { name, exact: true }).click();
  await expect(mysis).toHaveValue("30");
  // barracuda #45 (2): leaving with a draft asks first; declined, the draft is still there; accepted, the page goes
  await mysis.fill("35");
  const leave = page.getByRole("link", { name: "Takarmánykivétel" });
  const asked: string[] = [];
  page.once("dialog", (d) => {
    asked.push(d.message());
    void d.dismiss();
  });
  await leave.click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toContain("Van még nem mentett érték a takarmánylapon.");
  await expect(mysis).toHaveValue("35");
  page.once("dialog", (d) => void d.accept());
  await leave.click();
  await expect(page.getByTestId("withdrawal-form")).toBeVisible();
});

test("feeding sheet: a row colour set in the settings colours that animal's or group's row, the highlighted row keeps its ink", async ({ page }) => {
  // Lili 2026-10-28 13:49 UTC (acrobot 37542). Teszt Egy and Teszt Kettő are in Nagymedence and in Teszt csoport.
  await login(page, "teszt.admin");
  await page.getByRole("link", { name: "Beállítások" }).click();
  const colours = page.getByTestId("sheet-colors");
  const setColour = async (label: string, colour: string) => {
    const form = colours.getByRole("row").filter({ has: page.getByLabel(`${label} sorszíne`, { exact: true }) });
    await form.getByLabel(`${label} sorszíne`, { exact: true }).selectOption({ label: colour });
    // already that colour (a run before this one): nothing to save, the button stays off
    const save = form.getByRole("button", { name: "Mentés" });
    if (!(await save.isEnabled())) return;
    await save.click();
    await expect(form.getByRole("status")).toHaveText("Mentve.");
  };
  await setColour("Teszt Egy", "Zöld");
  await setColour("Teszt Kettő", "Zöld");
  await setColour("Teszt csoport (csoport)", "Lila");
  await page.reload();
  await expect(colours.getByLabel("Teszt Egy sorszíne", { exact: true })).toHaveValue("GREEN");
  const GREEN = "rgb(217, 236, 217)";
  const PURPLE = "rgb(228, 219, 242)";

  await page.getByRole("link", { name: "Takarmánynapló", exact: true }).click();
  await page.getByRole("switch", { name: "Nagymedence: mind kijelölve" }).check();
  const dayFeeds = page.getByTestId("day-feeds");
  await dayFeeds.getByLabel("A nap takarmánya: Mysis").check();
  const saveFeeds = dayFeeds.getByRole("button", { name: "A nap takarmányainak mentése" });
  if (await saveFeeds.count()) await saveFeeds.click();
  else if (await dayFeeds.getByRole("button", { name: "Takarmánylap kész" }).count()) await dayFeeds.getByRole("button", { name: "Takarmánylap kész" }).click();
  const sheet = page.getByTestId("feeding-sheet");
  const row = (label: string) => sheet.getByRole("row").filter({ has: page.getByRole("cell", { name: label, exact: true }) });
  const cells = (label: string) => row(label).locator("td").evaluateAll((tds) => [...new Set(tds.map((td) => getComputedStyle(td).backgroundColor))]);
  await row("Teszt Kettő").click();
  expect(await cells("Teszt Egy"), "every cell of the row, the stuck name too").toEqual([GREEN]);
  expect(await cells("Teszt csoport (csoport)")).toEqual([PURPLE]);
  expect(await cells("Teszt Kettő"), "the highlighted row keeps its ink").not.toContain(GREEN);
  await row("Teszt Egy").click();
  expect(await cells("Teszt Kettő")).toEqual([GREEN]);
  // the eating log is not coloured: the colour is the feeding sheet's only
  expect(await page.locator('table:not([data-testid="feeding-sheet-table"]) td').evaluateAll((tds) => tds.some((td) => ["rgb(217, 236, 217)", "rgb(228, 219, 242)"].includes(getComputedStyle(td).backgroundColor)))).toBe(false);

  // back to none: the later runs start from no colour
  await page.getByRole("link", { name: "Beállítások" }).click();
  for (const label of ["Teszt Egy", "Teszt Kettő", "Teszt csoport (csoport)"]) await setColour(label, "Nincs szín");
});

test("feeding sheet: a small X empties an amount field in one click, on g and db each, only while it holds something", async ({ page }) => {
  // Lili 2026-10-29 (caparium-cella-torles-x): the same as deleting it by hand, no retyping
  await login(page, "teszt.admin");
  await page.getByRole("link", { name: "Takarmánynapló", exact: true }).click();
  await page.getByRole("switch", { name: "Nagymedence: mind kijelölve" }).check();
  const dayFeeds = page.getByTestId("day-feeds");
  await dayFeeds.getByLabel("A nap takarmánya: Litopenaeus vannamei").check();
  const saveFeeds = dayFeeds.getByRole("button", { name: "A nap takarmányainak mentése" });
  if (await saveFeeds.count()) await saveFeeds.click();
  else if (await dayFeeds.getByRole("button", { name: "Takarmánylap kész" }).count()) await dayFeeds.getByRole("button", { name: "Takarmánylap kész" }).click();
  const sheet = page.getByTestId("feeding-sheet");
  await sheet.getByRole("row").filter({ has: page.getByRole("cell", { name: "Teszt Egy", exact: true }) }).click();
  const g = sheet.getByLabel("Teszt Egy: Litopenaeus vannamei (g)", { exact: true });
  const db = sheet.getByLabel("Teszt Egy: Litopenaeus vannamei (db)", { exact: true });
  const clearG = sheet.getByRole("button", { name: "g kiürítése, Teszt Egy, Litopenaeus vannamei" });
  const clearDb = sheet.getByRole("button", { name: "db kiürítése, Teszt Egy, Litopenaeus vannamei" });
  await g.fill("");
  await db.fill("");
  await expect(clearG, "an empty field shows no X").toHaveCount(0);
  await g.fill("12");
  await db.fill("3");
  await expect(clearG).toBeVisible();
  await expect(clearDb).toBeVisible();
  // in the corner: the X sits inside the field's box, at its top right
  const [field, x] = await Promise.all([g.boundingBox(), clearG.boundingBox()]);
  expect(field && x && x.x > field.x + field.width / 2 && x.x + x.width <= field.x + field.width + 1 && x.y >= field.y - 1 && x.y + x.height <= field.y + field.height / 2 + 4).toBe(true);
  await clearG.click();
  await expect(g).toHaveValue("");
  await expect(db, "the other field of the pair keeps its value").toHaveValue("3");
  await expect(clearG).toHaveCount(0);
  await clearDb.click();
  await expect(db).toHaveValue("");
  // the row stays the active one: the click did not leave it
  await expect(g).toBeVisible();
});

test("the day's close also under the save button: the same action, it asks first beside an unsaved row", async ({ page }, info) => {
  // Lili 2026-10-29 08:29 UTC (msg 1565281522519375953). A past day of its own per project, so today's tests are untouched.
  const day = info.project.name === "tablet" ? "2026-01-13" : "2026-01-14";
  await login(page, "teszt.admin");
  await page.goto(`/evesi-naplo?nap=${day}`);
  const bottom = page.getByTestId("day-status-bottom");
  await expect(bottom.getByRole("button", { name: "Nap lezárása" })).toBeVisible();
  // below the save button, not beside the day's state on top
  const [save, close] = await Promise.all([page.getByTestId("eating-save-all").boundingBox(), bottom.boundingBox()]);
  expect(save && close && close.y > save.y).toBe(true);
  // an unsaved row: the close asks, and a "no" leaves the day open
  // on a past day nobody is on the list: the fasting rows are folded, and an exception opens a row
  await page.locator("details summary", { hasText: "Koplalónapos állatok" }).click();
  await page.getByRole("button", { name: "Teszt Egy: kivétel rögzítése" }).click();
  await page.getByLabel("Teszt Egy evési állapota", { exact: true }).selectOption({ index: 1 });
  await page.getByLabel("Teszt Egy vitamin", { exact: true }).check();
  await expect(page.getByTestId("eating-save-all"), "the row is a draft").toContainText("1 sor");
  let asked = "";
  page.once("dialog", (dialog) => {
    asked = dialog.message();
    void dialog.dismiss();
  });
  await bottom.getByRole("button", { name: "Nap lezárása" }).click();
  await expect.poll(() => asked).toContain("mentetlen");
  await expect(page.getByTestId("day-status")).toContainText("Nyitott");
  // without a draft it calls the same close as the top button, with the same answer from the server: a past day that
  // was not reopened is not closed by hand (the server's rule, unchanged), and both buttons say so
  await page.reload();
  const answer = "Csak újranyitott napot lehet kézzel lezárni.";
  await page.getByTestId("day-status-bottom").getByRole("button", { name: "Nap lezárása" }).click();
  await expect(page.getByTestId("day-status-bottom")).toContainText(answer);
  await page.getByTestId("day-status").getByRole("button", { name: "Nap lezárása" }).click();
  await expect(page.getByTestId("day-status")).toContainText(answer);
  // the feeding page has it under the sheet's save button too (today's day is not closed here)
  await page.goto("/etetes");
  await page.getByRole("switch", { name: "Nagymedence: mind kijelölve" }).check();
  const dayFeeds = page.getByTestId("day-feeds");
  await dayFeeds.getByLabel("A nap takarmánya: Mysis").check();
  const saveFeeds = dayFeeds.getByRole("button", { name: "A nap takarmányainak mentése" });
  if (await saveFeeds.count()) await saveFeeds.click();
  else if (await dayFeeds.getByRole("button", { name: "Takarmánylap kész" }).count()) await dayFeeds.getByRole("button", { name: "Takarmánylap kész" }).click();
  const sheet = page.getByTestId("feeding-sheet");
  await expect(sheet.getByTestId("day-status-bottom").getByRole("button", { name: "Nap lezárása" })).toBeVisible();
  const [sheetSave, sheetClose] = await Promise.all([
    sheet.getByRole("button", { name: /Takarmánylap mentése/ }).boundingBox(),
    sheet.getByTestId("day-status-bottom").boundingBox(),
  ]);
  expect(sheetSave && sheetClose && sheetClose.y > sheetSave.y).toBe(true);
});

test("feeding day restore: the day's operations, a dry run before one, the run with a reason puts it back (admin only)", async ({ page }, info) => {
  // Lili 2026-10-28 23:51 UTC (msg 1565150977861095475). A past day of its own per project.
  const day = info.project.name === "tablet" ? "2026-01-20" : "2026-01-21";
  page.on("dialog", (dialog) => void (dialog.type() === "prompt" ? dialog.accept("e2e proba") : dialog.accept()));
  await login(page, "teszt.admin");
  await page.goto(`/etetes?nap=${day}`);
  const sw = page.getByRole("switch", { name: "Nagymedence: mind kijelölve" });
  await sw.check();
  await expect(sw).toBeChecked();
  const restore = page.getByTestId("day-restore");
  await restore.locator("summary").click();
  await restore.getByRole("button", { name: "A nap műveletei" }).click();
  const ops = restore.getByTestId("day-restore-ops").getByRole("row");
  await expect(ops.last()).toBeVisible();
  await ops.last().getByRole("button", { name: /^Próba: .* előtti állapot$/ }).click();
  const plan = restore.getByTestId("day-restore-plan");
  await expect(plan).toContainText(/kijelölés le: \d+/);
  await expect(sw, "the dry run changed nothing").toBeChecked();
  // the reason field only while the app asks for reasons (off by default): no field, no reason
  const why = plan.getByLabel("A visszaállítás oka");
  if (await why.count()) await why.fill("e2e visszaallitas");
  await plan.getByRole("button", { name: "Visszaállítás" }).click();
  await expect(restore.getByRole("status")).toHaveText("A nap visszaállítva.");
  await expect(sw).not.toBeChecked();
  // an aquarist does not see it
  await logout(page);
  await login(page, "teszt.akvarista1");
  await page.goto(`/etetes?nap=${day}`);
  await expect(page.getByTestId("day-restore")).toHaveCount(0);
});

for (const [name, link] of [["daily", "Napi vízmérés"], ["weekly", "Heti vízmérés"]] as const) {
  test(`water measurement (${name}): the corner X empties a field in one click, only while it holds something`, async ({ page }) => {
    // Lili 2026-10-29 (Caparium thread 1565349971556049017): the feeding sheet's X on the water fields too; a draft only,
    // nothing is saved
    await login(page, "teszt.akvarista1");
    await page.getByRole("link", { name: link, exact: true }).first().click();
    const cell = page.locator('input[data-testid^="cell-"]').first();
    const x = cell.locator("xpath=..").getByRole("button", { name: /^Kiürítés, / });
    await cell.fill("");
    await expect(x, "an empty field shows no X").toHaveCount(0);
    await cell.fill("8,1");
    await expect(x).toBeVisible();
    const [field, box] = await Promise.all([cell.boundingBox(), x.boundingBox()]);
    expect(field && box && box.x > field.x + field.width / 2 && box.x + box.width <= field.x + field.width + 1 && box.y >= field.y - 1).toBe(true);
    await x.click();
    await expect(cell).toHaveValue("");
    await expect(x).toHaveCount(0);
  });
}

// Lili 2026-10-29 (Caparium thread 1565386596310716569): an emptied value came back after the save, under "Minden érték
// mentve.", when Bálint emptied what she had entered. A saved value emptied (here with the X) is invalidated on the save,
// after a confirmation, and since her "Legyen javítható nyugodtan." (1565398519064297503) by another aquarist too. Each
// project its own pool, a parameter no other test writes. WHAT TURNS RED: the emptied draft dropped without a request (the
// value is back after the reload); another aquarist refused.
for (const [name, link, tab, param] of [["daily", "Napi vízmérés", "Nagy medencék", "pH"], ["weekly", "Heti vízmérés", null, "KH"]] as const) {
  test(`water measurement (${name}): a saved value emptied by another aquarist is invalidated on the save`, async ({ page }, info) => {
    const pool = info.project.name === "tablet" ? "Karantén" : "Kismedence";
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.type());
      void (d.type() === "prompt" ? d.accept("e2e kiurites") : d.accept());
    });
    const open = async (loginId: string) => {
      await login(page, loginId);
      await page.getByRole("link", { name: link, exact: true }).first().click();
      if (tab) await page.getByRole("tab", { name: tab }).click();
      await page.getByRole("button", { name: pool, exact: true }).click();
    };
    const cell = page.getByTestId(`cell-${pool}-${param}`);
    const x = page.getByRole("button", { name: `Kiürítés, ${pool}, ${param}` });
    await open("teszt.akvarista1");
    await cell.fill("8,1");
    await page.getByTestId("save-all").click();
    await expect(page.getByTestId("banner")).toHaveText("Minden érték mentve.");

    await logout(page);
    await open("teszt.akvarista2");
    await expect(cell).toHaveValue("8,1");
    await x.click();
    await page.getByTestId("save-all").click();
    await expect(page.getByTestId("banner")).toHaveText("Minden érték mentve.");
    expect(dialogs, "the emptying asked first").not.toEqual([]);
    await page.reload();
    await page.getByRole("button", { name: pool, exact: true }).click();
    await expect(cell).toHaveValue("");
  });
}

test("settings: a module folds by its heading, and stays folded after a reload in that browser", async ({ page }) => {
  // Lili 2026-10-29 (caparium-finomitas-1)
  await login(page, "teszt.admin");
  await page.getByRole("link", { name: "Beállítások" }).click();
  const icons = page.getByTestId("icons");
  const save = icons.getByRole("button", { name: "Mentés" }).first();
  await expect(save, "open by default").toBeVisible();
  await icons.getByRole("heading", { name: "Ikonok" }).click();
  await expect(save).toBeHidden();
  await page.reload();
  await expect(page.getByTestId("icons").getByRole("button", { name: "Mentés" }).first(), "still folded").toBeHidden();
  // the other modules are untouched
  await expect(page.getByTestId("sheet-colors").getByRole("button", { name: "Mentés" }).first()).toBeVisible();
  await page.getByTestId("icons").getByRole("heading", { name: "Ikonok" }).click();
  await page.reload();
  await expect(page.getByTestId("icons").getByRole("button", { name: "Mentés" }).first(), "open again").toBeVisible();
});

test("settings: a pool goes off for a renovation and comes back", async ({ page }) => {
  // Lili 2026-10-29 (caparium-finomitas-1, item 2); the rules themselves are in tests/integration/pool-inactive.test.ts.
  // acrobot 37943: inactive, it is gone from the users' pages (today's grid too) and shown only in the settings' list with
  // the "Inaktívak mutatása" switch, from where it is activated
  page.on("dialog", (d) => void d.accept());
  await login(page, "teszt.admin");
  await page.getByRole("link", { name: "Beállítások" }).click();
  const row = page.getByTestId("pool-Ragadozós");
  const showInactive = page.getByRole("switch", { name: /^Inaktívak mutatása/ });
  await row.getByRole("button", { name: "Ragadozós: inaktiválás" }).click();
  // the row switched here stays until the page is left: its message is read, and it can be undone at once
  await expect(row.getByRole("status")).toHaveText("Inaktiválva.");
  await expect(row).toHaveClass(/invalid/);
  await page.reload();
  await expect(row, "an inactive pool is hidden by default").toHaveCount(0);
  await expect(showInactive).not.toBeChecked();
  // off the weekly grid of today
  await page.getByRole("link", { name: "Heti vízmérés", exact: true }).first().click();
  await expect(page.getByTestId("row-Nagymedence")).toBeVisible();
  await expect(page.getByTestId("row-Ragadozós")).toHaveCount(0);
  // back, within the test: the other tests measure in it
  await page.getByRole("link", { name: "Beállítások" }).click();
  await showInactive.check();
  await expect(row).toHaveClass(/invalid/);
  await row.getByRole("button", { name: "Ragadozós: aktiválás" }).click();
  await expect(row).not.toHaveClass(/invalid/);
  await expect(row.getByRole("button", { name: "Ragadozós: inaktiválás" })).toBeVisible();
  await page.reload();
  // another test may leave a pool of its own inactive, so the switch itself may stay; this row needs it no more
  await expect(row, "active: listed without the switch").toBeVisible();
});

for (const [name, link] of [["daily", "Napi vízmérés"], ["weekly", "Heti vízmérés"]] as const) {
  test(`water measurement (${name}): header row and pool column stay put only when the table is wider than the screen`, async ({ page }) => {
    // Lili 2026-10-29 (caparium-finomitas-1, item 4)
    await login(page, "teszt.akvarista1");
    await page.getByRole("link", { name: link, exact: true }).first().click();
    const box = page.getByTestId("grid-scroll");
    const head = box.locator("thead th").first();
    const firstCell = box.locator("tbody tr").first().locator("td").first();
    // where it fits (this project's tablet or desktop size), nothing changes
    if (!(await box.evaluate((el) => (el.querySelector("table") as HTMLElement).offsetWidth > el.clientWidth + 1))) {
      await expect(box).not.toHaveClass(/grid-overflow/);
      expect(await head.evaluate((el) => getComputedStyle(el).position)).toBe("static");
    }
    // a phone: the table is wider than the screen, the header and the pool column stick
    await page.setViewportSize({ width: 390, height: 760 });
    await expect(box).toHaveClass(/grid-overflow/);
    expect(await head.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
    const scrolled = await box.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
      return el.scrollLeft;
    });
    expect(scrolled, "the table scrolls sideways").toBeGreaterThan(0);
    const [boxLeft, cellLeft] = await Promise.all([box.evaluate((el) => el.getBoundingClientRect().left), firstCell.evaluate((el) => el.getBoundingClientRect().left)]);
    expect(Math.abs(cellLeft - boxLeft), "the pool name stays at the left").toBeLessThan(1);
    expect(await firstCell.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);
    // wide again: as before
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(box).not.toHaveClass(/grid-overflow/);
  });
}

test("intake (Takarmányhűtő): an item in the stock; a returned delivery shows on the list and does not change the stock", async ({ page }, info) => {
  // each layout receives its own feed
  const feedName = info.project.name === "tablet" ? "Teszt hal" : "Teszt kagyló";
  // a retry of this test (same database) must not meet its own first attempt's rows: the notes are unique per attempt
  const tag = `${info.project.name}-${info.retry}-${Date.now()}`;
  const opening = `nyitó készlet ${tag}`;
  const sentBack = `nem megfelelő ${tag}`;
  await login(page, "teszt.akvarista1");
  await page.getByRole("navigation", { name: "Fő navigáció" }).getByRole("link", { name: "Takarmányhűtő" }).click();
  await expect(page.getByTestId("day-picker").getByRole("button", { name: "Ugrás" })).toBeVisible();
  const form = page.getByTestId("intake-form");
  await form.getByLabel("Takarmány", { exact: true }).selectOption({ label: feedName });
  await form.getByLabel("Mennyiség (tömeg)", { exact: true }).fill("1");
  // Lili 2026-10-30: the intake unit list starts on kg
  await expect(form.getByLabel("Egység (tömeg)").locator("option:checked")).toHaveText("kg");
  await form.getByLabel("Megjegyzés").fill(opening);
  await form.getByRole("button", { name: "Mentés" }).click();
  await expect(form.getByRole("status")).toHaveText("Tétel mentve.");
  const listed = page.getByTestId("intake-list").getByRole("row").filter({ hasText: opening });
  await expect(listed).toHaveCount(1);
  await expect(listed).toContainText(feedName);
  const stockRow = page.getByTestId("feed-stock").getByRole("row").filter({ hasText: feedName });
  await expect(stockRow).toHaveCount(1);
  const level = (await stockRow.locator("td").nth(2).textContent()) ?? "";
  expect(level).not.toBe("");
  // sent back: the item shows, marked, and the stock stays as it was
  await form.getByLabel("Mennyiség (tömeg)", { exact: true }).fill("0,5");
  await form.getByLabel("Megjegyzés").fill(sentBack);
  await form.getByLabel("Visszaküldve").check();
  await form.getByRole("button", { name: "Mentés" }).click();
  await expect(form.getByRole("status")).toHaveText("Tétel mentve.");
  const back = page.getByTestId("intake-list").getByRole("row").filter({ hasText: sentBack });
  await expect(back).toHaveCount(1);
  await expect(back).toHaveAttribute("data-returned", "yes");
  await expect(stockRow.locator("td").nth(2)).toHaveText(level);
  // the withdrawal page shows that stock under the chosen feed, and warns when the typed amount is more than it
  await page.getByRole("link", { name: "Takarmánykivétel" }).click();
  const take = page.getByTestId("withdrawal-form");
  await take.getByLabel("Takarmány", { exact: true }).selectOption({ label: feedName });
  await expect(take.getByTestId("stock-hint").first()).toContainText("Készlet:");
  await take.getByLabel("Mennyiség (tömeg)", { exact: true }).fill("99999999");
  await expect(take.getByTestId("stock-hint").first()).toContainText("meghaladja a készletet");
  // the report (Lili 2026-10-30): the PDF and the Excel of the period, from the Takarmányhűtő page
  await page.getByRole("navigation", { name: "Fő navigáció" }).getByRole("link", { name: "Takarmányhűtő" }).click();
  const pdf = await Promise.all([page.waitForEvent("download"), page.getByTestId("intake-pdf").click()]);
  expect(pdf[0].suggestedFilename()).toMatch(/^Capasuli_takarmanyegyenleg_\d{4}-\d{2}-\d{2}(_\d{4}-\d{2}-\d{2})?\.pdf$/);
  const xlsx = await Promise.all([page.waitForEvent("download"), page.getByTestId("intake-excel").click()]);
  expect(xlsx[0].suggestedFilename()).toMatch(/^Capasuli_takarmanyegyenleg_\d{4}-\d{2}-\d{2}(_\d{4}-\d{2}-\d{2})?\.xlsx$/);
});

test("withdrawal: an item for tomorrow, the day's total, taken against given, the Excel", async ({ page }, info) => {
  // each layout takes out its own feed: one item per feed and day
  const feedName = info.project.name === "tablet" ? "Teszt hal" : "Teszt kagyló";
  await login(page, "teszt.akvarista1");
  await page.getByRole("link", { name: "Takarmánykivétel" }).click();
  // Lili 2026-10-26 (card f67b1a06, item 5): a date picker beside the day arrows, as on the water measurement pages
  await expect(page.getByTestId("day-picker").getByRole("button", { name: "Ugrás" })).toBeVisible();
  const form = page.getByTestId("withdrawal-form");
  await form.getByLabel("Takarmány", { exact: true }).selectOption({ label: feedName });
  await form.getByLabel("Mennyiség (tömeg)", { exact: true }).fill("200");
  await form.getByRole("button", { name: "Kivétel mentése" }).click();
  await expect(form.getByRole("status")).toHaveText("Kivétel mentve.");
  await expect(page.getByTestId("withdrawal-list")).toContainText(feedName);
  // Lili 2026-10-27 12:42 UTC (item 8): "Módosítás" loads the item into the form below; saving updates the same item
  const taken = page.getByTestId("withdrawal-list").getByRole("row").filter({ hasText: feedName });
  await expect(taken).toHaveCount(1);
  await taken.getByRole("button", { name: "módosítás" }).click();
  await expect(form.getByLabel("Mennyiség (tömeg)", { exact: true })).toHaveValue("200");
  await form.getByLabel("Mennyiség (tömeg)", { exact: true }).fill("250");
  await form.getByRole("button", { name: "Módosítás mentése" }).click();
  await expect(form.getByRole("status")).toHaveText("Kivétel módosítva.");
  await expect(taken).toHaveCount(1);
  await expect(taken).toContainText("250 g");
  await expect(form.getByRole("button", { name: "Kivétel mentése" })).toBeVisible();
  await expect(page.getByTestId("withdrawal-total")).toContainText("g");
  await expect(page.getByTestId("taken-given")).toBeVisible();
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByTestId("excel-kivetel").click()]);
  expect(file.suggestedFilename()).toMatch(/^Takarmanykivetel_\d{4}-\d{2}-\d{2}/);
});

// Lili 2026-10-27 20:49 UTC (acrobot 37044): a gram row with a value of 1000 g or more is shown in kg as a whole.
test("taken against given: a row reaching 1000 g is shown in kg, two decimals", async ({ page }, info) => {
  // each layout its own mass-only feed (a piece feed would add a second row); yesterday's item is used today, so it falls
  // into the default period
  const feedName = info.project.name === "tablet" ? "Teszt tintahal" : "Teszt hal";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest" }).format(new Date());
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  await login(page, "teszt.admin");
  await page.goto(`/kivetel?nap=${yesterday.toISOString().slice(0, 10)}`);
  // one item per feed and day: a retry finds it already there
  if ((await page.getByTestId("withdrawal-list").getByRole("row").filter({ hasText: feedName }).count()) === 0) {
    const form = page.getByTestId("withdrawal-form");
    await form.getByLabel("Takarmány", { exact: true }).selectOption({ label: feedName });
    await form.getByLabel("Mennyiség (tömeg)", { exact: true }).fill("1500");
    await form.getByRole("button", { name: "Kivétel mentése" }).click();
    await expect(form.getByRole("status")).toHaveText("Kivétel mentve.");
  }
  const row = page.getByTestId("taken-given").getByRole("row").filter({ hasText: feedName });
  await expect(row.getByRole("cell").nth(1)).toHaveText("kg");
  await expect(row.getByRole("cell").nth(2)).toHaveText("1,50");
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
  // EGY-08: the feeding page shows the reference in the animal's row. Since Lili's simpler chooser (2026-10-21) the
  // items table lists only the day's animals, so the animal goes on today's list first
  await page.getByRole("link", { name: "Takarmánynapló", exact: true }).click();
  await page.getByLabel(`${name} a mai listán`).check();
  await expect(page.getByTestId("feeding-list").getByRole("row").filter({ hasText: name })).toContainText("ref 250 g");
  // package item 4: nothing given yet, so the reference stays quiet (neither the green nor the red mark)
  await expect(page.getByTestId("feeding-list").getByRole("row").filter({ hasText: name }).locator(".ref-value")).toHaveAttribute("data-state", "none");
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

test("dosing: an admin changes and inactivates a chemical; it is not offered while inactive, its stock row stays", async ({ page }, info) => {
  // Lili 2026-10-28 16:06 UTC (caparium-vegyszer-inaktival). Each project its own chemical, so the second run meets none.
  const name = `Inaktiv proba ${info.project.name}`;
  await login(page, "teszt.admin");
  await page.getByRole("link", { name: "Vegyszeradagolás" }).click();
  const fresh = page.getByTestId("new-chemical");
  if ((await page.getByTestId("stock").getByRole("row").filter({ hasText: name }).count()) === 0) {
    await fresh.getByLabel("Új vegyszer neve").fill(name);
    await fresh.getByRole("button", { name: "Felvétel" }).click();
    await expect(fresh.getByRole("status")).toHaveText("Vegyszer felvéve.");
  }
  const offered = () => page.getByTestId("dosing-form").getByLabel("Szer", { exact: true }).locator("option", { hasText: name });
  const row = page.getByTestId("stock").getByRole("row").filter({ hasText: name });
  await expect(offered()).toHaveCount(1);
  // a rename, the same way as a feed's (with the reasons off only a confirmation)
  page.once("dialog", (dialog) => void (dialog.type() === "prompt" ? dialog.accept("elirtam a nevet") : dialog.accept()));
  await row.getByRole("button", { name: `${name}: módosítás` }).click();
  await row.getByLabel("Vegyszer új neve").fill(`${name} uj`);
  await row.getByRole("button", { name: "Mentés" }).click();
  const renamed = page.getByTestId("stock").getByRole("row").filter({ hasText: `${name} uj` });
  await expect(renamed).toHaveCount(1);
  await renamed.getByRole("button", { name: `${name} uj: inaktiválás` }).click();
  await expect(renamed.getByRole("button", { name: `${name} uj: aktiválás` })).toBeVisible();
  // not offered for a dosing nor a stock line; the row stays, marked
  await expect(page.getByTestId("dosing-form").getByLabel("Szer", { exact: true }).locator("option", { hasText: `${name} uj` })).toHaveCount(0);
  await expect(page.getByTestId("movement-form").locator("option", { hasText: `${name} uj` })).toHaveCount(0);
  await expect(renamed).toHaveClass(/invalid/);
  // Lili 2026-10-29 (package item 16, as the feeds): after the page is left the inactive row is hidden, behind
  // "Inaktívak mutatása"; with the switch on it is there, marked, to be activated again
  await page.reload();
  await expect(renamed).toHaveCount(0);
  await page.getByTestId("stock").locator("..").getByRole("switch", { name: /^Inaktívak mutatása/ }).check();
  await expect(renamed).toHaveClass(/invalid/);
  // active again, and back to the first name: a second run starts where this one did
  await renamed.getByRole("button", { name: `${name} uj: aktiválás` }).click();
  await expect(page.getByTestId("dosing-form").getByLabel("Szer", { exact: true }).locator("option", { hasText: `${name} uj` })).toHaveCount(1);
  page.once("dialog", (dialog) => void (dialog.type() === "prompt" ? dialog.accept("vissza az eredeti nevre") : dialog.accept()));
  await renamed.getByRole("button", { name: `${name} uj: módosítás` }).click();
  await renamed.getByLabel("Vegyszer új neve").fill(name);
  await renamed.getByRole("button", { name: "Mentés" }).click();
  await expect(offered()).toHaveCount(1);
});

test("a pool's own band and volume in the settings; the chemical calculator under dosing works with them", async ({ page }, info) => {
  // caparium-hibak-3; each project its own pool, so the second run does not meet the first one's values
  const pool = info.project.name === "tablet" ? "Ragadozós" : "Inkubátor";
  await login(page, "teszt.admin");
  await page.getByRole("link", { name: "Beállítások" }).click();
  const volumes = page.getByTestId("pool-volumes");
  await volumes.getByLabel(`${pool} űrtartalma (liter)`).fill("1000");
  // the row has two forms since package item 5b: the volume's Mentés first, the system's last
  const poolRow = volumes.getByRole("row").filter({ hasText: pool });
  await poolRow.getByRole("button", { name: "Mentés" }).first().click();
  await expect(poolRow.getByRole("status").first()).toHaveText("Mentve.");
  await page.waitForLoadState("networkidle");
  // Lili 2026-10-29 (package item 5b): the pool's system, coral; a rerun finds it set already and saves nothing
  const system = poolRow.getByLabel(`${pool} rendszere`);
  if ((await system.inputValue()) !== "CORAL") {
    await system.selectOption({ label: "korallos" });
    await poolRow.getByRole("button", { name: "Mentés" }).last().click();
    await expect(poolRow.getByRole("status").last()).toHaveText("Mentve.");
    await page.waitForLoadState("networkidle");
  }

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
  // package item 5b: the pool's system comes with it (coral: at most 10 mg/l a day), so +40 mg/l is 4 days
  await expect(calc.getByLabel("Rendszer")).toHaveValue("CORAL");
  await expect(calc.getByTestId("chem-CA-daily")).toHaveText("Ajánlott: 4 nap alatt, naponta 36,7 g (+10 mg/l/nap; korallos rendszer: legfeljebb 10 mg/l naponta).");
  // a fish system takes 20 mg/l a day: 2 days; without a system it asks, it does not guess
  await calc.getByLabel("Rendszer").selectOption({ label: "halas" });
  await expect(calc.getByTestId("chem-CA-daily")).toContainText("Ajánlott: 2 nap alatt, naponta 73,4 g");
  await calc.getByLabel("Rendszer").selectOption({ label: "nincs megadva" });
  await expect(calc.getByTestId("chem-CA-daily")).toContainText("válaszd ki a rendszert");
  await card.getByLabel("Kalcium emelése: célérték").fill("370");
  await expect(calc.getByTestId("chem-CA-result")).toHaveText("A célérték nem magasabb a jelenlegi értéknél, nincs szükség adagolásra.");
  // Lili 2026-10-29 (package item 5a): every card's result stays inside its card, the longest text included, at her
  // tablet's width (on the desktop the three cards are wide enough either way, so the check would not bite there)
  await card.getByLabel("Kalcium emelése: célérték").fill("");
  await page.setViewportSize({ width: 1024, height: 768 });
  for (const code of ["CA", "MG", "KH"]) {
    const inside = await calc.getByTestId(`chem-${code}-result`).evaluate((el) => {
      const own = el.getBoundingClientRect();
      const box = el.parentElement!.getBoundingClientRect();
      return el.scrollWidth <= el.clientWidth && own.right <= box.right + 0.5;
    });
    expect(inside, `chem-${code}-result`).toBe(true);
  }
});

test("reports: the tables and the Excel; no daily report menu any more", async ({ page }) => {
  await login(page, "teszt.akvarista1");
  await page.getByRole("link", { name: "Kimutatások" }).click();
  await expect(page.getByTestId("report-by-day")).toContainText("Összesen");
  await expect(page.getByTestId("report-by-recipient")).toBeVisible();
  // Lili 2026-10-29 (package item 12): a group header over the feeds and one over the totals; the total line apart at
  // the bottom (tfoot), bold on its own background; the rows banded (a second row's background differs from the first's)
  for (const id of ["report-by-day", "report-by-recipient"]) {
    const t = page.getByTestId(id);
    await expect(t.getByTestId("report-group").last()).toHaveText("Összesítés");
    const total = t.locator("tfoot").getByTestId("report-total");
    await expect(total).toContainText("Összesen");
    const [weight, bg] = await total.locator("td").first().evaluate((el) => [getComputedStyle(el).fontWeight, getComputedStyle(el).backgroundColor]);
    expect([weight, bg === "rgba(0, 0, 0, 0)"]).toEqual(["700", false]);
    // item 12 follow-up (Lili, msg 1565472118970257490): the vertical totals stand out too: bold and their own background
    if ((await t.locator("tbody td.report-sum").count()) > 0) {
      const sum = t.locator("tbody tr").first().locator("td.report-sum").first();
      const [sumWeight, sumBg, plainBg] = await sum.evaluate((el) => [
        getComputedStyle(el).fontWeight,
        getComputedStyle(el).backgroundColor,
        getComputedStyle(el.parentElement!.querySelector("td:not(.report-sum)")!.nextElementSibling ?? el).backgroundColor,
      ]);
      expect(sumWeight).toBe("700");
      expect(sumBg).not.toBe(plainBg);
    }
    // picture 12c: the line between two groups runs down through the rows: the cell under a group's first feed header has
    // the same left line as the header cell (where there are two groups or more)
    const starts = t.locator("thead th.report-gstart");
    if ((await starts.count()) > 0) {
      const lineOf = (loc: ReturnType<typeof t.locator>) => loc.first().evaluate((el) => getComputedStyle(el).borderLeftWidth);
      expect(await lineOf(starts)).toBe("1px");
      expect(await lineOf(t.locator("tbody td.report-gstart"))).toBe("1px");
      expect(await lineOf(t.locator("tfoot td.report-gstart"))).toBe("1px");
    }
    const rows = t.locator("tbody tr");
    if ((await rows.count()) > 1) {
      const bgOf = (n: number) => rows.nth(n).locator("td").first().evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(await bgOf(0)).not.toBe(await bgOf(1));
    }
  }
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByTestId("excel-kimutatas").click()]);
  expect(file.suggestedFilename()).toMatch(/^Kimutatas_\d{4}-\d{2}-\d{2}/);
  // caparium-hibak-4: the daily report menu is gone (its Excel is the export page's, for one day)
  await expect(page.getByRole("link", { name: "Napi jelentő" })).toHaveCount(0);
  // VIZ-20: the monthly package's card on the export page; the overview's feeding tile
  await page.getByRole("link", { name: "Export" }).click();
  await expect(page.getByTestId("monthly-package")).toContainText("Havi ZIMS-csomag");
  await page.getByRole("link", { name: "START", exact: true }).click();
  await expect(page.getByTestId("home-evesi")).toBeVisible();
});

test("home: the customer's illustrated cards, 3-3-3 with a narrow portrait one between two, each to its module, only with access; one column on a phone", async ({ page }) => {
  // caparium-hibak-5 (Balázs 2026-10-20 11:37 UTC)
  await login(page, "teszt.akvarista1");
  const rows = page.locator(".home-row");
  await expect(rows).toHaveCount(3);
  // Lili 2026-10-26 (msg 1564412957499330631): no "A mai nap gyorsindítója" module; the two pages it linked stay one click away
  await expect(page.getByText("gyorsindítója")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Új mérés" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Vízmérési napló" }), "the log is still in the menu").toBeVisible();
  await expect(page.getByTestId("home-nagymedencek"), "the daily water pages are still cards").toBeVisible();
  const captions = async (i: number) => (await rows.nth(i).locator(".home-caption").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  expect(await captions(0)).toEqual(["Nagy medencék NAPI VÍZMÉRÉS", "Kis medencék NAPI VÍZMÉRÉS", "HETI VÍZMÉRÉS"]);
  // Lili 2026-10-30: the fridge card between the two landscape ones
  expect(await captions(1)).toEqual(["Nyomelem és megkötő adagolás", "Takarmányhűtő", "Takarmány kalkulátor"]);
  expect(await captions(2)).toEqual(["Takarmány kivételi napló", "Egyedi takarmánynapló", "Evési napló"]);
  // every picture is the web-sized one and loads
  for (const img of await page.locator(".home-card img").all()) {
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((e) => (e as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(await img.getAttribute("src")).toMatch(/^\/kezdolap\/[a-z]+\.webp$/);
  }
  // the middle row is symmetric around the narrow card: the two landscape cards are as wide as the first row's, the narrow one is
  // about half as wide, and its picture is as tall as theirs (Lili 2026-10-30: "a szimmetria ne boruljon fel")
  const box = async (row: number, i: number) => (await rows.nth(row).locator(".home-card").nth(i).boundingBox())!;
  const img = async (row: number, i: number) => (await rows.nth(row).locator(".home-card").nth(i).locator("img").boundingBox())!;
  const [a, left, mid, right] = [await box(0, 0), await box(1, 0), await box(1, 1), await box(1, 2)];
  expect(Math.abs(left.width - a.width)).toBeLessThan(2);
  expect(Math.abs(right.width - left.width)).toBeLessThan(2);
  expect(mid.width).toBeLessThan(left.width * 0.6);
  expect(mid.width).toBeGreaterThan(left.width * 0.4);
  expect(Math.abs(mid.x + mid.width / 2 - (left.x + right.x + right.width) / 2)).toBeLessThan(4);
  const [li, mi, ri] = [await img(1, 0), await img(1, 1), await img(1, 2)];
  expect(Math.abs(mi.height - li.height)).toBeLessThan(3);
  expect(Math.abs(ri.height - li.height)).toBeLessThan(3);
  // the fridge card goes to the Takarmányhűtő
  await page.getByTestId("home-takarmanyhuto").click();
  await expect(page).toHaveURL(/\/takarmanyhuto$/);
  await page.goto("/");
  await page.getByTestId("home-kismedencek").click();
  await expect(page).toHaveURL(/\/vizmeres\?csoport=NAPI_KIS/);
  await expect(page.getByRole("tab", { name: "Kis Akváriumok" })).toHaveAttribute("aria-selected", "true");

  // phone width: one column
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  // the cards stand in one centred column: every card's CENTRE is the same (the narrow card is narrower, so its left edge is not),
  // and the narrow one is about 56% of the column (Lili 2026-10-30: centred, in the existing wrapping)
  const cards = await page.locator(".home-card").evaluateAll((els) => els.map((e) => ({ narrow: e.classList.contains("home-card-narrow"), r: e.getBoundingClientRect() })));
  expect(new Set(cards.map((c) => Math.round(c.r.x + c.r.width / 2))).size).toBe(1);
  const full = cards.find((c) => !c.narrow)!.r.width;
  const narrow = cards.find((c) => c.narrow)!.r.width;
  expect(narrow / full).toBeGreaterThan(0.5);
  expect(narrow / full).toBeLessThan(0.62);
  expect(new Set(cards.filter((c) => !c.narrow).map((c) => Math.round(c.r.x))).size).toBe(1);

  // no access to a module: its cards are gone (the dosing module set to NONE for a fresh aquarist)
  const db = new PrismaClient();
  try {
    const u = await db.user.findUniqueOrThrow({ where: { loginId: "teszt.akvarista2" } });
    await db.modulePermission.upsert({ where: { userId_module: { userId: u.id, module: "DOSING" } }, update: { level: "NONE" }, create: { userId: u.id, module: "DOSING", level: "NONE" } });
    // and the fridge card follows the withdrawal module (the page's own), as the dosing card follows dosing
    await db.modulePermission.upsert({ where: { userId_module: { userId: u.id, module: "WITHDRAWAL" } }, update: { level: "NONE" }, create: { userId: u.id, module: "WITHDRAWAL", level: "NONE" } });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.context().clearCookies(); // a new login, not the first user's session
    await login(page, "teszt.akvarista2");
    await expect(page.getByTestId("home-kalkulator")).toBeVisible();
    await expect(page.getByTestId("home-adagolas")).toHaveCount(0);
    await expect(page.getByTestId("home-takarmanyhuto")).toHaveCount(0);
  } finally {
    const u = await db.user.findUniqueOrThrow({ where: { loginId: "teszt.akvarista2" } });
    await db.modulePermission.deleteMany({ where: { userId: u.id, module: { in: ["DOSING", "WITHDRAWAL"] } } });
    await db.$disconnect();
  }
});

// 6fe63c9b, item 4: the timetable. The starting data is intentionally empty (acrobot 34526), so the first run shows
// the empty-state line; each layout ticks its own day for a seeded animal. Not one of the starting list (Philleas):
// that list is loaded only by a later test, so the first (tablet) run did not have it in CI (#43 v2, red there).
test("the feeding timetable: every animal's days on one screen, saved together, from an empty start", async ({ page }, info) => {
  // never today's weekday (barracuda #43): a later "Lista a terv szerint" must not pull this animal onto today's list,
  // whatever day the suite runs; each layout its own day
  const labels = ["H", "K", "Sze", "Cs", "P", "Szo", "V"];
  const short = new Date().toLocaleDateString("en-GB", { weekday: "short", timeZone: "Europe/Budapest" });
  const today = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(short);
  const day = labels[(today + (info.project.name === "tablet" ? 2 : 3)) % 7]!;
  // Lili 2026-10-26 (msg 1564404799359946884): the timetable is the admin's for now
  await login(page, "teszt.admin");
  await page.getByRole("link", { name: "Takarmánynapló", exact: true }).click();
  await page.getByRole("link", { name: "Etetési rend" }).click();
  const table = page.getByTestId("timetable");
  await expect(table).toBeVisible();
  // the empty-state line shows exactly when no animal has a plan yet (not tied to which project runs first)
  if ((await table.locator("input[type=checkbox]:checked").count()) === 0) {
    await expect(page.getByTestId("timetable-empty")).toContainText("Még nincs etetési terv");
  } else {
    await expect(page.getByTestId("timetable-empty")).toHaveCount(0);
  }
  await table.getByLabel(`Teszt Négy: ${day}`).check();
  await table.getByRole("button", { name: /Etetési rend mentése/ }).click();
  await expect(table.getByRole("status")).toHaveText("Mentve: 1 állat terve.");
  await page.reload();
  await expect(page.getByTestId("timetable").getByLabel(`Teszt Négy: ${day}`)).toBeChecked();
  await expect(page.getByTestId("timetable-empty")).toHaveCount(0);
});

test("conveniences: a feeding plan, the list from it, the feed type icons", async ({ page }) => {
  // Teszt Három: the feeding test expects Teszt Négy OFF today's list, and the plan adds to it
  await login(page, "teszt.admin");
  // Lili 2026-10-29 (package item 6): an animal's page has no "Etetési napok" row any more; the feeding timetable
  // writes the same plan (feeding_plan), so the plan is made there
  await page.getByRole("link", { name: "Állatok" }).click();
  await page.getByTestId("animals-table").getByRole("link", { name: "Teszt Három" }).click();
  await expect(page.getByText("Etetési napok")).toHaveCount(0);
  await page.getByRole("link", { name: "Takarmánynapló", exact: true }).click();
  await page.getByRole("link", { name: "Etetési rend" }).click();
  const table = page.getByTestId("timetable");
  for (const d of ["H", "K", "Sze", "Cs", "P", "Szo", "V"]) await table.getByLabel(`Teszt Három: ${d}`).check();
  // the other layout's run may have saved this very plan already: then nothing changed and the button stays off
  const save = table.getByRole("button", { name: /Etetési rend mentése/ });
  if (await save.isEnabled()) {
    await save.click();
    await expect(table.getByRole("status")).toHaveText(/^Mentve: \d+ állat terve\.$/);
  }
  await page.reload();
  for (const d of ["H", "K", "Sze", "Cs", "P", "Szo", "V"]) await expect(page.getByTestId("timetable").getByLabel(`Teszt Három: ${d}`)).toBeChecked();
  await page.getByRole("link", { name: "Takarmánynapló", exact: true }).click();
  await page.getByRole("button", { name: "Mai Terv" }).click();
  await expect(page.getByLabel("Teszt Három a mai listán")).toBeChecked();
  await page.getByRole("link", { name: "Takarmánylista" }).click();
  await expect(page.getByRole("heading", { name: "🦐 Rákok" })).toBeVisible();
});

// card 8b22c3c2 and barracuda on #109: what the helper says by itself (an alert, a greeting) and the strip it
// leaves when switched off take no click. Measured at the point, not by a click that may land elsewhere: the
// element under the centre of the notice is the page's, and the save button's centre is the save button.
async function passesClicks(page: Page, testId: string): Promise<boolean> {
  const box = (await page.getByTestId(testId).boundingBox())!;
  return page.evaluate(([x, y]) => !document.elementFromPoint(x, y)?.closest(".helper, .helper-urgent"), [box.x + box.width / 2, box.y + box.height / 2]);
}
async function topIs(page: Page, testId: string): Promise<boolean> {
  const target = page.getByTestId(testId);
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  return page.evaluate(([x, y, id]) => !!document.elementFromPoint(x as number, y as number)?.closest(`[data-testid="${id}"]`), [box.x + box.width / 2, box.y + box.height / 2, testId]);
}

test("the helper: it speaks unasked without taking a click, the quick questions from the figure, switched in the header, the urgent notice stays", async ({ page }) => {
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
  // barracuda on #109: what is shown follows the refreshed data. A fresh session here: the alert speaks; one more
  // dose refreshes the page, the key stays, and the notice on show takes the new level instead of keeping the old.
  // The save's router.refresh must land first: landing after the clear, it marks the alert seen again on this page
  // just before the reload (measured locally, 2026-10-29)
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  // a login not greeted yet: the hello comes first and goes with the first click; the alert speaks after it (Lili 2026-10-29)
  await expect(page.getByTestId("helper-notice")).toHaveAttribute("data-kind", "greeting");
  await page.getByTestId("current-user").click();
  const shown = page.getByTestId("helper-notice");
  await expect(shown).toContainText("Teszt só");
  const before = await shown.textContent();
  await form.getByLabel("Medence", { exact: true }).selectOption({ label: "Sózó" });
  await form.getByLabel("Szer", { exact: true }).selectOption({ label: "Teszt só" });
  await form.getByLabel("Mennyiség", { exact: true }).fill("100");
  await form.getByLabel("Egység", { exact: true }).selectOption({ label: "g" });
  await form.getByRole("button", { name: "+ Adagolás mentése" }).click();
  await expect(form.getByRole("status")).toHaveText("Adagolás mentve.");
  await expect(shown).not.toHaveText(before!);
  await expect(shown).toContainText("Teszt só");
  // a fresh session on the overview: the pages before may already have shown the alert
  await page.getByRole("link", { name: "START", exact: true }).click();
  // Lili 2026-10-27 13:02 UTC: the start page has no "Mai áttekintés" title; what is under the bar stays
  await expect(page.getByRole("heading", { name: "Jó munkát!" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mai áttekintés" })).toHaveCount(0);
  // barracuda on #122: the first click after the login is mostly a menu link; the alert must not be marked heard behind
  // it, and must speak on the page the link leads to
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.getByTestId("helper-notice")).toHaveAttribute("data-kind", "greeting");
  await page.getByRole("link", { name: "Napi vízmérés", exact: true }).click();
  await expect(page).toHaveURL(/\/vizmeres/);
  await expect(page.getByTestId("helper-notice")).toHaveAttribute("data-kind", "alert");
  await expect(page.getByTestId("helper-notice")).toContainText("Teszt só");
  await page.getByRole("link", { name: "START", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Jó munkát!" })).toBeVisible();
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  // AST-03: the overview's helper speaks by itself, once, as a notice: the bubble with the buttons stays closed
  const first = page.getByTestId("helper");
  await expect(first).toHaveAttribute("data-ready", "1");
  await expect(first.getByTestId("helper-notice")).toHaveAttribute("data-kind", "greeting");
  await page.getByTestId("current-user").click();
  await expect(first.getByTestId("helper-notice")).toHaveAttribute("data-kind", "alert");
  await expect(first.getByTestId("helper-notice")).toContainText("Teszt só");
  await expect(first.getByTestId("helper-button")).toHaveAttribute("aria-expanded", "false");
  expect(await passesClicks(page, "helper-notice")).toBe(true);
  // Lili 2026-10-29 (item 10): the figure is her picture for the situation, and it loads (a missing file is a broken image)
  const picture = first.getByTestId("helper-button").locator("img");
  await expect(picture).toHaveAttribute("src", /^\/segito\/(antennarius|zebracapa)-(feladatok|vegyszer)\.webp$/);
  expect(await picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.getByRole("link", { name: "Napi vízmérés", exact: true }).click();
  // the overview has a helper too: wait for the new page, or the clicks below land on the old one
  await expect(page).toHaveURL(/\/vizmeres/);
  await expect(page.getByRole("heading", { name: "Napi vízmérések" })).toBeVisible();
  const helper = page.getByTestId("helper");
  // wait until the component has read its stored state, or the click races the auto-open
  await expect(helper).toHaveAttribute("data-ready", "1");
  // the same alert again: it stays silent on the next page (review of #20, c), and it does not greet either
  await expect(helper.getByTestId("helper-notice")).toHaveCount(0);
  // from the figure: the bubble starts with the alert, then a quick question
  await helper.getByTestId("helper-button").click();
  await expect(helper.getByTestId("helper-button")).toHaveAttribute("aria-expanded", "true");
  await expect(helper.getByTestId("helper-answer")).toContainText("Teszt só");
  await helper.getByRole("button", { name: "Mi van még hátra ma?" }).click();
  await expect(helper.getByTestId("helper-answer")).not.toBeEmpty();
  await helper.getByTestId("helper-button").click();
  // card 8b22c3c2: the switch is in the header; off, the figure goes and the urgent notice stays in a strip
  const toggle = page.getByTestId("helper-toggle");
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByTestId("helper")).toHaveCount(0);
  await expect(page.getByTestId("helper-urgent")).toContainText("Teszt só");
  expect(await passesClicks(page, "helper-urgent")).toBe(true);
  expect(await topIs(page, "save-all")).toBe(true);
  // a new session while switched off: the alert must not be marked seen behind the closed helper (review of #20, a)
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.getByTestId("helper-toggle")).not.toBeChecked();
  await expect(page.getByTestId("helper-urgent")).toContainText("Teszt só");
  await page.getByTestId("helper-toggle").click();
  // switched back on, the alert not seen in this session speaks right here, not only on the next page (review of #21)
  await expect(page.getByTestId("helper-urgent")).toHaveCount(0);
  await expect(page.getByTestId("helper-notice")).toContainText("Teszt só");
  await expect(page.getByTestId("helper-button")).toHaveAttribute("aria-expanded", "false");
  expect(await passesClicks(page, "helper-notice")).toBe(true);
  expect(await topIs(page, "save-all")).toBe(true);
});

// Lili 2026-10-29 (package item 3): a ticked feed's base amount. Only the admin sets it, on the feed list's
// "Módosítás"; an aquarist sees it and has no form. (The tick recording it is the server's: tests/integration/feed-dose.)
// Homárikra: no other e2e test uses it, so the amount does not reach their sheets.
test("the feed list: the admin sets the tick's base amount, an aquarist sees it", async ({ page }) => {
  await login(page, "teszt.admin");
  await page.getByRole("link", { name: "Takarmánylista" }).click();
  // package item 15: banded rows, paler than the reports' band (--c-field) and not the plain white
  const apro = page.getByTestId("feeds-APRO").locator("tbody tr");
  const bgOf = (n: number) => apro.nth(n).locator("td").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect([await bgOf(0), await bgOf(1)]).toEqual(["rgba(0, 0, 0, 0)", "rgb(246, 249, 250)"]);
  const row = page.getByRole("row").filter({ hasText: "Homárikra" });
  // the other layout's run (or an earlier run) may have set 30 already: then it is a change to 35, or "Mentés" stays off
  const target = (await row.locator('[data-testid^="feed-dose-"]').textContent()) === "30 g" ? "35" : "30";
  await row.getByRole("button", { name: "Homárikra: módosítás" }).click();
  const form = page.locator('[data-testid^="feed-edit-"]');
  await form.getByLabel("Alapmennyiség a pipához").fill(target);
  await form.getByLabel("Az alapmennyiség egysége").selectOption({ label: "g" });
  await form.getByRole("button", { name: "Mentés" }).click();
  await expect(row.locator('[data-testid^="feed-dose-"]')).toHaveText(`${target} g`);
  await page.context().clearCookies();
  await login(page, "teszt.akvarista1");
  await page.getByRole("link", { name: "Takarmánylista" }).click();
  const seen = page.getByRole("row").filter({ hasText: "Homárikra" });
  await expect(seen.locator('[data-testid^="feed-dose-"]')).toHaveText(`${target} g`);
  await expect(seen.getByRole("button", { name: "Homárikra: módosítás" })).toHaveCount(0);
  // package item 14: the basic data's copies are an admin's operation; an aquarist has no such box
  await expect(page.getByTestId("feed-copies")).toHaveCount(0);
});

test("the feed list: the admin's dry run for the basic data's copies finds none on a clean start", async ({ page }) => {
  await login(page, "teszt.admin");
  await page.getByRole("link", { name: "Takarmánylista" }).click();
  const box = page.getByTestId("feed-copies");
  await box.getByRole("button", { name: "Másodpéldányok keresése (próba)" }).click();
  await expect(box.getByTestId("feed-copies-none")).toHaveText("Nincs másodpéldány.");
  await expect(box.getByRole("button", { name: /inaktiválása/ })).toHaveCount(0);
});

// Lili 2026-10-29 (package item 2): the day of the week small under the date wherever the day picker is, and the row on
// one line: the step buttons, the calendar field and its button share a vertical centre (the "Nap" label above the
// field pushed it below the buttons). MI PIROSÍT: a missing weekday, or a centre more than 2 px off on any of the pages.
test("the day picker: the weekday under the date, the buttons and the calendar on one line", async ({ page }) => {
  await login(page, "teszt.admin");
  const centre = async (l: import("@playwright/test").Locator) => {
    const b = (await l.boundingBox())!;
    return b.y + b.height / 2;
  };
  for (const path of ["/etetes", "/evesi-naplo", "/kivetel", "/takarmanyhuto"]) {
    await page.goto(path);
    const nav = page.getByTestId("day-nav");
    await expect(page.getByTestId("shown-weekday")).toHaveText(/^(hétfő|kedd|szerda|csütörtök|péntek|szombat|vasárnap)$/);
    const before = await page.getByTestId("shown-weekday").textContent();
    const prev = nav.getByRole("link", { name: "‹ előző nap" });
    const picker = page.getByTestId("day-picker");
    const y = [await centre(prev), await centre(picker.locator("input[name=nap]")), await centre(picker.getByRole("button", { name: "Ugrás" }))];
    expect(Math.max(...y) - Math.min(...y), `${path}: ${y.join(", ")}`).toBeLessThanOrEqual(2);
    await prev.click();
    await expect(page.getByTestId("shown-weekday")).not.toHaveText(before ?? "");
  }
});

test("water measurements by e-mail: the recipient in the settings, the button first on the export page", async ({ page }, info) => {
  // caparium-hibak-4. The e2e run has no SMTP: the button must say which variables are missing, by NAME, and send
  // nothing. The address is a test address of our own domain, never typed into the export page.
  const to = info.project.name === "tablet" ? "vizmeres-teszt-t@acropora.hu" : "vizmeres-teszt-d@acropora.hu";
  await login(page, "teszt.admin");
  await page.getByRole("link", { name: "Beállítások" }).click();
  const rec = page.getByTestId("water-report-recipient");
  // several recipients (card c2e15128): a bad address in the list is named and nothing is saved; the same address
  // twice is kept once; the list is stored as "a, b"
  const second = `masik-${to}`;
  await rec.getByLabel("A vízmérés címzettjei").fill(`${to}, nem-cim`);
  await rec.getByRole("button", { name: "Mentés" }).click();
  await expect(rec.getByRole("status")).toHaveText("Érvénytelen e-mail cím: nem-cim.");
  await rec.getByLabel("A vízmérés címzettjei").fill(`${to}; ${second}, ${to.toUpperCase()}`);
  await rec.getByRole("button", { name: "Mentés" }).click();
  await expect(rec.getByRole("status")).toHaveText("Mentve.");
  await page.getByRole("link", { name: "Export" }).click();
  await expect(page).toHaveURL(/\/export/);
  await expect(page.getByRole("heading", { name: "Excel", exact: true })).toBeVisible();
  const headings = await page.locator("main h2").allTextContents();
  expect(headings.indexOf("Vízmérés kiküldése"), "above the Excel").toBeLessThan(headings.indexOf("Excel"));
  const box = page.getByTestId("water-mail");
  await expect(box).toContainText(`Címzettek: ${to}, ${second}`);
  await box.getByRole("button", { name: "Vízmérés kiküldése" }).click();
  await expect(box.getByRole("status")).toHaveText(
    "A levélküldés nincs beállítva: hiányzik vagy hibás: CAPARIUM_SMTP_HOST, CAPARIUM_SMTP_PORT, CAPARIUM_SMTP_USER, CAPARIUM_SMTP_PASSWORD, CAPARIUM_MAIL_FROM.",
  );
});

test("feeds: an aquarist adds an Egyéb feed, and only that type is offered (caparium-hibak-4)", async ({ page }, info) => {
  const name = info.project.name === "tablet" ? "Teszt egyéb T" : "Teszt egyéb D";
  await login(page, "teszt.akvarista1");
  await page.goto("/takarmanyok");
  await expect(page.getByRole("heading", { name: "Új Egyéb takarmány" })).toBeVisible();
  const form = page.getByTestId("new-feed");
  await expect(form.getByLabel("Takarmánytípus").locator("option")).toHaveText(["Egyéb"]);
  await form.getByLabel("Takarmány neve").fill(name);
  await form.getByRole("button", { name: "Felvétel" }).click();
  await expect(form.getByRole("status")).toHaveText("Takarmány felvéve.");
  await expect(page.getByTestId("feeds-EGYEB")).toContainText(name);
});

test("animals: an admin edits an animal's data, with the reasons off no reason is asked; an aquarist sees no edit form (caparium-hibak-5)", async ({ page }, info) => {
  await login(page, "teszt.admin");
  await page.goto("/allatok");
  await page.getByTestId("animals-table").getByRole("link", { name: "Teszt Egy", exact: true }).click();
  const form = page.getByTestId("animal-edit");
  const sex = form.getByLabel("Nem (módosítás)");
  const next = (await sex.inputValue()) === "MALE" ? "UNKNOWN" : "MALE";
  await sex.selectOption(next);
  const note = `e2e megjegyzés ${info.project.name} ${Date.now()}`;
  await form.getByLabel("Érkezési megjegyzés (módosítás)").fill(note);
  const save = form.getByRole("button", { name: "Módosítás mentése" });
  // caparium-indoklas-ki: the reasons are off by default, so the past fact is saved without one
  await expect(form.getByLabel("Indoklás a módosításhoz")).toHaveCount(0);
  await expect(save).toBeEnabled();
  await save.click();
  await expect(form.getByRole("status")).toHaveText("Az állat adatai mentve.");
  await expect(page.getByTestId("animal-detail")).toContainText(note);
  await expect(page.getByTestId("animal-edit").getByLabel("Nem (módosítás)")).toHaveValue(next);

});

// Lili 2026-10-26 (card f67b1a06, item 7): the animal list is seen and managed by admins only for now. The menu
// entry is hidden for an aquarist and the page itself sends them to the no-access page.
test("animals: an aquarist has no menu entry and the page sends them to the no-access page", async ({ page }) => {
  await login(page, "teszt.akvarista1");
  await expect(page.getByRole("link", { name: "Állatok" })).toHaveCount(0);
  await page.goto("/allatok");
  await expect(page).toHaveURL(/\/nincs-jogosultsag/);
  // Takarmánylista stays for the aquarist, directly above Kimutatások
  const nav = page.getByRole("navigation", { name: "Fő navigáció" });
  const links = await nav.getByRole("link").allInnerTexts();
  expect(links.indexOf("Kimutatások") - links.indexOf("Takarmánylista")).toBe(1);
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
    // the arrival day is the admin's, today by default (acrobot 33395), and a question confirms it
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest" }).format(new Date());
    await expect(box.getByLabel("Érkezés napja")).toHaveValue(today);
    page.once("dialog", (d) => {
      expect(d.message()).toContain(`25 állatot veszel fel a leírás kezdő listájából, ${today.replaceAll("-", ".")}. napi érkezéssel`);
      void d.accept();
    });
    await button.click();
    await expect(box.getByRole("status")).toHaveText("Kezdő állatlista betöltve.");
  }
  await expect(status).toContainText("25 / 25 állat van bent; mind bent van.");
  await expect(button).toHaveCount(0);
  await expect(page.getByTestId("animals-table")).toContainText("Nokedli");
  await expect(page.getByTestId("animals-table")).toContainText("Ráják");
});

// Lili 2026-10-27 22:15 UTC (acrobot 37086): the "Ki eszik ma" pool lines in the pools' own order (Pool.sortOrder), not by
// name. After the starting list's load (the test above), so several pools have animals.
test("feeding: the pool lines of the day's chooser in the pools' own order", async ({ page }) => {
  await login(page, "teszt.akvarista1");
  await page.getByRole("link", { name: "Takarmánynapló", exact: true }).click();
  await expect(page.getByTestId("animal-chooser")).toBeVisible();
  const heads = (await page.locator('[data-testid^="group-head-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.slice("group-head-".length))));
  const order = ["Nagymedence", "Karantén", "Kismedence", "Ragadozós", "Korallos", "Inkubátor", "Kis sózó", "Sózó"];
  const known = heads.filter((h) => order.includes(h));
  expect(known.length, `pools with animals: ${heads.join(", ")}`).toBeGreaterThanOrEqual(3);
  expect(known).toEqual([...known].sort((x, y) => order.indexOf(x) - order.indexOf(y)));
});

// Lili 2026-10-27 20:44 UTC (acrobot 37043): the list, the open animal, a new animal, the starting list without its
// explanation, and the order block last.
test("animals page: the blocks in Lili's order, the starting list without its explanation", async ({ page }) => {
  await login(page, "teszt.admin");
  await page.goto("/allatok");
  const first = page.getByTestId("animals-table").getByRole("link").first();
  const name = await first.innerText();
  await first.click();
  await expect(page.getByTestId("animal-detail")).toBeVisible();
  // the list's heading carries the living count, "Állatok (25 élő)"
  const headings = (await page.locator(".card > h2").allInnerTexts()).map((h, i) => (i === 0 ? h.replace(/ \(\d+ élő\)$/, "") : h));
  expect(headings).toEqual(["Állatok", name, "Új állat, faj, csoport", "Kezdő állatlista", "Sorrend"]);
  await expect(page.getByTestId("initial-animals-status")).toBeVisible();
  await expect(page.getByText("Kétszer nem tölt be semmit")).toHaveCount(0);
});

test("the admin's animal order: a row moves with the buttons and the save becomes available (nothing is saved)", async ({ page }) => {
  await login(page, "teszt.admin");
  await page.goto("/allatok");
  const list = page.getByTestId("animal-order");
  const rows = list.getByRole("listitem");
  const count = await rows.count();
  test.skip(count < 2, "needs two living animals");
  const first = (await rows.nth(0).getByRole("button").first().getAttribute("aria-label")) ?? "";
  const firstName = first.replace(/ feljebb$/, "");
  const save = page.getByTestId("save-order");
  await expect(save).toBeDisabled();
  await page.getByRole("button", { name: `${firstName} lejjebb` }).click();
  await expect(rows.nth(1)).toContainText(firstName);
  await expect(save).toBeEnabled();
  await page.getByRole("button", { name: "Elvetés" }).click();
  await expect(rows.nth(0)).toContainText(firstName);
  await expect(save).toBeDisabled();
});


// Lili 2026-10-26 (Caparium channel msg 1564351191281049815, point 2; Balázs "Mehet" 1564352369205186581): the export
// page. The water-mail box has the pink background #F1D1D8 and a larger gap before the calendar under it; the monthly
// ZIMS package box has a smaller title and stands below the ZIMS CSV box. Read-only: nothing is sent or saved.
test("export page: the water-mail box is pink with a gap above the calendar, the monthly ZIMS package sits under the ZIMS CSV box with a smaller title", async ({ page }) => {
  await login(page, "teszt.admin");
  await page.goto("/export");
  const mail = page.getByTestId("water-mail-card");
  await expect(mail).toBeVisible();
  expect(await mail.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(241, 209, 216)");
  // another box keeps the plain card background, so the pink is the mail box's own
  const excel = page.locator("main .card", { has: page.getByRole("heading", { name: "Excel", exact: true }) });
  expect(await excel.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgb(241, 209, 216)");

  // the gap between the mail box and the calendar (the date filter) is larger than the 20 px between two cards
  const mailBox = (await mail.boundingBox())!;
  const filterBox = (await page.locator("form.filters").boundingBox())!;
  expect(filterBox.y - (mailBox.y + mailBox.height), "gap above the calendar").toBeGreaterThanOrEqual(28);

  // the order of the boxes: water mail, Excel, ZIMS CSV, then the monthly package
  const headings = await page.locator("main h2").allTextContents();
  const at = (start: string) => headings.findIndex((h) => h.startsWith(start));
  expect(at("Vízmérés kiküldése")).toBeGreaterThanOrEqual(0);
  expect(at("Excel")).toBeGreaterThan(at("Vízmérés kiküldése"));
  expect(at("ZIMS CSV")).toBeGreaterThan(at("Excel"));
  expect(at("Havi ZIMS-csomag"), "under the ZIMS CSV box").toBe(at("ZIMS CSV") + 1);

  // the title is smaller than the other boxes' titles
  const size = (heading: string) => page.locator("main h2", { hasText: heading }).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(await size("Havi ZIMS-csomag")).toBeLessThan(await size("ZIMS CSV"));
});

// Lili 2026-10-26 (Caparium channel msg 1564351191281049815, point 3; Balázs "Mehet" 1564352369205186581): the admin adds
// a pool in Beállítások (name, code, volume, icon optional). The pool is deactivated at the end: the other tests list
// the active pools, and a pool with its memberships has no place among them once the test is over.
test("settings: the admin adds a new pool; the existing pools stay as they were", async ({ page }) => {
  const suffix = `${Date.now()}`.slice(-8);
  const name = `E2E medence ${suffix}`;
  const code = `E2E_${suffix}`;
  const db = new PrismaClient();
  try {
    await login(page, "teszt.admin");
    await page.goto("/beallitasok");
    const before = await page.locator('input[aria-label$="új neve"]').count();
    const box = page.getByTestId("new-pool");
    const add = box.getByRole("button", { name: "Medence felvétele" });
    await expect(add, "name, code and volume are needed").toBeDisabled();
    await box.getByLabel("Új medence neve").fill(name);
    await box.getByLabel("Új medence kódja").fill(code.toLowerCase());
    await expect(add).toBeDisabled();
    await box.getByLabel("Új medence űrtartalma (liter)").fill("1250,5");
    await expect(add, "a measurement group is needed too").toBeDisabled();
    await box.getByLabel("Kismedencék").check();
    await expect(add).toBeEnabled();
    await add.click();
    await expect(box.getByRole("status")).toHaveText("Medence felvéve.");
    // the form empties itself and the pool is in the list, with its volume
    await expect(box.getByLabel("Új medence neve")).toHaveValue("");
    await expect(page.getByLabel(`${name} új neve`)).toBeVisible();
    await expect(page.getByLabel(`${name} űrtartalma (liter)`)).toHaveValue("1250,5");
    // its group is named in its row of the pool table
    await expect(page.getByTestId(`pool-${name}`)).toContainText("Kismedencék");
    expect(await page.locator('input[aria-label$="új neve"]').count()).toBe(before + 1);
    // the same code again is refused with the reason, and the form keeps what was typed
    await box.getByLabel("Új medence neve").fill(`Másik ${suffix}`);
    await box.getByLabel("Új medence kódja").fill(code);
    await box.getByLabel("Új medence űrtartalma (liter)").fill("100");
    await box.getByLabel("Nagy medencék").check();
    await add.click();
    await expect(box.getByRole("status")).toHaveText("Ez a medencekód már foglalt.");
    await expect(box.getByLabel("Új medence neve")).toHaveValue(`Másik ${suffix}`);
    // "Nincs vízmérés" (Lili, msg 1564364366844006430): no group needed, the group boxes are off, the pool is in no group
    await box.getByLabel("Nagy medencék").uncheck();
    await box.getByLabel("Új medence neve").fill(`Víz nélkül ${suffix}`);
    await box.getByLabel("Új medence kódja").fill(`${code}_V`);
    await expect(add, "a group is needed again").toBeDisabled();
    await box.getByLabel("Nincs vízmérés").check();
    await expect(box.getByLabel("Kismedencék")).toBeDisabled();
    await expect(add).toBeEnabled();
    await add.click();
    await expect(box.getByRole("status")).toHaveText("Medence felvéve.");
    await expect(page.getByTestId(`pool-Víz nélkül ${suffix}`)).toContainText("nincs vízmérés");
  } finally {
    // closed again: the pool inactive and its memberships ended, so the tests after this one see the old tables
    for (const c of [code, `${code}_V`]) {
      const pool = await db.pool.findUnique({ where: { code: c } });
      if (!pool) continue;
      await db.pool.update({ where: { id: pool.id }, data: { active: false } });
      await db.groupMembership.updateMany({ where: { poolId: pool.id, validTo: null }, data: { validTo: new Date() } });
    }
    await db.$disconnect();
  }
});

// Lili 2026-10-26 (Caparium channel msg 1564356412946124921, item 4; Balázs "Mehet" 1564357004217159823): the eating log has the
// jump calendar too. The chosen day opens, and jumping back to today opens today's. Read-only. Lili 2026-10-27 12:36 UTC (item 7):
// the feeding page gets the same calendar beside its arrows.
for (const [name, path] of [["eating log", "/evesi-naplo"], ["feeding page", "/etetes"]] as const) {
  test(`${name}: the jump calendar opens the chosen day, and back to today opens today's`, async ({ page }) => {
    await login(page, "teszt.akvarista1");
    await page.goto(path);
    const picker = page.getByTestId("day-picker");
    await expect(picker.getByRole("button", { name: "Ugrás" })).toBeVisible();
    const todayText = await page.getByTestId("shown-day").textContent();
    const earlier = budapestDay(-3);
    await picker.getByLabel("Nap").fill(earlier);
    await picker.getByRole("button", { name: "Ugrás" }).click();
    await expect(page).toHaveURL(new RegExp(`nap=${earlier}`));
    await expect(page.getByTestId("shown-day")).not.toHaveText(todayText ?? "");
    // back to today: the picker's own day
    await picker.getByLabel("Nap").fill(budapestDay(0));
    await picker.getByRole("button", { name: "Ugrás" }).click();
    await expect(page.getByTestId("shown-day")).toHaveText(todayText ?? "");
  });
}

// Lili 2026-10-26 (Caparium channel msg 1564356412946124921, item 1; Balázs "Mehet" 1564357004217159823): the named feeding
// lists. The admin composes one on the timetable page; in the feeding page's header a dropdown picks it, which ticks its
// animals and adds its feeds; "Lista a terv szerint" stays beside it. The list is archived at the end.
// caparium-lista-deaktivalas-nap (the 10-21 loss; acrobot 37938): the switch off never takes off an animal with a record
// that day, asks nothing, and names who stayed. A past day of its own per project: today's earlier tests write items.
test("feeding lists: the admin composes one, the header's switch and dropdown make the day's selection that list, the switch off keeps the recorded animal", async ({ page }, info) => {
  const name = `E2E lista ${info.project.name}`;
  const day = info.project.name === "tablet" ? "2026-01-22" : "2026-01-23";
  await login(page, "teszt.admin");
  await page.goto("/etetes/rend");
  const editor = page.getByTestId("feeding-lists");
  const form = editor.getByTestId("new-list");
  const save = form.getByRole("button", { name: "Lista felvétele" });
  await expect(save, "a name and a member are needed").toBeDisabled();
  await form.getByLabel("új lista: neve").fill(name);
  await expect(save).toBeDisabled();
  await form.getByLabel("új lista: Teszt Egy").check();
  await form.getByLabel("új lista: Mysis").check();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(form.getByRole("status")).toHaveText("Lista felvéve.");
  await expect(editor.locator("details", { hasText: name })).toHaveCount(1);

  await page.goto(`/etetes?nap=${day}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "Mai Terv" }), "the weekly plan's button stays").toBeVisible();
  const pick = page.getByTestId("apply-list");
  // a list operation asks no confirmation any more; a reason prompt (the reasons switched on) is answered
  const confirms: string[] = [];
  page.on("dialog", (d) => {
    if (d.type() === "confirm") confirms.push(d.message());
    void (d.type() === "prompt" ? d.accept("e2e lista") : d.accept());
  });
  // Lili 2026-10-26 (msg 1564404481708265704): the switch before the dropdown: on = a list can be chosen, off = everything off
  const power = pick.getByRole("switch", { name: "Etetési listák" });
  await power.check();
  await expect(pick.getByLabel("Névvel ellátott lista")).toBeEnabled();
  await pick.getByLabel("Névvel ellátott lista").selectOption({ label: name });
  await expect(pick.getByRole("status")).toContainText(`${name}:`);
  // (msg 1564405423417593988) the day's selection IS the list: only its animal is ticked and only its feed is chosen
  await expect(page.getByLabel("Teszt Egy a mai listán")).toBeChecked();
  await expect(page.getByLabel("Teszt Kettő a mai listán")).not.toBeChecked();
  await expect(page.getByTestId("day-feeds").getByLabel("A nap takarmánya: Mysis")).toBeChecked();
  await expect(page.getByTestId("day-feeds").getByLabel("A nap takarmánya: Litopenaeus vannamei")).not.toBeChecked();
  // by hand afterwards stays: tick another animal, and record an item for it
  await page.getByLabel("Teszt Kettő a mai listán").check();
  await expect(page.getByLabel("Teszt Kettő a mai listán")).toBeChecked();
  const item = page.getByTestId("item-form");
  await item.getByLabel("Kinek", { exact: true }).selectOption({ label: "Teszt Kettő" });
  await item.getByLabel("Takarmány", { exact: true }).selectOption({ label: "Mysis" });
  await item.getByLabel("Mennyiség (tömeg)", { exact: true }).fill("5");
  await item.getByRole("button", { name: "Tétel mentése" }).click();
  await expect(item.getByRole("status")).toHaveText("Tétel mentve.");

  // the switch off: the list's animal and the day's feed go; the animal with an item stays, named, and its item with it
  await power.uncheck();
  await expect(pick.getByRole("status")).toHaveText("A listán maradt, mert ezen a napon már van beírt etetése: Teszt Kettő.");
  await expect(page.getByLabel("Teszt Egy a mai listán")).not.toBeChecked();
  await expect(page.getByLabel("Teszt Kettő a mai listán")).toBeChecked();
  await expect(page.getByTestId("day-feeds").getByLabel("A nap takarmánya: Mysis")).not.toBeChecked();
  await expect(page.getByTestId("feeding-list").getByRole("row").filter({ hasText: "Teszt Kettő" })).toContainText("5 g");
  // a selection is left, so the switch stays on beside it
  await expect(power).toBeChecked();
  expect(confirms, "the list operation asked nothing").toEqual([]);
  // barracuda on #104: another feed chosen for the day afterwards: the kept item's feed stays a column of the sheet
  const dayFeeds = page.getByTestId("day-feeds");
  await dayFeeds.getByLabel("A nap takarmánya: Litopenaeus vannamei").check();
  const saveFeeds = dayFeeds.getByRole("button", { name: "A nap takarmányainak mentése" });
  // both buttons POST the day's feeds; the goto below must not cancel it, so the answer is waited for
  const [feedsSaved] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/feeding/day-feeds") && r.request().method() === "POST"),
    (await saveFeeds.count()) ? saveFeeds.click() : dayFeeds.getByRole("button", { name: "Takarmánylap kész" }).click(),
  ]);
  expect(feedsSaved.ok(), `day feeds save: HTTP ${feedsSaved.status()}`).toBe(true);
  await expect(dayFeeds.getByLabel("A nap takarmánya: Litopenaeus vannamei")).toBeChecked();
  const sheet = page.getByTestId("feeding-sheet");
  await expect(sheet.getByRole("columnheader", { name: /^Litopenaeus vannamei/ })).toBeVisible();
  await expect(sheet.getByRole("columnheader", { name: /^Mysis/ }), "the given feed stays a column").toBeVisible();
  await sheet.getByRole("row").filter({ has: page.getByRole("cell", { name: "Teszt Kettő", exact: true }) }).click();
  await expect(sheet.getByLabel("Teszt Kettő: Mysis (g)", { exact: true })).toHaveValue("5");

  // archived: the list leaves the dropdown
  await page.goto("/etetes/rend");
  const row = page.getByTestId("feeding-lists").locator("details", { hasText: name });
  await row.locator("summary").click();
  await row.getByRole("button", { name: "Archiválás" }).click();
  await expect(page.getByTestId("feeding-lists").locator("details", { hasText: name })).toHaveCount(0);
});

// Lili 2026-10-26 (Caparium channel msg 1564366437148270735 and 1564366690601664713; Balázs "Mehet" via acrobot): the animal order
// is dragged by a handle (a pointer drag, mouse and touch), typed into a place number, or moved with the small buttons; the row
// moved and the place it lands on are highlighted. Nothing is saved: "Elvetés" ends the test.
test("the admin's animal order: a drag handle, a place number and the highlighted rows (nothing is saved)", async ({ page }) => {
  await login(page, "teszt.admin");
  await page.goto("/allatok");
  // a mouse press is not auto-waited for like a click: the page must be hydrated before the handle can hear it
  await page.waitForLoadState("networkidle");
  const list = page.getByTestId("animal-order");
  const rows = list.getByRole("listitem");
  const count = await rows.count();
  test.skip(count < 3, "needs three living animals");
  const names = async () => rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")?.replace("order-row-", "") ?? ""));
  const start = await names();
  const save = page.getByTestId("save-order");
  await expect(save).toBeDisabled();

  // the list is far down the page, and a mouse move outside the viewport reaches nothing (a click scrolls by itself, a
  // mouse move does not): the middle of the first three rows goes to the middle of the screen, away from the edges where
  // the drag scrolls the page
  await rows.nth(1).evaluate((el) => el.scrollIntoView({ block: "center" }));
  // the handle: press on the first row, move over the third; the first is the dragged row, the third the target
  const handle = list.getByTestId(`order-handle-${start[0]}`);
  const h = (await handle.boundingBox())!;
  const third = (await rows.nth(2).boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2, third.y + third.height / 2, { steps: 8 });
  await expect(rows.nth(0)).toHaveClass(/dragging/);
  await expect(rows.nth(2)).toHaveClass(/drop-target/);
  await page.mouse.up();
  expect(await names()).toEqual([start[1], start[2], start[0], ...start.slice(3)]);
  await expect(save).toBeEnabled();

  // the place number: type 1 into the row now third, Enter; a typo moves nothing
  const place = page.getByLabel(`${start[0]} helye (sorszám)`, { exact: true });
  await place.fill("sok");
  await place.press("Enter");
  expect(await names()).toEqual([start[1], start[2], start[0], ...start.slice(3)]);
  await expect(place).toHaveValue("3");
  await place.fill("1");
  await place.press("Enter");
  expect(await names()).toEqual(start);

  // the faint bands: the second row has another background than the first, and the touched row stands out
  const bg = (n: number) => rows.nth(n).evaluate((el) => getComputedStyle(el).backgroundColor);
  if (count >= 4) expect(await bg(2), "rows alternate in a faint background").not.toBe(await bg(3));
  await page.getByRole("button", { name: `${start[2]} feljebb`, exact: true }).click();
  await expect(rows.nth(1)).toHaveClass(/touched/);
  expect(await bg(1)).not.toBe(await bg(3));

  await page.getByRole("button", { name: "Elvetés" }).click();
  expect(await names()).toEqual(start);
  await expect(save).toBeDisabled();
});


// Lili 2026-10-26 (Caparium channel msg 1564404799359946884): the timetable ("Etetési rend") is the admin's for now. An aquarist
// does not see the entry, the page sends them to the no-access page, and "Lista a terv szerint" still works for them.
test("the feeding timetable is the admin's: an aquarist has no entry, is sent away, and keeps the plan button", async ({ page }) => {
  await login(page, "teszt.akvarista1");
  await page.getByRole("link", { name: "Takarmánynapló", exact: true }).click();
  await expect(page.getByRole("button", { name: "Mai Terv" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Etetési rend" })).toHaveCount(0);
  await page.goto("/etetes/rend");
  await expect(page).toHaveURL(/nincs-jogosultsag/);
});

// Lili 2026-10-29 (task caparium-lili-nagyobb-m, item 8): the small ticks under the pool's name on the daily measurement.
// Each layout works its own group; the tick saves on its click, apart from the Mentés button, and is put back off at the end.
test("daily measurement: the pool ticks save on their own and survive a reload; the big pools have two, the small tanks one", async ({ page }, info) => {
  const p = plan(info.project.name);
  const kinds = info.project.name === "tablet" ? [["WATER_CHANGE", "Vízcsere"]] : [["BACKWASH", "Visszamosás"], ["TOPUP", "Rátöltés"]];
  const other = info.project.name === "tablet" ? "Visszamosás" : "Vízcsere";
  await login(page, "teszt.akvarista1");
  await page.getByRole("link", { name: "Napi vízmérés", exact: true }).first().click();
  await page.getByRole("tab", { name: p.tab }).click();
  await expect(page.getByRole("heading", { name: /Napi paraméterek/ })).toBeVisible();
  const row = page.getByTestId(`row-${p.pool}`);
  await expect(row.getByLabel(other)).toHaveCount(0);
  // The box ticks at once and the save goes after it (MeasurementGrid.tsx), so each change waits for its own saved answer
  // before the reload: a reload in flight cancelled the save, and the tablet run failed on it (#138, CI 41049678125).
  const saved = async (change: Promise<void>) => {
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/pool-ticks") && r.request().method() === "POST"),
      change,
    ]);
    expect(res.ok(), `pool tick save: HTTP ${res.status()}`).toBe(true);
  };
  for (const [kind] of kinds) {
    const box = page.getByTestId(`tick-${p.pool}-${kind}`);
    await expect(box).not.toBeChecked();
    await saved(box.check());
  }
  await page.reload();
  for (const [kind] of kinds) await expect(page.getByTestId(`tick-${p.pool}-${kind}`)).toBeChecked();
  for (const [kind] of kinds) await saved(page.getByTestId(`tick-${p.pool}-${kind}`).uncheck());
  await page.reload();
  for (const [kind] of kinds) await expect(page.getByTestId(`tick-${p.pool}-${kind}`)).not.toBeChecked();
});

// Lili 2026-10-29 (feedback on #119, acrobot 38178, 38179, 38180, 38182): the figure greets after the login with the login
// name, and the greeting goes with the FIRST click anywhere, which still reaches its target; once per login. The pictures
// turn towards the page, there is no name under the figure.
test("the helper greets after the login, goes with the first click that still works, and does not greet again in the same login", async ({ page }) => {
  await login(page, "teszt.akvarista1");
  const helper = page.getByTestId("helper");
  await expect(helper).toHaveAttribute("data-ready", "1");
  const hello = helper.getByTestId("helper-notice");
  await expect(hello).toHaveAttribute("data-kind", "greeting");
  await expect(hello).toHaveText("Üdv a fedélzeten Teszt.akvarista1!");
  const picture = helper.getByTestId("helper-button").locator("img");
  await expect(picture).toHaveAttribute("src", /^\/segito\/(antennarius|zebracapa)-udv-[123]\.webp$/);
  expect(await picture.evaluate((img: HTMLImageElement) => getComputedStyle(img).transform)).toBe("matrix(-1, 0, 0, 1, 0, 0)"); // towards the page
  await expect(helper.locator(".helper-name")).toHaveCount(0);
  // the first click is a click on a link: it goes through to the page, and the greeting goes
  await page.getByRole("link", { name: "Napi vízmérés", exact: true }).click();
  await expect(page).toHaveURL(/\/vizmeres/);
  await expect(page.getByRole("heading", { name: "Napi vízmérések" })).toBeVisible();
  await expect(page.locator('[data-testid="helper-notice"][data-kind="greeting"]')).toHaveCount(0);
  // the same login, the page loaded again: no second hello
  await page.reload();
  await expect(page.getByTestId("helper")).toHaveAttribute("data-ready", "1");
  await expect(page.locator('[data-testid="helper-notice"][data-kind="greeting"]')).toHaveCount(0);
  // a key takes the greeting too (no pointer needed)
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.locator('[data-testid="helper-notice"][data-kind="greeting"]')).toHaveCount(1);
  await page.keyboard.press("Tab");
  await expect(page.locator('[data-testid="helper-notice"][data-kind="greeting"]')).toHaveCount(0);
});

// Lili 2026-10-30 (msg 1565719910833721357, acrobot 38772): the corner figure is a little larger, can be dragged with a mouse (a finger is the
// same pointer events) inside the screen, keeps its place per user, goes back to the corner on a double click, and a drag does not open the bubble.
test("the helper figure: dragged inside the screen, its place kept after a reload, no bubble after a drag, back in the corner on a double click", async ({ page }) => {
  await login(page, "teszt.akvarista1");
  const helper = page.getByTestId("helper");
  await expect(helper).toHaveAttribute("data-ready", "1");
  const button = helper.getByTestId("helper-button");
  const view = page.viewportSize()!;
  const box = async () => (await button.boundingBox())!;
  const centre = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const inside = (b: { x: number; y: number; width: number; height: number }) => b.x >= 0 && b.y >= 0 && b.x + b.width <= view.width && b.y + b.height <= view.height;

  // a click anywhere takes the greeting away (it is not a click on the figure's bubble), then the figure is at rest in its corner
  await page.mouse.click(5, 5);
  await expect(helper).not.toHaveAttribute("data-placed", "1");
  const corner = await box();
  expect(corner.height, "a little larger than the 100 px of before").toBeGreaterThan(110);
  expect(corner.x + corner.width, "the corner: the right edge 16 px from the screen's").toBeGreaterThan(view.width - 24);

  // a drag to the upper left: the figure moves, the bubble does not open, the place is marked
  const from = centre(corner);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 300, from.y - 250, { steps: 8 });
  await page.mouse.up();
  await expect(helper).toHaveAttribute("data-placed", "1");
  const moved = await box();
  expect(moved.x).toBeLessThan(corner.x - 200);
  expect(moved.y).toBeLessThan(corner.y - 150);
  expect(inside(moved)).toBe(true);
  await expect(button).toHaveAttribute("aria-expanded", "false");

  // the place is kept after a reload (per user, in the browser)
  await page.reload();
  await expect(helper).toHaveAttribute("data-ready", "1");
  const kept = await box();
  expect(Math.abs(kept.x - moved.x)).toBeLessThan(3);
  expect(Math.abs(kept.y - moved.y)).toBeLessThan(3);

  // dragged far beyond the screen's edges, the figure stays inside it
  const c = centre(kept);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(-400, -400, { steps: 6 });
  await page.mouse.up();
  const topLeft = await box();
  expect(inside(topLeft)).toBe(true);
  expect(topLeft.x).toBeLessThan(40);
  expect(topLeft.y).toBeLessThan(40);
  await page.mouse.move(centre(topLeft).x, centre(topLeft).y);
  await page.mouse.down();
  await page.mouse.move(view.width + 400, view.height + 400, { steps: 6 });
  await page.mouse.up();
  expect(inside(await box())).toBe(true);

  // a plain click still opens the bubble, and the bubble stays inside the screen wherever the figure stands: at the bottom right (above it)
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  expect(inside((await page.locator(".helper-bubble").first().boundingBox())!)).toBe(true);
  // two clicks within 350 ms on one spot are a double click (back to the corner): this one comes later, as a person's second click would
  await page.waitForTimeout(450);
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "false");
  // and at the top left (below it, opening to the right)
  const here = centre(await box());
  await page.mouse.move(here.x, here.y);
  await page.mouse.down();
  await page.mouse.move(-400, -400, { steps: 6 });
  await page.mouse.up();
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  expect(inside((await page.locator(".helper-bubble").first().boundingBox())!)).toBe(true);

  // a double click puts it back in the corner (the clicks before it were more than 350 ms ago)
  await page.waitForTimeout(450);
  await button.dblclick();
  await expect(helper).not.toHaveAttribute("data-placed", "1");
  const back = await box();
  expect(Math.abs(back.x - corner.x)).toBeLessThan(3);
  expect(Math.abs(back.y - corner.y)).toBeLessThan(3);
  await page.reload();
  await expect(helper).not.toHaveAttribute("data-placed", "1");
});
