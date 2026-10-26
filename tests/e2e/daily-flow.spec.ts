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

function budapestDay(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest" }).format(d);
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
  const finalize = page.getByRole("button", { name: "Lista kész" });
  if (await finalize.count()) await finalize.click();
  await expect(page.getByTestId("list-state")).toHaveText("Lista kész");

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

  // EGY-10, EVE-07: both Excel files are real downloads from the export page
  await page.getByRole("link", { name: "Export" }).click();
  for (const [id, prefix] of [["excel-etetes", "Egyedi_takarmanynaplo_"], ["excel-evesi", "Evesi_minta_"]] as const) {
    const [file] = await Promise.all([page.waitForEvent("download"), page.getByTestId(id).click()]);
    expect(file.suggestedFilename()).toMatch(new RegExp(`^${prefix}\\d{4}-\\d{2}-\\d{2}`));
  }
});

// 6fe63c9b (Lili's request; Balázs 2026-10-21 "mehet"): the list in two steps and the feeding sheet. Each layout
// fills its own animal's row; the day's feeds are shared, so the second run finds them saved already.
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
  const saveFeeds = dayFeeds.getByRole("button", { name: "A nap takarmányainak mentése" });
  if (await saveFeeds.isEnabled()) {
    await saveFeeds.click();
    await expect(dayFeeds.getByRole("status")).toHaveText("A nap takarmányai mentve.");
  }
  await expect(page.getByTestId("item-form").getByLabel("Takarmány", { exact: true }).locator("option", { hasText: "Mytilus sp." })).toHaveCount(0);
  // step 3. Lili 2026-10-21 11:44 UTC (a): a feed weighed AND counted takes both units
  const sheet = page.getByTestId("feeding-sheet");
  await expect(sheet.getByRole("columnheader", { name: "Litopenaeus vannamei (g + db)" })).toBeVisible();
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
  // EGY-08: the feeding page shows the reference in the animal's row. Since Lili's simpler chooser (2026-10-21) the
  // items table lists only the day's animals, so the animal goes on today's list first
  await page.getByRole("link", { name: "Takarmánynapló", exact: true }).click();
  await page.getByLabel(`${name} a mai listán`).check();
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

test("reports: the tables and the Excel; no daily report menu any more", async ({ page }) => {
  await login(page, "teszt.akvarista1");
  await page.getByRole("link", { name: "Kimutatások" }).click();
  await expect(page.getByTestId("report-by-day")).toContainText("Összesen");
  await expect(page.getByTestId("report-by-recipient")).toBeVisible();
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByTestId("excel-kimutatas").click()]);
  expect(file.suggestedFilename()).toMatch(/^Kimutatas_\d{4}-\d{2}-\d{2}/);
  // caparium-hibak-4: the daily report menu is gone (its Excel is the export page's, for one day)
  await expect(page.getByRole("link", { name: "Napi jelentő" })).toHaveCount(0);
  // VIZ-20: the monthly package's card on the export page; the overview's feeding tile
  await page.getByRole("link", { name: "Export" }).click();
  await expect(page.getByTestId("monthly-package")).toContainText("Havi ZIMS-csomag");
  await page.getByRole("link", { name: "Áttekintés" }).click();
  await expect(page.getByTestId("home-evesi")).toBeVisible();
});

test("home: the customer's illustrated cards, 3-2-3, each to its module, only with access; one column on a phone", async ({ page }) => {
  // caparium-hibak-5 (Balázs 2026-10-20 11:37 UTC)
  await login(page, "teszt.akvarista1");
  const rows = page.locator(".home-row");
  await expect(rows).toHaveCount(3);
  const captions = async (i: number) => (await rows.nth(i).locator(".home-caption").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  expect(await captions(0)).toEqual(["Nagy medencék NAPI VÍZMÉRÉS", "Kis medencék NAPI VÍZMÉRÉS", "HETI VÍZMÉRÉS"]);
  expect(await captions(1)).toEqual(["Nyomelem és megkötő adagolás", "Takarmány kalkulátor"]);
  expect(await captions(2)).toEqual(["Takarmány kivételi napló", "Egyedi takarmánynapló", "Evési napló"]);
  // every picture is the web-sized one and loads
  for (const img of await page.locator(".home-card img").all()) {
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((e) => (e as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(await img.getAttribute("src")).toMatch(/^\/kezdolap\/[a-z]+\.webp$/);
  }
  // the middle row is centred: its two cards sit between the first row's outer cards
  const box = async (row: number, i: number) => (await rows.nth(row).locator(".home-card").nth(i).boundingBox())!;
  const [a, b, c] = [await box(0, 0), await box(1, 0), await box(1, 1)];
  expect(b.x).toBeGreaterThan(a.x + a.width / 4);
  expect(Math.abs(a.x + (await box(0, 2)).x + (await box(0, 2)).width - (b.x + c.x + c.width))).toBeLessThan(4);
  await page.getByTestId("home-kismedencek").click();
  await expect(page).toHaveURL(/\/vizmeres\?csoport=NAPI_KIS/);
  await expect(page.getByRole("tab", { name: "Kis Akváriumok" })).toHaveAttribute("aria-selected", "true");

  // phone width: one column
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const xs = await page.locator(".home-card").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
  expect(new Set(xs).size).toBe(1);

  // no access to a module: its cards are gone (the dosing module set to NONE for a fresh aquarist)
  const db = new PrismaClient();
  try {
    const u = await db.user.findUniqueOrThrow({ where: { loginId: "teszt.akvarista2" } });
    await db.modulePermission.upsert({ where: { userId_module: { userId: u.id, module: "DOSING" } }, update: { level: "NONE" }, create: { userId: u.id, module: "DOSING", level: "NONE" } });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.context().clearCookies(); // a new login, not the first user's session
    await login(page, "teszt.akvarista2");
    await expect(page.getByTestId("home-kalkulator")).toBeVisible();
    await expect(page.getByTestId("home-adagolas")).toHaveCount(0);
  } finally {
    const u = await db.user.findUniqueOrThrow({ where: { loginId: "teszt.akvarista2" } });
    await db.modulePermission.deleteMany({ where: { userId: u.id, module: "DOSING" } });
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
  await login(page, "teszt.akvarista1");
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
  await page.getByRole("link", { name: "Állatok" }).click();
  await page.getByTestId("animals-table").getByRole("link", { name: "Teszt Három" }).click();
  const plan = page.getByTestId("plan-form");
  for (const d of ["H", "K", "Sze", "Cs", "P", "Szo", "V"]) await plan.getByLabel(`Etetési nap: ${d}`).check();
  await plan.getByRole("button", { name: "Terv mentése" }).click();
  await expect(plan.getByRole("status")).toHaveText("Terv mentve.");
  await page.getByRole("link", { name: "Takarmánynapló", exact: true }).click();
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
  await page.getByRole("link", { name: "Napi vízmérés", exact: true }).click();
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
      expect(d.message()).toContain(`25 állatot veszel fel a leírás kezdő listájából, ${today} napi érkezéssel`);
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
// jump calendar too. The chosen day opens, and jumping back to today opens today's. Read-only.
test("eating log: the jump calendar opens the chosen day, and back to today opens today's", async ({ page }) => {
  await login(page, "teszt.akvarista1");
  await page.goto("/evesi-naplo");
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

// Lili 2026-10-26 (Caparium channel msg 1564356412946124921, item 1; Balázs "Mehet" 1564357004217159823): the named feeding
// lists. The admin composes one on the timetable page; in the feeding page's header a dropdown picks it, which ticks its
// animals and adds its feeds; "Lista a terv szerint" stays beside it. The list is archived at the end.
test("feeding lists: the admin composes one, the header's dropdown ticks its animals and adds its feeds", async ({ page }, info) => {
  const name = `E2E lista ${info.project.name}`;
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

  await page.goto("/etetes");
  await expect(page.getByRole("button", { name: "Lista a terv szerint" }), "the weekly plan's button stays").toBeVisible();
  const pick = page.getByTestId("apply-list");
  await pick.getByLabel("Névvel ellátott lista").selectOption({ label: name });
  await expect(pick.getByRole("status")).toContainText(`${name}:`);
  await expect(page.getByLabel("Teszt Egy a mai listán")).toBeChecked();
  await expect(page.getByTestId("day-feeds").getByLabel("A nap takarmánya: Mysis")).toBeChecked();

  // archived: the list leaves the dropdown
  await page.goto("/etetes/rend");
  const row = page.getByTestId("feeding-lists").locator("details", { hasText: name });
  await row.locator("summary").click();
  page.once("dialog", (d) => void d.accept());
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

// Lili 2026-10-26 (Caparium channel msg 1564411331891830885, image masodlagos-gombok-lili.png): the secondary controls (a soft
// button, a dropdown, a field, a tab) had almost the page's own background, so it was not clear what could be clicked. One set of
// tokens in globals.css: a pale but visible border, a shade darker background, a darker one on hover. Read from the computed style.
test("secondary controls are visible: a border, a background unlike the page's, and a hover state", async ({ page }, info) => {
  await login(page, "teszt.admin");
  await page.goto("/etetes");
  await page.waitForLoadState("networkidle");
  const pageBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const look = (loc: ReturnType<Page["locator"]>) =>
    loc.first().evaluate((el) => {
      const c = getComputedStyle(el);
      return { width: c.borderTopWidth, style: c.borderTopStyle, color: c.borderTopColor, bg: c.backgroundColor };
    });
  const plan = page.getByRole("button", { name: "Lista a terv szerint" });
  const list = page.getByLabel("Névvel ellátott lista");
  // the day control's soft button is "Nap lezárása" or "Nap újranyitása", whichever the day's state offers
  const dayButton = page.locator(".day-controls button.btn-soft");
  const controls = [plan, ...((await dayButton.count()) > 0 ? [dayButton] : []), ...((await list.count()) > 0 ? [list] : [])];
  for (const control of controls) {
    const l = await look(control);
    expect([l.width, l.style], "a 1px border").toEqual(["1px", "solid"]);
    expect(l.color, "a visible border, not transparent").not.toMatch(/rgba\(\d+, \d+, \d+, 0\)|transparent/);
    expect(l.bg, "not the page's own background").not.toBe(pageBg);
  }
  // hover: a darker background (a mouse only; the tablet layout has no hover)
  if (info.project.name === "desktop") {
    const before = (await look(plan)).bg;
    await plan.hover();
    expect((await look(plan)).bg, "hover changes the background").not.toBe(before);
  }
  // a tab and a field on another page
  await page.goto("/vizmeres");
  await page.waitForLoadState("networkidle");
  const tab = await look(page.locator(".tab:not(.active)"));
  expect([tab.width, tab.style]).toEqual(["1px", "solid"]);
  await page.goto("/export");
  const field = await look(page.locator("input.input[type=date]"));
  expect([field.width, field.style]).toEqual(["1px", "solid"]);
  expect(field.color).not.toMatch(/rgba\(\d+, \d+, \d+, 0\)|transparent/);
});
