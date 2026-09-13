import { expect, test } from "@playwright/test";

import { ribbonButton } from "./locators";

/**
 * The full parametric loop: sketch a closed profile, exit to the feature tree, extrude
 * it — which boots the 11 MB OpenCASCADE WASM kernel and rebuilds the whole feature
 * history into a solid — and watch the geometry status land on "Model up to date".
 */
test("a sketched rectangle extrudes into a solid", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("tab", { name: "Sketch" }).click();
  await ribbonButton(page, "Sketch").click();
  await expect(page.getByTestId("sketch-entity-count")).toHaveText("0");

  await ribbonButton(page, "Rectangle").click();
  const canvas = page.locator("canvas").first();
  await canvas.click({ position: { x: 500, y: 350 } });
  await canvas.click({ position: { x: 700, y: 500 } });
  await expect(page.getByTestId("sketch-entity-count")).toHaveText("4");

  // Leaving the sketch commits it as a feature in the tree.
  await ribbonButton(page, "Exit Sketch").click();
  await expect(page.getByTestId("sketch-status")).toContainText(/no active sketch/i);

  // Extruded Boss resolves its profile from the sketch just finished.
  await page.getByRole("tab", { name: "Features" }).click();
  await ribbonButton(page, "Extruded Boss").click();

  // The kernel boots lazily on the first feature; the readout goes through
  // "loading"/"building" and settles on "Model up to date" once the solid is real.
  await expect(page.getByTestId("geometry-status")).toHaveText(/Model up to date/i, {
    timeout: 60_000,
  });

  // And the feature it built is in the tree. Running the command switched the manager
  // dock to the new feature's property panel, so step back to the Feature Manager tab
  // to see the tree.
  await page.getByRole("tab", { name: "Feature Manager" }).click();
  await expect(page.getByRole("treeitem", { name: /Boss-Extrude1/ })).toBeVisible();
});
