import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { ribbonButton } from "./locators";
import { createRectangleSketch, extrudeCurrentSketch, saveDocumentAs } from "./partWorkflows";

/**
 * Assembly phase 1, end to end: save a real part, create an Assembly, insert the part
 * twice (first is grounded), move the second numerically, save, and reopen — where the
 * browser fallback has no path to re-read the part from, so the component shows as
 * missing until it is relinked.
 */

async function insertComponent(page: Page, partPath: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("ribbon").getByRole("tab", { name: "Assembly" }).click();
  await ribbonButton(page, "Insert Component").click();
  await (await chooser).setFiles(partPath);
}

test("an assembly places saved parts, moves one, and survives save/reopen", async ({ page }) => {
  await page.goto("/");
  await createRectangleSketch(page);
  await extrudeCurrentSketch(page);
  const partPath = (await (await saveDocumentAs(page)).path())!;

  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "New" }).click();
  await page.getByRole("dialog", { name: "New Document" }).getByRole("button", { name: /^Assembly/ }).click();
  await page.getByRole("tab", { name: "Feature Manager" }).click();
  const tree = page.getByTestId("assembly-tree");
  await expect(tree).toContainText(/No components yet/);

  await insertComponent(page, partPath);
  const first = tree.getByRole("treeitem").nth(0);
  await expect(first).toContainText("Grounded");
  await insertComponent(page, partPath);
  const second = tree.getByRole("treeitem").nth(1);
  await expect(second).not.toContainText("Grounded");
  await expect(tree.getByRole("treeitem")).toHaveCount(2);
  await expect(tree).not.toContainText(/Loading|Error|File missing/);

  // Inserting selects the new component; its placement panel is live.
  const placement = page.getByTestId("component-placement");
  await placement.getByLabel("X position").fill("50");
  await placement.getByLabel("X position").press("Enter");
  await expect(placement.getByLabel("X position")).toHaveValue("50");

  // The grounded component's fields are locked.
  await first.click();
  await expect(placement.getByLabel("X position")).toBeDisabled();

  const saved = JSON.parse(readFileSync((await (await saveDocumentAs(page)).path())!, "utf8")) as {
    formatVersion: number;
    document: { kind: string; assembly: { components: { grounded: boolean; transform: { position: number[] } }[] } };
  };
  expect(saved.formatVersion).toBe(3);
  expect(saved.document.kind).toBe("assembly");
  expect(saved.document.assembly.components.map((c) => c.grounded)).toEqual([true, false]);
  expect(saved.document.assembly.components[1]!.transform.position).toEqual([50, 0, 0]);
});

test("a reopened assembly flags components it can't re-read, and Relink restores them", async ({ page }) => {
  await page.goto("/");
  await createRectangleSketch(page);
  await extrudeCurrentSketch(page);
  const partPath = (await (await saveDocumentAs(page)).path())!;

  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "New" }).click();
  await page.getByRole("dialog", { name: "New Document" }).getByRole("button", { name: /^Assembly/ }).click();
  await insertComponent(page, partPath);
  const assemblyPath = (await (await saveDocumentAs(page)).path())!;

  const openChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Open…" }).click();
  await (await openChooser).setFiles(assemblyPath);

  await page.getByRole("tab", { name: "Feature Manager" }).click();
  const tree = page.getByTestId("assembly-tree");
  const row = tree.getByRole("treeitem").first();
  await expect(row).toContainText("File missing");

  await row.click();
  const relinkChooser = page.waitForEvent("filechooser");
  await tree.getByRole("button", { name: /Relink/ }).click();
  await (await relinkChooser).setFiles(partPath);
  await expect(row).not.toContainText("File missing");
});
