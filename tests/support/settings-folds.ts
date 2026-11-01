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
