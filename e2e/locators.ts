import type { Page } from "@playwright/test";

/**
 * Ribbon command buttons, scoped to the ribbon element. Two other surfaces expose
 * buttons with the same accessible names: the sketch panel's tool strip (Line,
 * Rectangle, ...) and the window toolbar (Undo, Redo) — an unscoped
 * `getByRole("button", { name: "Line" })` is a strict-mode violation.
 */
export function ribbonButton(page: Page, name: string) {
  return page.getByTestId("ribbon").getByRole("button", { name, exact: true });
}
