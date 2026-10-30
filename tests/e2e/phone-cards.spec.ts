// Lili 2026-10-30 17:26 UTC (msg 1565763773397209230, card 10bd670f, task caparium-vizmeres-telefon): on a phone the daily and the weekly water
// measurement are one CARD per pool, not a table that runs off to the right. Under the phone breakpoint (720 px) every pool is a card with its
// ticks and its fields under their own labels, nothing scrolls sideways, and every field and tick is at least 44 px; on a tablet the table stays.
// Nothing here writes: the test only reads the pages, so the two projects (tablet and desktop engines) can run it side by side.
import { expect, test, type Page } from "@playwright/test";

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

const PAGES = [
  { name: "daily", path: "/vizmeres?csoport=NAPI_NAGY", pool: "Nagymedence", label: "Sűrűség · ppt" },
  { name: "weekly", path: "/heti", pool: "Nagymedence", label: "KH · dKH" },
] as const;

for (const width of [390, 360]) {
  for (const p of PAGES) {
    test.describe(`phone ${width} px, ${p.name} water measurement`, () => {
      test.use({ viewport: { width, height: 844 } });

      test("one card per pool: no sideways scroll, the label over each field, fields and ticks at least 44 px", async ({ page }) => {
        await login(page, "teszt.akvarista1");
        await page.goto(p.path);
        const row = page.getByTestId(`row-${p.pool}`);
        await expect(row).toBeVisible();
        const look = await page.evaluate(
          ({ pool, label }) => {
            const tr = document.querySelector(`[data-testid="row-${pool}"]`) as HTMLElement;
            const td = tr.querySelector("td[data-label]") as HTMLElement;
            const boxes = [...document.querySelectorAll(".table-scroll")] as HTMLElement[];
            const small = (sel: string) =>
              [...document.querySelectorAll(sel)].map((e) => Math.round(e.getBoundingClientRect().height)).filter((h) => h < 44);
            const field = tr.querySelector(".cell-input, .cell-value") as HTMLElement;
            const cell = field.closest("td") as HTMLElement;
            return {
              rowDisplay: getComputedStyle(tr).display,
              headDisplay: getComputedStyle(document.querySelector(".grid-table thead")!).display,
              label: getComputedStyle(td, "::before").content,
              firstLabel: td.getAttribute("data-label"),
              docOverflow: document.documentElement.scrollWidth - window.innerWidth,
              boxOverflow: Math.max(...boxes.map((b) => b.scrollWidth - b.clientWidth)),
              smallFields: small(".cell-input, .cell-value"),
              smallTicks: small(".pool-tick"),
              // a field is wider than its label's own text and sits inside the card, not past its right edge
              fieldInside: field.getBoundingClientRect().right <= tr.getBoundingClientRect().right,
              fieldBelowLabel: field.getBoundingClientRect().top >= cell.getBoundingClientRect().top + 10,
              wanted: label,
            };
          },
          { pool: p.pool, label: p.label },
        );
        expect(look.rowDisplay).toBe("grid");
        expect(look.headDisplay).toBe("none");
        expect(look.firstLabel).toBe(look.wanted);
        expect(look.label).toContain(look.wanted);
        expect(look.docOverflow).toBeLessThanOrEqual(0);
        expect(look.boxOverflow).toBeLessThanOrEqual(0);
        expect(look.smallFields, "every field is at least 44 px high").toEqual([]);
        expect(look.smallTicks, "every tick row is at least 44 px high").toEqual([]);
        expect(look.fieldInside).toBe(true);
        expect(look.fieldBelowLabel).toBe(true);
        // the numeric keyboard stays
        const modes = await page.locator(".cell-input").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).inputMode));
        expect(modes.length).toBeGreaterThan(0);
        expect(modes.every((m) => m === "decimal")).toBe(true);
      });
    });
  }
}

test.describe("tablet 1024 px keeps the table", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("the header row and the table layout are as before", async ({ page }) => {
    await login(page, "teszt.akvarista1");
    await page.goto("/vizmeres?csoport=NAPI_NAGY");
    const row = page.getByTestId("row-Nagymedence");
    await expect(row).toBeVisible();
    const look = await page.evaluate(() => {
      const tr = document.querySelector('[data-testid="row-Nagymedence"]') as HTMLElement;
      return {
        rowDisplay: getComputedStyle(tr).display,
        headDisplay: getComputedStyle(document.querySelector(".grid-table thead")!).display,
        label: getComputedStyle(tr.querySelector("td[data-label]")!, "::before").content,
      };
    });
    expect(look.rowDisplay).toBe("table-row");
    expect(look.headDisplay).toBe("table-header-group");
    expect(look.label, "no label above a field in the table").toMatch(/^(none|normal)$/);
  });
});
