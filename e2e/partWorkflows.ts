import { expect, type Download, type Page } from "@playwright/test";

import { ribbonButton } from "./locators";

/** Draws and commits the same rectangle profile used by persistence, extrusion and
 * Drawing tests. Keeping the gesture in one helper prevents the three core workflows from
 * silently drifting to different canvas coordinates or sketch-exit semantics. */
export async function createRectangleSketch(page: Page) {
  await page.getByRole("tab", { name: "Sketch" }).click();
  await ribbonButton(page, "Sketch").click();
  await expect(page.getByTestId("sketch-entity-count")).toHaveText("0");

  await ribbonButton(page, "Rectangle").click();
  const canvas = page.locator("canvas").first();
  await canvas.click({ position: { x: 500, y: 350 } });
  await canvas.click({ position: { x: 700, y: 500 } });
  await expect(page.getByTestId("sketch-entity-count")).toHaveText("4");

  await ribbonButton(page, "Exit Sketch").click();
  await expect(page.getByTestId("sketch-status")).toContainText(/no active sketch/i);
}

/** Extrudes the committed sketch and waits for the real OCCT rebuild to settle. */
export async function extrudeCurrentSketch(page: Page) {
  await page.getByRole("tab", { name: "Features" }).click();
  await ribbonButton(page, "Extruded Boss").click();
  await expect(page.getByTestId("geometry-status")).toHaveText(/Model up to date/i, {
    timeout: 60_000,
  });
}

/** Saves the active document through the browser fallback and returns the real download
 * object so callers can inspect both its filename and its temporary filesystem path. */
export async function saveDocumentAs(page: Page): Promise<Download> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: "Save As…" }).click();
  return downloadPromise;
}
