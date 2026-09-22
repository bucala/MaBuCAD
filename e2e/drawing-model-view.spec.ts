import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import {
  createRectangleSketch,
  extrudeCurrentSketch,
  saveDocumentAs,
} from "./partWorkflows";

/**
 * Drawing ▸ Insert Model View end to end — under the exact CSP the packaged Tauri app
 * ships, not the dev server's default of none.
 *
 * Why the CSP matters here and nowhere else in the suite: the OCCT wasm glue generates
 * embind invoker functions at runtime through `new Function`, so a policy without
 * `'unsafe-eval'` lets the kernel *compile* fine and then die the moment a projection (or
 * a Circular Pattern) first exercises a generated invoker — exactly the crash that shipped
 * in the released app and got saved into the supplied Part2.mabucad's Circular Pattern
 * feature. A plain dev-server test would never catch a regression here because the dev
 * server serves no CSP at all, so this file reads the shipped policy straight from
 * `src-tauri/tauri.conf.json` and injects it into the page as a `<meta>` CSP — the same
 * delivery mechanism Tauri itself uses — meaning the test can never drift from what the
 * packaged app actually enforces.
 */
const tauriConfig = JSON.parse(
  readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
) as { app: { security: { csp: string } } };
const SHIPPED_CSP = tauriConfig.app.security.csp;

/** Injects `csp` into the production-preview index document as a `<meta>` CSP — the way
 * Tauri delivers the policy — so the browser enforces it for everything the page then
 * loads. Must be armed before the navigation it should apply to. */
async function enforceCsp(page: Page, baseURL: string | undefined, csp: string) {
  if (!baseURL) throw new Error("Playwright CSP baseURL is not configured");
  const indexUrl = new URL("/", baseURL).toString();
  await page.route(indexUrl, async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(
      "<head>",
      `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`,
    );
    await route.fulfill({ response, body: html });
  });
}

/** Draws a rectangle, extrudes it (booting the wasm kernel) and saves the Part; returns
 * the saved file's path — the same shape `documents.spec.ts`'s round trip ends with. */
async function buildAndSavePart(page: Page): Promise<string> {
  await createRectangleSketch(page);
  await extrudeCurrentSketch(page);
  const path = await (await saveDocumentAs(page)).path();
  if (!path) throw new Error("Playwright did not persist the downloaded Part file");
  return path;
}

/** Creates a fresh Drawing and runs Insert Model View against the saved Part — the browser's
 * file-input fallback is what Playwright's `filechooser` event lands on (`io/files.ts`). */
async function insertModelViews(page: Page, partPath: string) {
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: "New" }).click();
  await page
    .getByRole("dialog", { name: "New Document" })
    .getByRole("button", { name: /^Drawing/ })
    .click();

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Insert Model View" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(partPath);
}

test("Insert Model View projects the default views under the shipped Tauri CSP", async ({ page, baseURL }) => {
  test.setTimeout(120_000);

  // The whole flow — extrude and projection both — runs under the exact shipped policy,
  // since the packaged app enforces it for the whole session, not just one command.
  await enforceCsp(page, baseURL, SHIPPED_CSP);
  await page.goto("/");

  const partPath = await buildAndSavePart(page);
  await insertModelViews(page, partPath);

  // Success lands as the "Inserted views of…" toast in the status bar readout.
  await expect(page.getByTestId("geometry-status")).toContainText(/Inserted views of/i, {
    timeout: 60_000,
  });
  // And the sheet really took the views: the toolbar's Update Views button only renders
  // once a `sourcePart` exists, so this doubles as the structural proof the views (and not
  // just a toast) landed.
  await expect(page.getByRole("button", { name: "Update Views" })).toBeVisible();

  // Updating against the *same, unchanged* part file must recognise that re-projecting
  // could only reproduce the cache it already has, and skip the part rebuild entirely
  // (`DrawingSheetData.sourceContentHash`). Proven from the outside by the command's own
  // report: the "unchanged" wording is only reachable through the skip branch, never
  // through a real re-projection, which reports "Views updated" instead.
  const updateChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Update Views" }).click();
  await (await updateChooserPromise).setFiles(partPath);
  await expect(page.getByTestId("geometry-status")).toContainText(/unchanged — views are already up to date/i, {
    timeout: 60_000,
  });
});

test("the same flow under the previous CSP (no 'unsafe-eval') fails the way the shipped app did", async ({ page, baseURL }) => {
  test.setTimeout(120_000);

  // Build the Part without any injected policy first — the extrude path is precisely what
  // already worked under the old policy (the supplied Part2.mabucad carries built
  // extrudes), so the part file is safe to build here. Then reload into a page enforcing
  // the shipped policy minus 'unsafe-eval' for the drawing step alone.
  await page.goto("/");
  const partPath = await buildAndSavePart(page);

  await enforceCsp(page, baseURL, SHIPPED_CSP.replace(" 'unsafe-eval'", ""));
  await page.goto("/");
  await insertModelViews(page, partPath);

  // The projection dies inside the kernel's embind glue and surfaces as the command's own
  // failure toast — the exact symptom the CSP fix exists to keep from coming back. This
  // control also proves the harness above genuinely enforces the policy: without a
  // failure here, the positive test would be proving nothing.
  await expect(page.getByTestId("geometry-status")).toContainText(/Insert Model View failed/i, {
    timeout: 60_000,
  });
});
