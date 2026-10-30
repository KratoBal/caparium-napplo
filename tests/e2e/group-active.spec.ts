// Switching an animal group off and on (Lili 2026-10-30, task caparium-csoport-inaktiv; acrobot 38969, 38970): the Csoportok card of the Állatok page.
// A new group has no member, so it goes off ("Inaktiválva."), is hidden behind "Inaktívak mutatása" after a reload and comes back ("Újra aktív.");
// "Teszt csoport" has members, so it stays on and the answer names them. The rule itself is measured in tests/integration/group-active.test.ts.
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

test("a group is switched off and on from the Csoportok card; a group with members stays on and names them", async ({ page }, info) => {
  await login(page, "teszt.admin");
  await page.goto("/allatok");
  const name = `E2E csoport ${info.project.name} ${Date.now()}`;
  const create = page.getByTestId("new-group");
  await create.getByLabel("Új csoport neve").fill(name);
  await create.getByRole("button", { name: "Felvétel" }).click();
  await expect(create.getByRole("status")).toHaveText("Mentve.");
  const table = page.getByTestId("groups-table");
  const row = table.getByRole("row").filter({ hasText: name });
  await expect(row).toContainText("0");
  // off: the row stays in view with its message, the button turns
  await row.getByRole("button", { name: "Inaktiválás" }).click();
  await expect(row.getByRole("status")).toHaveText("Inaktiválva.");
  await expect(row.getByRole("button", { name: "Aktiválás" })).toBeVisible();
  // after a reload an inactive group is hidden behind the switch, and not offered for a group change
  await page.reload();
  await expect(table.getByRole("row").filter({ hasText: name })).toHaveCount(0);
  await page.getByTestId("groups-card").getByRole("switch", { name: /Inaktívak mutatása/ }).check();
  const shown = table.getByRole("row").filter({ hasText: name });
  await expect(shown).toHaveClass(/invalid/);
  // on again
  await shown.getByRole("button", { name: "Aktiválás" }).click();
  await expect(shown.getByRole("status")).toHaveText("Újra aktív.");
  await expect(shown.getByRole("button", { name: "Inaktiválás" })).toBeVisible();

  // a group with members: refused, and the answer names them
  const withMembers = table.getByRole("row").filter({ hasText: "Teszt csoport" }).first();
  await withMembers.getByRole("button", { name: "Inaktiválás" }).click();
  await expect(withMembers.getByRole("status")).toContainText("még vannak tagjai");
  await expect(withMembers.getByRole("status")).toContainText("Teszt Egy");
  await expect(withMembers.getByRole("button", { name: "Inaktiválás" })).toBeVisible();
});
