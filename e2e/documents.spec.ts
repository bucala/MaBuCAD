import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { createRectangleSketch, extrudeCurrentSketch, saveDocumentAs } from "./partWorkflows";

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

  // Browsing keeps the feature tree mounted; an explicit double-click opens the sketch.
  await sketchRow.click();
  await expect(page.getByRole("tab", { name: "Feature Manager" })).toHaveAttribute("aria-selected", "true");
  await expect(sketchRow).toBeVisible();
  await sketchRow.dblclick();
  await expect(page.getByTestId("sketch-entity-count")).toHaveText("4");
});

test("STEP export uses the active document and imported geometry survives reopen", async ({ page }) => {
  await page.goto("/");
  await createRectangleSketch(page);
  await extrudeCurrentSketch(page);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export STEP…" }).click();
  const stepPath = await (await download).path();

  await page.keyboard.press("Control+n");
  await page.getByRole("button", { name: "Create Part" }).click();
  await expect(page.getByRole("contentinfo")).toContainText("0 features");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export STEP…" }).click();
  await expect(page.getByText("Nothing to export yet — build a feature first")).toBeVisible();

  const importPicker = page.waitForEvent("filechooser");
  await page.keyboard.press("Control+Shift+o");
  await (await importPicker).setFiles({
    name: "imported-block.step",
    mimeType: "application/step",
    buffer: readFileSync(stepPath),
  });
  await expect(page.getByTestId("geometry-status")).toHaveText(/Model up to date/i);
  const save = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  const savedPath = await (await save).path();

  await page.reload();
  await expect(page.getByRole("tab", { name: "Part1" })).toBeVisible();
  const openPicker = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Open…" }).click();
  await (await openPicker).setFiles(savedPath);

  await expect(page.getByRole("treeitem", { name: /imported-block/ })).toBeVisible();
  await expect(page.getByTestId("geometry-status")).toHaveText(/Model up to date/i);
  const reExport = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export STEP…" }).click();
  expect(readFileSync(await (await reExport).path(), "utf8")).toContain("MANIFOLD_SOLID_BREP");
});

test("closing a dirty background tab can be cancelled or saved without switching documents", async ({ page }) => {
  await page.goto("/");
  await createRectangleSketch(page);
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create Part" }).click();

  const closeFirst = page.getByRole("button", { name: "Close Part1", exact: true });
  const second = page.getByRole("tab", { name: /^Part2/ });
  const confirmation = page.getByRole("dialog", { name: "Save changes before closing?" });
  await closeFirst.click();
  await expect(confirmation.getByRole("listitem")).toHaveText("Part1");
  await expect(confirmation.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeHidden();
  await expect(closeFirst).toBeVisible();
  await expect(second).toHaveAttribute("aria-selected", "true");

  await closeFirst.click();
  const download = page.waitForEvent("download");
  await confirmation.getByRole("button", { name: "Save and close", exact: true }).click();
  const saved = JSON.parse(readFileSync(await (await download).path(), "utf8"));
  expect(saved.document.name).toBe("Part1");
  expect(Object.values(saved.sketches)).toHaveLength(1);
  await expect(closeFirst).toBeHidden();
  await expect(second).toHaveAttribute("aria-selected", "true");
});
