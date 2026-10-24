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

/**
 * End-to-end pin for WP02 (`rebuild.ts`'s own `replicadPlaneFor` note): a sketch on a
 * plane other than Front used to build its solid as if it *were* on Front, only looking
 * right in the viewport because of a whole-mesh cosmetic rotation applied for display —
 * the real kernel shape (what the rebuild's errors, not just its looks, depend on) was
 * wrong. Selecting the Top Plane before sketching routes `beginSketch` onto it instead of
 * the default Front plane; a clean "Model up to date" here, through the real command/store
 * pipeline rather than calling `rebuild.ts` directly, is the full-stack counterpart to
 * `rebuildPlanes.spec.ts`'s kernel-level bounding-box pins.
 */
test("a rectangle sketched on the Top plane extrudes without a kernel error", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("treeitem", { name: "Top Plane", exact: true }).click();
  await createRectangleSketch(page);
  await extrudeCurrentSketch(page);

  await page.getByRole("tab", { name: "Feature Manager" }).click();
  await expect(page.getByRole("treeitem", { name: /Boss-Extrude1/ })).toBeVisible();
});
