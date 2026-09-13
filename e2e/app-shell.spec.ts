import { expect, test } from "@playwright/test";

/**
 * Smoke coverage for the application shell: the window chrome (ribbon tabs, status bar)
 * that every later test drives.
 */
test("the app shell renders its chrome", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("MaBuCAD");

  for (const tab of ["Home", "Sketch", "Features", "Inspect"]) {
    await expect(page.getByRole("tab", { name: tab })).toBeVisible();
  }

  // A fresh Part document: the status bar reports no active sketch and zero features.
  // The kernel readout (geometry-status) only mounts once the kernel has something to
  // say — later tests watch it land there.
  await expect(page.getByTestId("sketch-status")).toContainText(/no active sketch/i);
  await expect(page.getByRole("contentinfo")).toContainText("0 features");

  // The Feature Manager tree shows the default reference geometry a new Part starts with.
  await expect(page.getByRole("treeitem", { name: "Front Plane" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Origin" })).toBeVisible();
});
