import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { createRectangleSketch, saveDocumentAs } from "./partWorkflows";

/**
 * Whole-document persistence end to end: draw a profile, exit the sketch, save the file
 * (a download in plain-browser mode), reopen it in a fresh document, and verify both the
 * on-disk envelope and the reopened tree/sketch. Because the suite drives the dev server
 * without Tauri, "Save As" lands as a browser download and "Open" reads through the file
 * input — the same code paths `io/files.ts` switches to in a packaged app, where real
 * dialogs take over.
 */
test("a drawn sketch survives a save/open round trip as a current-format document", async ({ page }) => {
  await page.goto("/");

  // Draw a rectangle, then commit it as a feature so the tree has something to reopen.
  await createRectangleSketch(page);

  // Save As writes a file; capture the browser download and read its contents back.
  const download = await saveDocumentAs(page);
  expect(download.suggestedFilename()).toMatch(/\.mabucad$/i);

  // The round trip proves the migration round's format bump: the file claims the current
  // version, records the unit system it was drawn in, and still carries the rectangle's
  // four entities.
  const savedPath = await download.path();
  const saved = JSON.parse(readFileSync(savedPath, "utf8")) as Record<string, unknown>;
  expect(saved.formatVersion).toBe(2);
  expect(saved.unitSystem).toBe("MMGS");
  const savedSketches = saved.sketches as Record<string, { entities?: unknown[] }>;
  const sketchEntries = Object.values(savedSketches);
  expect(sketchEntries).toHaveLength(1);
  expect(sketchEntries[0]?.entities).toHaveLength(4);

  // Start a fresh Part (the New command parks behind its type picker)…
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: "New" }).click();
  await page.getByRole("dialog", { name: "New Document" }).getByRole("button", { name: "Create Part" }).click();
  await expect(page.getByRole("contentinfo")).toContainText("0 features");

  // …and reopen the file we just saved through the browser file input.
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: "Open…" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(savedPath);

  // The reopened document has the sketch back in the feature tree, and the sketch itself
  // still holds the rectangle's four entities — parametric history, not just a shape.
  await page.getByRole("tab", { name: "Feature Manager" }).click();
  const sketchRow = page.getByRole("treeitem", { name: /Sketch1/ });
  await expect(sketchRow).toBeVisible();

  // Selecting the feature swings the dock to its property panel (which detaches the tree
  // mid-gesture, swallowing a plain double-click). Step back to the tree first: the row is
  // now already selected, so a further double-click no longer swings the panel and the
  // edit-sketch gesture completes.
  await sketchRow.click();
  await page.getByRole("tab", { name: "Feature Manager" }).click();
  await expect(sketchRow).toBeVisible();
  await sketchRow.dblclick();
  await expect(page.getByTestId("sketch-entity-count")).toHaveText("4");
});
