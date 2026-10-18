import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import type { SavedDocument } from "../src/io/documentValidation";
import type { DrawingSheetData } from "../src/types/document";

import { ribbonButton } from "./locators";
import {
  createRectangleSketch,
  extrudeCurrentSketch,
  saveDocumentAs,
} from "./partWorkflows";

/**
 * Drawing ▸ Insert Model View end to end — under the exact CSP the packaged Tauri app
 * ships, not the dev server's default of none.
 *
 * Why the CSP matters here and nowhere else in the suite: the OCCT wasm glue generates
 * embind invoker functions at runtime through `new Function`, so a policy without
 * `'unsafe-eval'` lets the kernel *compile* fine and then die the moment a projection (or
 * a Circular Pattern) first exercises a generated invoker — exactly the crash that shipped
 * in the released app and got saved into the supplied Part2.mabucad's Circular Pattern
 * feature. A plain dev-server test would never catch a regression here because the dev
 * server serves no CSP at all, so this file reads the shipped policy straight from
 * `src-tauri/tauri.conf.json` and injects it into the page as a `<meta>` CSP — the same
 * delivery mechanism Tauri itself uses — meaning the test can never drift from what the
 * packaged app actually enforces.
 */
const tauriConfig = JSON.parse(
  readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
) as { app: { security: { csp: string } } };
const SHIPPED_CSP = tauriConfig.app.security.csp;

/** Injects `csp` into the production-preview index document as a `<meta>` CSP — the way
 * Tauri delivers the policy — so the browser enforces it for everything the page then
 * loads. Must be armed before the navigation it should apply to. */
async function enforceCsp(page: Page, baseURL: string | undefined, csp: string) {
  if (!baseURL) throw new Error("Playwright CSP baseURL is not configured");
  const indexUrl = new URL("/", baseURL).toString();
  await page.route(indexUrl, async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(
      "<head>",
      `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`,
    );
    await route.fulfill({ response, body: html });
  });
}

/** Draws a rectangle, extrudes it (booting the wasm kernel) and saves the Part; returns
 * the saved file's path — the same shape `documents.spec.ts`'s round trip ends with. */
async function buildAndSavePart(page: Page): Promise<string> {
  await createRectangleSketch(page);
  await extrudeCurrentSketch(page);
  const path = await (await saveDocumentAs(page)).path();
  if (!path) throw new Error("Playwright did not persist the downloaded Part file");
  return path;
}

/** Creates a fresh Drawing and runs Insert Model View against the saved Part — the browser's
 * file-input fallback is what Playwright's `filechooser` event lands on (`io/files.ts`). */
async function insertModelViews(page: Page, partPath: string) {
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: "New" }).click();
  await page
    .getByRole("dialog", { name: "New Document" })
    .getByRole("button", { name: /^Drawing/ })
    .click();

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Insert Model View" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(partPath);
}

async function savedSheet(page: Page): Promise<DrawingSheetData> {
  const path = await (await saveDocumentAs(page)).path();
  if (!path) throw new Error("Playwright did not persist the downloaded Drawing file");
  const saved = JSON.parse(readFileSync(path, "utf8")) as SavedDocument;
  if (!saved.document.drawing) throw new Error("The saved document has no drawing sheet");
  return saved.document.drawing;
}

/** Pick real rendered rectangle corners, independently of the application's picking math.
 * The source part is the actual prism built by buildAndSavePart, never a fixture cache. */
async function renderedCorner(page: Page, viewId: string, right = false) {
  const rect = await page.locator(`svg[data-view-id="${viewId}"]`).boundingBox();
  if (!rect) throw new Error("The drawing view is not rendered");
  return { x: rect.x + (right ? rect.width : 0), y: rect.y };
}

async function dragView(page: Page, viewId: string, dx: number, dy: number) {
  const handle = page.locator(`[data-view-handle="${viewId}"]`);
  const rect = await handle.boundingBox();
  if (!rect) throw new Error("The drawing view has no drag handle");
  const pixelsPerMm = await page.getByTestId("drawing-sheet").evaluate((sheet) =>
    sheet.getBoundingClientRect().width / (sheet as unknown as SVGSVGElement).viewBox.baseVal.width,
  );
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    rect.x + rect.width / 2 + dx * pixelsPerMm,
    rect.y + rect.height / 2 + dy * pixelsPerMm,
    { steps: 6 },
  );
  await page.mouse.up();
}

test("Insert Model View projects the default views under the shipped Tauri CSP", async ({ page, baseURL }) => {
  test.setTimeout(120_000);

  // The whole flow — extrude and projection both — runs under the exact shipped policy,
  // since the packaged app enforces it for the whole session, not just one command.
  await enforceCsp(page, baseURL, SHIPPED_CSP);
  await page.goto("/");

  const partPath = await buildAndSavePart(page);
  await insertModelViews(page, partPath);

  // Success lands as the "Inserted views of…" toast in the status bar readout.
  await expect(page.getByTestId("geometry-status")).toContainText(/Inserted views of/i, {
    timeout: 60_000,
  });
  // And the sheet really took the views: the toolbar's Update Views button only renders
  // once a `sourcePart` exists, so this doubles as the structural proof the views (and not
  // just a toast) landed.
  await expect(page.getByRole("button", { name: "Update Views" })).toBeVisible();

  // The Phase 3 derived-view commands must be real Drawing commands, not ribbon placeholders.
  await page.getByTestId("ribbon").getByRole("tab", { name: "Drawing" }).click();
  await expect(page.getByRole("button", { name: "Auxiliary" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Broken" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Crop" })).toBeVisible();

  // Updating against the *same, unchanged* part file must recognise that re-projecting
  // could only reproduce the cache it already has, and skip the part rebuild entirely
  // (`DrawingSheetData.sourceContentHash`). Proven from the outside by the command's own
  // report: the "unchanged" wording is only reachable through the skip branch, never
  // through a real re-projection, which reports "Views updated" instead.
  const updateChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Update Views" }).last().click();
  await (await updateChooserPromise).setFiles(partPath);
  await expect(page.getByTestId("geometry-status")).toContainText(/unchanged — views are already up to date/i, {
    timeout: 60_000,
  });
});

test("the same flow under the previous CSP (no 'unsafe-eval') fails the way the shipped app did", async ({ page, baseURL }) => {
  test.setTimeout(120_000);

  // Build the Part without any injected policy first — the extrude path is precisely what
  // already worked under the old policy (the supplied Part2.mabucad carries built
  // extrudes), so the part file is safe to build here. Then reload into a page enforcing
  // the shipped policy minus 'unsafe-eval' for the drawing step alone.
  await page.goto("/");
  const partPath = await buildAndSavePart(page);

  await enforceCsp(page, baseURL, SHIPPED_CSP.replace(" 'unsafe-eval'", ""));
  await page.goto("/");
  await insertModelViews(page, partPath);

  // The projection dies inside the kernel's embind glue and surfaces as the command's own
  // failure toast — the exact symptom the CSP fix exists to keep from coming back. This
  // control also proves the harness above genuinely enforces the policy: without a
  // failure here, the positive test would be proving nothing.
  await expect(page.getByTestId("geometry-status")).toContainText(/Insert Model View failed/i, {
    timeout: 60_000,
  });
});

test("zoomed and panned drawing picks create real dimensions and view alignment remains linked", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  await enforceCsp(page, baseURL, SHIPPED_CSP);
  await page.goto("/");
  await insertModelViews(page, await buildAndSavePart(page));
  await expect(page.getByTestId("geometry-status")).toContainText(/Inserted views of/i, { timeout: 60_000 });
  const initial = await savedSheet(page);
  const front = initial.views.find((view) => view.projection === "front")!;
  const right = initial.views.find((view) => view.projection === "right")!;

  await page.getByTestId("ribbon").getByRole("tab", { name: "Drawing" }).click();
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  const paper = await page.getByTestId("drawing-sheet").boundingBox();
  if (!paper) throw new Error("The drawing sheet is not rendered");
  await page.mouse.move(paper.x + 30, paper.y + 30);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(paper.x + 115, paper.y + 70, { steps: 6 });
  await page.mouse.up({ button: "middle" });

  await ribbonButton(page, "Smart Dimension").click();
  const first = await renderedCorner(page, front.id);
  const second = await renderedCorner(page, front.id, true);
  await page.mouse.click(first.x, first.y);
  const marker = page.getByTestId("dimension-first-pick");
  await expect(marker).toBeVisible();
  expect(Number(await marker.getAttribute("cx"))).toBeCloseTo(front.x - front.width * front.scale / 2);
  expect(Number(await marker.getAttribute("cy"))).toBeCloseTo(front.y - front.height * front.scale / 2);
  await page.mouse.click(first.x, first.y);
  await expect(page.locator("[data-drawing-dimension]")).toHaveCount(0);
  const other = await renderedCorner(page, right.id);
  await page.mouse.click(other.x, other.y);
  await expect(page.locator("[data-drawing-dimension]")).toHaveCount(0);
  await expect(marker).toBeVisible();
  await page.mouse.click(second.x, second.y);
  await expect(page.locator("[data-drawing-dimension]")).toHaveCount(1);
  await expect(marker).toHaveCount(0);
  await expect(page.locator("[data-drawing-dimension] text")).toHaveText(front.width.toFixed(2));

  await ribbonButton(page, "Ordinate").click();
  await page.mouse.click(first.x, first.y);
  await expect(page.getByTestId("ordinate-datum-pick")).toBeVisible();
  await page.mouse.click(other.x, other.y);
  expect((await savedSheet(page)).ordinateChains ?? []).toHaveLength(0);
  await page.mouse.click(second.x, second.y);
  const measured = await savedSheet(page);
  expect(measured.dimensions![0]).toMatchObject({ parentViewId: front.id, kind: "horizontal" });
  expect(measured.dimensions![0].value).toBeCloseTo(front.width);
  expect(measured.ordinateChains![0].parentViewId).toBe(front.id);
  expect(measured.ordinateChains![0].points[0].value).toBeCloseTo(front.width);
  await page.screenshot({ path: testInfo.outputPath("drawing-dimensions-zoom-pan.png") });

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("ordinate-datum-pick")).toHaveCount(0);
  await expect(page.locator(`[data-view-handle="${right.id}"]`)).toBeVisible();
  await dragView(page, right.id, 12, 10);
  let sheet = await savedSheet(page);
  expect(sheet.views.find((view) => view.id === right.id)).toMatchObject({ y: front.y });
  expect(sheet.views.find((view) => view.id === right.id)!.x).toBeCloseTo(right.x + 12);
  await page.getByRole("button", { name: "Unlink Position", exact: true }).click();
  await dragView(page, right.id, 0, 10);
  sheet = await savedSheet(page);
  expect(sheet.views.find((view) => view.id === right.id)!.y).toBeCloseTo(front.y + 10);
  expect(sheet.views.find((view) => view.id === right.id)!.alignmentUnlocked).toBe(true);
  await page.getByRole("button", { name: "Re-link Position", exact: true }).click();
  sheet = await savedSheet(page);
  expect(sheet.views.find((view) => view.id === right.id)).toMatchObject({ y: front.y, alignmentUnlocked: false });

  const dimension = sheet.dimensions![0];
  await dragView(page, front.id, 6, 8);
  const moved = await savedSheet(page);
  expect(moved.views.find((view) => view.id === right.id)!.y).toBeCloseTo(front.y + 8);
  expect(moved.dimensions![0].x1).toBeCloseTo(dimension.x1 + 6);
  expect(moved.dimensions![0].y1).toBeCloseTo(dimension.y1 + 8);
  expect(moved.ordinateChains![0].datumY).toBeCloseTo(sheet.ordinateChains![0].datumY + 8);
  await page.screenshot({ path: testInfo.outputPath("drawing-linked-views.png") });

  await page.getByTestId("ribbon").getByRole("tab", { name: "Home" }).click();
  await ribbonButton(page, "Undo").click();
  const undone = await savedSheet(page);
  expect(undone.views).toEqual(sheet.views);
  expect(undone.dimensions).toEqual(sheet.dimensions);
});

test("horizontal sections and horizontal-axis auxiliary views start in their source column", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await enforceCsp(page, baseURL, SHIPPED_CSP);
  await page.goto("/");
  const partPath = await buildAndSavePart(page);
  await insertModelViews(page, partPath);
  await expect(page.getByTestId("geometry-status")).toContainText(/Inserted views of/i, { timeout: 60_000 });
  const initial = await savedSheet(page);
  const front = initial.views.find((view) => view.projection === "front")!;
  await page.getByTestId("ribbon").getByRole("tab", { name: "Drawing" }).click();
  const pickSource = async () => {
    const rect = await page.locator(`svg[data-view-id="${front.id}"]`).boundingBox();
    if (!rect) throw new Error("The source view is not rendered");
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  };

  await ribbonButton(page, "Section").click();
  await pickSource();
  await page.getByRole("button", { name: "Horizontal cut", exact: true }).click();
  const sectionChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Create section view", exact: true }).click();
  await (await sectionChooser).setFiles(partPath);
  await expect(page.getByTestId("geometry-status")).toContainText(/Section view created/i, { timeout: 60_000 });
  let sheet = await savedSheet(page);
  const section = sheet.views.find((view) => view.kind === "section")!;
  expect(section.x).toBe(front.x);
  expect(section.y).toBeGreaterThan(front.y);

  await ribbonButton(page, "Auxiliary").click();
  await pickSource();
  await page.getByRole("button", { name: "Tilt around horizontal screen axis", exact: true }).click();
  const auxiliaryChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Create auxiliary view", exact: true }).click();
  await (await auxiliaryChooser).setFiles(partPath);
  await expect(page.getByTestId("geometry-status")).toContainText(/Auxiliary view created/i, { timeout: 60_000 });
  sheet = await savedSheet(page);
  const auxiliary = sheet.views.find((view) => view.kind === "auxiliary")!;
  expect(auxiliary.x).toBe(front.x);
  expect(auxiliary.y).toBeGreaterThan(front.y);
  await dragView(page, front.id, 5, 0);
  const moved = await savedSheet(page);
  for (const derived of [section, auxiliary]) {
    expect(moved.views.find((view) => view.id === derived.id)!.x).toBeCloseTo(front.x + 5);
  }
});
