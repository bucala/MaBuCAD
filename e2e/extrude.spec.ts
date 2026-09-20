import { expect, test } from "@playwright/test";

import { createRectangleSketch, extrudeCurrentSketch } from "./partWorkflows";

/**
 * The full parametric loop: sketch a closed profile, exit to the feature tree, extrude
 * it — which boots the 11 MB OpenCASCADE WASM kernel and rebuilds the whole feature
 * history into a solid — and watch the geometry status land on "Model up to date".
 */
test("a sketched rectangle extrudes into a solid", async ({ page }) => {
  await page.goto("/");

  await createRectangleSketch(page);
  await extrudeCurrentSketch(page);

  // And the feature it built is in the tree. Running the command switched the manager
  // dock to the new feature's property panel, so step back to the Feature Manager tab
  // to see the tree.
  await page.getByRole("tab", { name: "Feature Manager" }).click();
  await expect(page.getByRole("treeitem", { name: /Boss-Extrude1/ })).toBeVisible();
});
