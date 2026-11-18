// t-20261118-caparium-elrendezes (Lili 2026-11-18 13:13 UTC, her pictures 3, 4 and 5, English view): the longer English texts pushed a
// form's button off the line of its fields, a header-only table stood above a form like the form's column heads, and the chips of a page's
// head row did not share a line with the day badge. What is measured here is the LINE, in the English view, on the pages that have a form
// row or a head row: nothing is compared with a stored picture, the check is the geometry itself (the Chromium of the CI).
// - a row (.toolbar) with a labelled field and a button: the button's bottom is the bottom of the row's inputs (1 px);
// - a tick (checkbox) inside a field is centred on the inputs beside it;
// - a head chip (.head-chip: the withdrawal total, "List not ready") is centred on the day badge, and the day button on the date field;
// - a list table that has no row does not stand above its form (the withdrawal and the intake list).
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_TEST_PASSWORD ?? "";
const PAGES = ["/kivetel", "/takarmanyhuto", "/adagolas", "/evesi-naplo", "/etetes", "/takarmany-naplo"];
const TOLERANCE = 1;

type Offender = string;

async function offenders(page: Page, path: string): Promise<Offender[]> {
  return page.evaluate(
    ([where, tolerance]) => {
      const found: string[] = [];
      const rect = (e: Element) => e.getBoundingClientRect();
      const visible = (e: Element) => e.getClientRects().length > 0;
      for (const row of Array.from(document.querySelectorAll<HTMLElement>(".toolbar"))) {
        if (!visible(row)) continue;
        const fields = Array.from(row.querySelectorAll(":scope > .field")).filter(visible);
        const buttons = Array.from(row.querySelectorAll(":scope > button.btn")).filter(visible);
        if (fields.length === 0 || buttons.length === 0) continue;
        const inputs = fields.flatMap((f) => Array.from(f.querySelectorAll("input.input, select.input"))).filter(visible);
        if (inputs.length === 0) continue;
        const bottom = Math.max(...inputs.map((i) => rect(i).bottom));
        for (const b of buttons) {
          if (Math.abs(rect(b).bottom - bottom) > tolerance)
            found.push(`${where} button "${(b.textContent ?? "").trim().slice(0, 24)}" bottom ${Math.round(rect(b).bottom)} vs fields ${Math.round(bottom)}`);
        }
        for (const box of Array.from(row.querySelectorAll(":scope > .field > input[type=checkbox]")).filter(visible)) {
          const mid = (rect(box).top + rect(box).bottom) / 2;
          const inputMid = inputs.map((i) => (rect(i).top + rect(i).bottom) / 2);
          if (inputMid.length > 0 && Math.abs(mid - inputMid[0]) > tolerance)
            found.push(`${where} tick centre ${Math.round(mid)} vs inputs ${Math.round(inputMid[0])}`);
        }
      }
      const dayBadge = document.querySelector(".toolbar > .day-controls .badge");
      for (const chip of Array.from(document.querySelectorAll(".toolbar-end > .head-chip")).filter(visible)) {
        if (!dayBadge) continue;
        const a = (rect(chip.firstElementChild ?? chip).top + rect(chip.firstElementChild ?? chip).bottom) / 2;
        const b = (rect(dayBadge).top + rect(dayBadge).bottom) / 2;
        if (Math.abs(a - b) > tolerance) found.push(`${where} head chip centre ${Math.round(a)} vs day badge ${Math.round(b)}`);
      }
      // the head row: the day controls stand on the row's line, the Close/Reopen button centred on the date field beside it
      for (const head of Array.from(document.querySelectorAll<HTMLElement>(".toolbar-end")).filter(visible)) {
        const button = head.querySelector(":scope > .day-controls button");
        const date = head.querySelector("input.input");
        if (!button || !date) continue;
        const a = (rect(button).top + rect(button).bottom) / 2;
        const b = (rect(date).top + rect(date).bottom) / 2;
        if (Math.abs(a - b) > tolerance) found.push(`${where} day button centre ${Math.round(a)} vs date field ${Math.round(b)}`);
      }
      for (const id of ["withdrawal-list", "intake-list"]) {
        const table = document.querySelector(`[data-testid=${id}]`);
        if (table && table.querySelectorAll("tbody tr").length === 0) found.push(`${where} ${id} is a header without rows`);
      }
      return found;
    },
    [path, TOLERANCE] as const,
  );
}

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
  await page.setViewportSize({ width: 1400, height: 900 });

  const all: string[] = [];
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    all.push(...(await offenders(page, path)));
  }
  // every page is measured before the verdict, so one run lists every offender
  expect(all, all.join("\n")).toEqual([]);
});
