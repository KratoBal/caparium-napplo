// Lili 2026-11-01 (point 15): every Beállítások module starts closed. A test that works inside the page opens them
// first; the page itself keeps nothing open between visits. One step for all of them (the page-walking tests run
// against a time limit): the `toggle` event the page listens to fires as it does on a click.
import { expect, type Page } from "@playwright/test";

export async function openAllSettings(page: Page): Promise<void> {
  const folds = page.locator("details.settings-fold");
  await expect(folds.first()).toBeVisible();
  await folds.evaluateAll((all) => all.forEach((d) => ((d as HTMLDetailsElement).open = true)));
  await expect(page.locator("details.settings-fold:not([open])")).toHaveCount(0);
}

/**
 * Lili 2026-11-02 (acrobot 39956): the references and the tester conversion are under each measurement's Szerkesztés on the
 * Vízmérések card. Opens the card and the measurement named `name` (with its unit, "Ca (ppm)"), returns its editor.
 */
export async function openMeasurement(page: Page, nameWithUnit: string) {
  await openAllSettings(page);
  const button = page.getByTestId("water-measurements").getByRole("button", { name: `${nameWithUnit}: szerkesztés` });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  const [name, unit] = nameWithUnit.replace(")", "").split(" (");
  const editor = page.getByTestId(`wm-edit-${name}-${unit}`);
  await expect(editor).toBeVisible();
  return editor;
}
