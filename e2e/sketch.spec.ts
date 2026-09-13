import { expect, test } from "@playwright/test";

import { ribbonButton } from "./locators";

/**
 * The sketcher loop: enter a sketch, draw geometry, watch the constraint solver's status
 * and DOF readout respond, then undo/redo it.
 */

test("a drawn line enters the solver state and survives undo/redo", async ({ page }) => {
  await page.goto("/");

  // Enter sketch mode: the Sketch command with nothing selected starts a new sketch on
  // the default Front plane.
  await page.getByRole("tab", { name: "Sketch" }).click();
  await ribbonButton(page, "Sketch").click();

  // Sketch mode is on: the status chip swaps to the sketch's own state and the sketch
  // panel (entity count, DOF) replaces the property manager in the left dock.
  await expect(page.getByTestId("sketch-status")).toContainText(/defined/i);
  await expect(page.getByTestId("sketch-entity-count")).toHaveText("0");

  await ribbonButton(page, "Line").click();

  // Two clicks on the viewport canvas commit one line. The canvas is the first <canvas>
  // element; coordinates are relative to it, well inside the pickable sketch plane.
  const canvas = page.locator("canvas").first();
  await canvas.click({ position: { x: 500, y: 350 } });
  await canvas.click({ position: { x: 650, y: 450 } });

  // One entity, four free degrees of freedom (both endpoints unconstrained), reported as
  // an under-defined sketch — the solver's live readout.
  await expect(page.getByTestId("sketch-entity-count")).toHaveText("1");
  await expect(page.getByTestId("sketch-dof")).toHaveText("4");
  await expect(page.getByTestId("sketch-status")).toContainText(/under defined/i);

  // Undo/redo route to the sketch's own history while a sketch is open.
  await page.getByRole("tab", { name: "Home" }).click();
  await ribbonButton(page, "Undo").click();
  await expect(page.getByTestId("sketch-entity-count")).toHaveText("0");

  await ribbonButton(page, "Redo").click();
  await expect(page.getByTestId("sketch-entity-count")).toHaveText("1");
});

test("a constrained sketch reports fewer degrees of freedom", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("tab", { name: "Sketch" }).click();
  await ribbonButton(page, "Sketch").click();
  await expect(page.getByTestId("sketch-entity-count")).toHaveText("0");

  // A rectangle is four lines plus the relations that make it one — its DOF is far
  // below the 8 of four loose lines, and the sketch stays under-defined until dimensions
  // pin it. This is the cheapest end-to-end proof that the constraint solver actually
  // solves what the tools produce, not just that entities appear.
  await ribbonButton(page, "Rectangle").click();
  const canvas = page.locator("canvas").first();
  await canvas.click({ position: { x: 500, y: 350 } });
  await canvas.click({ position: { x: 700, y: 500 } });

  await expect(page.getByTestId("sketch-entity-count")).toHaveText("4");
  const dof = Number(await page.getByTestId("sketch-dof").textContent());
  expect(dof).toBeGreaterThan(0);
  expect(dof).toBeLessThan(8);
  await expect(page.getByTestId("sketch-status")).toContainText(/under defined/i);
});
