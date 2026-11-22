import { expect, test } from "@playwright/test";

import { ribbonButton } from "./locators";
import { createRectangleSketch, extrudeCurrentSketch } from "./partWorkflows";

/**
 * Sketching off the origin planes: on a user reference plane (offset from a default plane),
 * and flush on a picked flat face of the body — the two ways real parts get features that
 * don't start at the origin. Kernel placement is pinned by `rebuildReferencePlanes.spec.ts`
 * and `facePlane.spec.ts`; these drive the real command/store/viewport path.
 */
test("a rectangle sketched on an offset reference plane extrudes", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("treeitem", { name: "Top Plane", exact: true }).click();
  await page.getByRole("tab", { name: "Features" }).click();
  await ribbonButton(page, "Plane").click();

  await page.getByRole("tab", { name: "Feature Manager" }).click();
  await page.getByRole("treeitem", { name: /^Plane1/ }).click();

  await createRectangleSketch(page);
  await extrudeCurrentSketch(page);

  await page.getByRole("tab", { name: "Feature Manager" }).click();
  await expect(page.getByRole("treeitem", { name: /Boss-Extrude1/ })).toBeVisible();
});

test("a sketch started on a picked face gets a flush plane and extrudes", async ({ page }) => {
  await page.goto("/");

  await createRectangleSketch(page);
  await extrudeCurrentSketch(page);

  // Face selection priority, then click the middle of the profile — the camera still
  // looks straight down the Front plane from the sketch, so this hits the extrude's cap.
  await page.getByRole("button", { name: /^Selection filter: / }).click();
  await expect(page.getByRole("button", { name: "Selection filter: Face" })).toBeVisible();
  await page.locator("canvas").first().click({ position: { x: 600, y: 425 } });
  await expect(page.getByText(/^Face \d+ selected$/)).toBeVisible();

  await page.getByRole("tab", { name: "Sketch" }).click();
  await ribbonButton(page, "Sketch").click();
  await expect(page.getByTestId("sketch-entity-count")).toHaveText("0");

  await ribbonButton(page, "Rectangle").click();
  const canvas = page.locator("canvas").first();
  await canvas.click({ position: { x: 560, y: 400 } });
  await canvas.click({ position: { x: 640, y: 450 } });
  await expect(page.getByTestId("sketch-entity-count")).toHaveText("4");
  await ribbonButton(page, "Exit Sketch").click();

  await page.getByRole("tab", { name: "Features" }).click();
  await ribbonButton(page, "Extruded Boss").click();
  await expect(page.getByTestId("geometry-status")).toHaveText(/Model up to date/i, { timeout: 60_000 });

  await page.getByRole("tab", { name: "Feature Manager" }).click();
  await expect(page.getByRole("treeitem", { name: /^Plane1/ })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /Boss-Extrude2/ })).toBeVisible();
});
