import { defineConfig } from "@playwright/test";

/**
 * Production-only CSP regression suite. Kept separate from `playwright.config.ts` so an
 * ordinary E2E run does not rebuild and boot a second server for tests that never use it.
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: "drawing-model-view.spec.ts",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:1421",
    viewport: { width: 1600, height: 950 },
  },
  webServer: {
    // Vite's development HTML injects an inline React-refresh preamble, which the
    // packaged app's strict `script-src` correctly blocks. Production HTML has the same
    // all-external script shape Tauri actually loads.
    command: "npm run build && npm run preview -- --host 127.0.0.1 --port 1421",
    url: "http://127.0.0.1:1421",
    // A manually-started preview may serve stale `dist`, turning this into a test of an
    // earlier build.
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [{ name: "chromium-csp", use: { browserName: "chromium" } }],
});
