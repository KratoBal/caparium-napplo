// Lili 2026-10-30 19:30 UTC (msg 1565794906130092052, task caparium-evesi-telefon; 18:31 UTC, card 2a1484e0): on a phone the eating states page is one
// CARD per animal, always open: the name with its recorded state, the picker across the whole width, the V and Gy ticks under it, no group and no pool,
// no sideways scroll. Tablet and desktop keep the table with its columns. Nothing is saved: the test only picks a state, so the day stays as the setup
// made it. A past day of its own per project (an admin may edit one), so no other test shares it.
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_TEST_PASSWORD ?? "";

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

// Teszt Egy on the day's list (idempotent for a retry), then the eating page of that day
async function openEatingPage(page: Page, day: string) {
  page.on("dialog", (d) => void d.accept());
  await login(page, "teszt.admin");
  await page.goto(`/etetes?nap=${day}`);
  const onList = page.getByLabel("Teszt Egy a mai listán");
  await expect(onList).toBeVisible();
  if (!(await onList.isChecked())) {
    await onList.check();
    await expect(onList).toBeChecked();
    // the tick saves on its own: let the request finish before the page is left
    await page.waitForLoadState("networkidle");
  }
  await page.goto(`/evesi-naplo?nap=${day}`);
  await expect(page.getByTestId("eating-table")).toBeAttached();
}

const DAY = (project: string) => budapestDay(project === "tablet" ? -54 : -56);

test.describe("phone, 390 px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("one open card per animal: the name, the picker across the width, V and Gy; no group, no pool, no sideways scroll", async ({ page }, info) => {
    await openEatingPage(page, DAY(info.project.name));
    const table = page.getByTestId("eating-table");
    const picker = table.getByLabel("Teszt Egy evési állapota");
    await expect(picker).toBeVisible();
    const look = await page.evaluate(() => {
      const t = document.querySelector('[data-testid="eating-table"]') as HTMLElement;
      const box = t.closest(".table-scroll") as HTMLElement;
      const tr = [...t.querySelectorAll("tbody tr")].find((r) => r.querySelector("td")?.textContent === "Teszt Egy") as HTMLElement;
      const name = tr.querySelector("td.eat-name")!.getBoundingClientRect();
      const sel = tr.querySelector("select")!.getBoundingClientRect();
      const card = tr.getBoundingClientRect();
      const checks = [...tr.querySelectorAll(".check")].map((c) => Math.round(c.getBoundingClientRect().height));
      return {
        rowDisplay: getComputedStyle(tr).display,
        head: getComputedStyle(t.querySelector("thead")!).display,
        group: getComputedStyle(tr.querySelector("td.eat-group")!).display,
        pool: getComputedStyle(tr.querySelector("td.eat-pool")!).display,
        boxOver: box.scrollWidth - box.clientWidth,
        docOver: document.documentElement.scrollWidth - window.innerWidth,
        pickerWidthShare: sel.width / card.width,
        pickerHeight: Math.round(sel.height),
        // the name and the picker stand in the same card, the name above the picker
        sameCard: sel.top >= card.top && sel.bottom <= card.bottom && name.bottom <= sel.top,
        smallChecks: checks.filter((h) => h < 44),
        checkCount: checks.length,
      };
    });
    expect(look.rowDisplay).toBe("flex");
    expect(look.head).toBe("none");
    expect(look.group, "no group on a phone").toBe("none");
    expect(look.pool, "no pool on a phone").toBe("none");
    expect(look.boxOver).toBeLessThanOrEqual(0);
    expect(look.docOver).toBeLessThanOrEqual(0);
    expect(look.pickerWidthShare, "the picker takes the card's width").toBeGreaterThan(0.85);
    expect(look.pickerHeight).toBeGreaterThanOrEqual(44);
    expect(look.sameCard).toBe(true);
    expect(look.checkCount).toBe(2);
    expect(look.smallChecks, "V and Gy at least 44 px high").toEqual([]);
    // it still works: a state picked, the row counts for the save
    await picker.selectOption("EATEN");
    await table.getByLabel("Teszt Egy vitamin").check();
    await expect(page.getByTestId("eating-save-all")).toHaveText("Mentés (1 sor)");
  });
});

test.describe("tablet, 1024 px", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("the table keeps its columns, the group and the pool too", async ({ page }, info) => {
    await openEatingPage(page, DAY(info.project.name));
    const look = await page.evaluate(() => {
      const t = document.querySelector('[data-testid="eating-table"]') as HTMLElement;
      const tr = [...t.querySelectorAll("tbody tr")].find((r) => r.querySelector("td")?.textContent === "Teszt Egy") as HTMLElement;
      return {
        rowDisplay: getComputedStyle(tr).display,
        head: getComputedStyle(t.querySelector("thead")!).display,
        group: getComputedStyle(tr.querySelector("td.eat-group")!).display,
        pool: getComputedStyle(tr.querySelector("td.eat-pool")!).display,
      };
    });
    expect(look).toEqual({ rowDisplay: "table-row", head: "table-header-group", group: "table-cell", pool: "table-cell" });
  });
});
