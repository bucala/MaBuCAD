import { defineConfig } from "@playwright/test";

const CSP_PREVIEW_URL = "http://127.0.0.1:24210";
const CSP_PREVIEW_PORT = new URL(CSP_PREVIEW_URL).port;

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
    baseURL: CSP_PREVIEW_URL,
    viewport: { width: 1600, height: 950 },
    actionTimeout: 15_000,
  },
  webServer: {
    // Vite's development HTML injects an inline React-refresh preamble, which the
    // packaged app's strict `script-src` correctly blocks. Production HTML has the same
    // all-external script shape Tauri actually loads.
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${CSP_PREVIEW_PORT}`,
    url: CSP_PREVIEW_URL,
    // A manually-started preview may serve stale `dist`, turning this into a test of an
    // earlier build.
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [{ name: "chromium-csp", use: { browserName: "chromium" } }],
});
