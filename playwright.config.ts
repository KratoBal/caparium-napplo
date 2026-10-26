import { defineConfig, devices } from "@playwright/test";

// Two layouts from the brief: tablet (iPad-sized, touch, WebKit = the Safari engine) and desktop.
// The server is the production build (`next start`) against a migrated and seeded database.
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // The browser runs in the zoo's zone, as the tablets do. The forms default to the browser's own date and time, the server's
    // business day is Europe/Budapest, and a CI runner is in UTC: from local midnight to one o'clock (two in summer) the form
    // offered yesterday and the server answered "Korábbi napot csak adminisztrátor módosíthat" (dosing, helper, animals; measured
    // on #73 and #74, 2026-10-27 00:2x local), and the tests that compute today in Budapest disagreed with the page.
    timezoneId: "Europe/Budapest",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "tablet",
      // CI: WebKit. E2E_TABLET_ENGINE=chromium only where WebKit cannot start (the agent sandbox).
      use: {
        ...(process.env.E2E_TABLET_ENGINE === "chromium" ? devices["Desktop Chrome"] : devices["Desktop Safari"]),
        viewport: { width: 1024, height: 768 },
        hasTouch: true,
      },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
