// Lili 2026-11-01 (point 11): every user reaches their own settings from the header, changes their display name there and
// sees the monogram and the ZIMS name, which only the admin changes. The name is set back at the end (the other tests read it).
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

test("an aquarist changes their own display name; the monogram and the ZIMS name are shown, not editable", async ({ page }) => {
  await login(page, "teszt.akvarista2");
  const original = (await page.getByTestId("current-user").innerText()).split(" · ")[0].trim();
  await page.getByRole("link", { name: "Saját beállítások" }).click();
  await expect(page.getByRole("heading", { name: "Saját beállítások", level: 1 })).toBeVisible();
  const admin = page.getByTestId("own-admin-fields");
  await expect(admin).toContainText("Monogram:");
  await expect(admin.locator("input")).toHaveCount(0);
  const box = page.getByTestId("own-name");
  const field = box.getByLabel("Megjelenő név");
  await expect(field).toHaveValue(original);
  try {
    await field.fill(`${original} Próba`);
    await box.getByRole("button", { name: "Név mentése" }).click();
    await expect(box.getByRole("status")).toHaveText("Név mentve.");
    await expect(page.getByTestId("current-user")).toContainText(`${original} Próba`);
  } finally {
    await page.goto("/profil");
    const back = page.getByTestId("own-name");
    if ((await back.getByLabel("Megjelenő név").inputValue()) !== original) {
      await back.getByLabel("Megjelenő név").fill(original);
      await back.getByRole("button", { name: "Név mentése" }).click();
      await expect(back.getByRole("status")).toHaveText("Név mentve.");
    }
  }
  // the password form asks for the current one and both new ones before it lets the button go
  const pw = page.getByTestId("own-password");
  const go = pw.getByRole("button", { name: "Jelszó módosítása" });
  await expect(go).toBeDisabled();
  await pw.getByLabel("Új jelszó", { exact: true }).fill("uj-jelszo-12345");
  await pw.getByLabel("Új jelszó még egyszer").fill("uj-jelszo-12346");
  await expect(pw.getByText("A két új jelszó nem egyezik.")).toBeVisible();
  await expect(go).toBeDisabled();
});
