import { expect, test } from "@playwright/test";

import { ribbonButton } from "./locators";
import { createRectangleSketch, extrudeCurrentSketch } from "./partWorkflows";

test("tree selection stays in Feature Manager and double-click explicitly edits a sketch", async ({ page }) => {
  await page.goto("/");
  await createRectangleSketch(page);
  const features = page.getByRole("tab", { name: "Feature Manager" });
  await expect(features).toHaveAttribute("aria-selected", "true");

  await page.getByRole("treeitem", { name: "Top Plane", exact: true }).click();
  await expect(features).toHaveAttribute("aria-selected", "true");
  const sketch = page.getByRole("treeitem", { name: /Sketch1/ });
  await sketch.click();
  await expect(features).toHaveAttribute("aria-selected", "true");
  await expect(sketch).toBeVisible();
  await sketch.dblclick();
  await expect(page.getByRole("tab", { name: "Property Manager" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("sketch-entity-count")).toHaveText("4");
  await ribbonButton(page, "Exit Sketch").click();
  await expect(features).toHaveAttribute("aria-selected", "true");
});

test("commands open properties and return to the user's previous manager tab", async ({ page }) => {
  await page.goto("/");
  const configurations = page.getByRole("tab", { name: "Configurations" });
  const properties = page.getByRole("tab", { name: "Property Manager" });
  await configurations.click();
  await page.getByTestId("ribbon").getByRole("tab", { name: "Sketch" }).click();
  await ribbonButton(page, "Sketch").click();
  await expect(properties).toHaveAttribute("aria-selected", "true");
  await ribbonButton(page, "Exit Sketch").click();
  await expect(configurations).toHaveAttribute("aria-selected", "true");

  await page.getByTestId("ribbon").getByRole("tab", { name: "Inspect" }).click();
  await ribbonButton(page, "Measure").click();
  await expect(properties).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Close Inspect" }).click();
  await expect(configurations).toHaveAttribute("aria-selected", "true");
});

test("selecting another solid ends a feature command without reopening properties", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await createRectangleSketch(page);
  await extrudeCurrentSketch(page);
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.getByRole("treeitem", { name: /Sketch1/ }).click();
  await extrudeCurrentSketch(page);
  await page.getByRole("spinbutton", { name: "Depth (mm)", exact: true }).fill("20");
  await expect(page.getByTestId("geometry-status")).toHaveText(/Model up to date/i, { timeout: 60_000 });
  await page.getByRole("button", { name: "OK", exact: true }).click();

  const features = page.getByRole("tab", { name: "Feature Manager" });
  const properties = page.getByRole("tab", { name: "Property Manager" });
  await expect(features).toHaveAttribute("aria-selected", "true");
  await page.getByRole("treeitem", { name: /Boss-Extrude1/ }).getByRole("button", { name: "Boss-Extrude1", exact: true }).dblclick();
  await expect(properties).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "OK", exact: true })).toBeEnabled();
  await page.getByTestId("ribbon").getByRole("tab", { name: "Home" }).click();
  await ribbonButton(page, "Zoom to Fit").click();
  const canvas = page.locator("canvas").first();
  const rect = await canvas.boundingBox();
  if (!rect) throw new Error("The solid viewport is not rendered");
  await canvas.click({ position: { x: rect.width / 2, y: rect.height / 2 }, button: "right" });
  await expect(features).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("treeitem", { name: /Boss-Extrude2/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await page.getByRole("treeitem", { name: /Boss-Extrude2/ }).click();
  await properties.click();
  await expect(page.getByRole("button", { name: "OK", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});
