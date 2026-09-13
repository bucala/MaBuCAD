import { defineConfig } from "@playwright/test";

/**
 * End-to-end regression suite.
 *
 * Drives the real Vite dev server in plain-browser mode — inside Tauri `io/files.ts` uses
 * native dialogs, but every command surface the tests touch (ribbon, sketch tools, solver,
 * feature tree, viewport canvas) is identical there, and the browser fallbacks keep the
 * import/export paths exercisable too. One worker: each test pays the WASM kernel load
 * when it extrudes, and the app is a single-document page — parallelism would multiply
 * memory for little wall-clock gain on a suite this size.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: "http://localhost:1420",
    viewport: { width: 1600, height: 950 },
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
