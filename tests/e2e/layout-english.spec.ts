// t-20261118-caparium-elrendezes (Lili 2026-11-18 13:13 UTC, her pictures 3, 4 and 5, English view): the longer English texts pushed a
// form's button off the line of its fields, a header-only table stood above a form like the form's column heads, and the chips of a page's
// head row did not share a line with the day badge. What is measured here is the LINE, in the English view, on the pages that have a form
// row or a head row: nothing is compared with a stored picture, the check is the geometry itself (the Chromium of the CI).
// - a row (.toolbar) with a labelled field and a button: the button's bottom is the bottom of the fields on its line (1 px); a button wrapped onto a line of
//   its own stands under the fields at the row's left edge;
// - a tick (checkbox) inside a field is centred on the inputs beside it;
// - a head chip (.head-chip: the withdrawal total, "List not ready") is centred on the day badge, and the day button on the date field;
// - a list table that has no row does not stand above its form (the withdrawal and the intake list).
import { expect, test } from "@playwright/test";
import { measureLayout, type LayoutReport } from "../support/layout-measure";

const PASSWORD = process.env.SEED_TEST_PASSWORD ?? "";
// every page with a view for the admin (login, password reset and "no access" have no toolbar): the English texts of the round 3 translation
// (#267-#272) are longer than the Hungarian ones on the pages that were added below the first six
const PAGES = [
  "/kivetel", "/takarmanyhuto", "/adagolas", "/evesi-naplo", "/etetes", "/takarmany-naplo",
  "/etetes/rend", "/vizmeres", "/vizmeres/hutok", "/heti", "/naplo", "/allatok", "/takarmanyok", "/beallitasok", "/aktivitas", "/fuggo",
  "/kimutatasok", "/export", "/kalkulator", "/profil",
];
const TOLERANCE = 1;

// what each page must have given the check to measure: a green run that measured nothing on a page proves nothing there. The forms show on an
// open day for the admin (the CI's seed), the head chips and the day button are always there for the admin.
const MUST_MEASURE: Record<string, Partial<Record<keyof LayoutReport["measured"], number>>> = {
  "/kivetel": { formButtons: 1, headChips: 1, dayButtons: 1 },
  "/takarmanyhuto": { formButtons: 1, ticks: 1 },
  "/adagolas": { formButtons: 1 },
  "/evesi-naplo": { headChips: 1, dayButtons: 1 },
};

test.beforeAll(() => {
  if (!PASSWORD) throw new Error("SEED_TEST_PASSWORD must be set for the e2e run");
});

test("English view: a form row's button stands on its fields' line, a head chip on the day badge's, no header-only list above a form", async ({ page }) => {
  await page.goto("/belepes");
  await page.getByLabel("Felhasználónév").fill("teszt.admin");
  await page.getByLabel("Jelszó").fill(PASSWORD);
  await page.getByRole("button", { name: "Bejelentkezés" }).click();
  await expect(page.getByRole("heading", { name: /^(Jó munkát!|Keep up the good work!)$/ })).toBeVisible();
  await page.getByTestId("lang-en").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const own = page.viewportSize() ?? { width: 1024, height: 768 };
  const all: string[] = [];
  const missing: string[] = [];
  // TWO WIDTHS. Wide (1900 px): the rows do not wrap, every button stands level with its fields, and the minimums below must have been measured (a green
  // run that measured nothing proves nothing). The project's OWN width (the tablet's 1024, the desktop's 1440), where a row wraps and Lili's iPad sees it:
  // a button level with the fields on its line, or alone on a line of its own, under the fields at the row's left edge (wrappedButtons), never slid.
  for (const [mode, size] of [["wide", { width: 1900, height: 1000 }], ["own", own]] as const) {
    await page.setViewportSize(size);
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const report = await page.evaluate(measureLayout, [`${path} (${mode} ${size.width}px)`, TOLERANCE] as const);
      all.push(...report.found);
      if (mode !== "wide") continue;
      for (const [what, atLeast] of Object.entries(MUST_MEASURE[path] ?? {}))
        if (report.measured[what as keyof LayoutReport["measured"]] < (atLeast ?? 0))
          missing.push(`${path}: measured ${report.measured[what as keyof LayoutReport["measured"]]} ${what}, expected at least ${atLeast} (is the form or the day control not shown?)`);
    }
  }
  // every page is measured before the verdict, so one run lists every offender and every gap
  expect(missing, missing.join("\n")).toEqual([]);
  expect(all, all.join("\n")).toEqual([]);
});
