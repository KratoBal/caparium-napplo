// One height for every field and button (2026-10-20 owner request: the dropdowns were lower than the date
// field and the buttons beside them). Every page an admin can open, both layouts.
//
// Two checks, because the engines here do not show the original fault. Safari on the Mac and the iPad draws a
// native <select> at its own platform height, whatever the stylesheet says. Chromium and the Linux WebKit of
// the CI honour the height either way: on the old stylesheet both measured 48px (CI run on 6f1a701). So:
// - every select must have dropped the native look (appearance: none), the one property the Safari fault
//   hangs on, which any engine reports;
// - every control must be the shared height, which catches a field sized apart in the stylesheet.
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_TEST_PASSWORD ?? "";

const PAGES = [
  "/",
  "/vizmeres",
  "/heti",
  "/naplo",
  "/export",
  "/allatok",
  "/takarmanyok",
  "/etetes",
  "/evesi-naplo",
  "/takarmany-naplo",
  "/kalkulator",
  "/kivetel",
  "/adagolas",
  "/kimutatasok",
  "/fuggo",
  "/beallitasok",
];

// Deliberately other sizes, each for a reason of its own; everything else is the shared field height.
// .cell-input: the measurement cell is the page's main input, larger on purpose (56px).
// .meta-select: the small RO/SW and dilution pickers under a measurement cell (40px).
// .helper*: the floating helper in the corner is not part of a form row.
const OWN_SIZE = ".cell-input, .meta-select, .helper, .helper *, .helper-on";

type Control = { what: string; height: number; ownSize: boolean; native: boolean };

async function controls(page: Page, root: string): Promise<Control[]> {
  return page.locator(root).evaluate((el, ownSize) => {
    const selector = [
      "input:not([type=hidden]):not([type=checkbox]):not([type=radio])",
      "select",
      "textarea",
      "button",
      ".btn",
      ".tab",
    ].join(", ");
    return Array.from(el.querySelectorAll<HTMLElement>(selector))
      .filter((c) => c.getClientRects().length > 0)
      .map((c) => {
        const label = (c.getAttribute("name") ?? c.textContent ?? "").trim().slice(0, 30);
        return {
          what: `${c.tagName.toLowerCase()}.${c.className || "-"}[${label}]`,
          height: Math.round(c.getBoundingClientRect().height),
          ownSize: c.matches(ownSize),
          native: c.tagName === "SELECT" && getComputedStyle(c).appearance !== "none",
        };
      });
  }, OWN_SIZE);
}

function offHeight(page: string, found: Control[], height: number): string[] {
  return found.filter((c) => !c.ownSize && c.height !== height).map((c) => `${page} ${c.what} ${c.height}px`);
}

function nativeSelects(page: string, found: Control[]): string[] {
  return found.filter((c) => c.native).map((c) => `${page} ${c.what}`);
}

test.beforeAll(() => {
  if (!PASSWORD) throw new Error("SEED_TEST_PASSWORD must be set for the e2e run");
});

test("every field and button has the same height on every page", async ({ page }) => {
  await page.goto("/belepes");
  // the shared height is read from the stylesheet, not written here a second time
  const height = await page.evaluate(() =>
    Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--touch"))),
  );
  expect(height).toBeGreaterThan(0);
  const login = await controls(page, ".login-card");
  // every page is measured before the verdict, so one run lists every offender, not the first
  const off = offHeight("/belepes", login, height);
  const native = nativeSelects("/belepes", login);
  let seen = login.length;
  let selects = 0;

  await page.getByLabel("Felhasználónév").fill("teszt.admin");
  await page.getByLabel("Jelszó").fill(PASSWORD);
  await page.getByRole("button", { name: "Bejelentkezés" }).click();
  await expect(page.getByRole("heading", { name: "Jó munkát!" })).toBeVisible();

  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const found = await controls(page, "main.main");
    off.push(...offHeight(path, found, height));
    native.push(...nativeSelects(path, found));
    seen += found.length;
    selects += found.filter((c) => c.what.startsWith("select.")).length;
  }
  expect(native, "selects still drawn natively (Safari keeps its own height on these)").toEqual([]);
  expect(off, `controls not ${height}px high`).toEqual([]);
  // an empty selector would pass every page; the pages above hold well over a hundred controls
  expect(seen).toBeGreaterThan(100);
  expect(selects).toBeGreaterThan(20);
});
