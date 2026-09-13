import { expect, test } from "@playwright/test";

/**
 * The language switcher works end to end: pick Slovak in Settings ▸ General and the
 * surrounding chrome re-labels itself. The ribbon's own Slovak coverage is pinned by a
 * unit test (`src/i18n/translations.spec.ts`) walking the whole command table; this is
 * the one-string proof that the switch actually reaches the UI.
 */
test("switching the language to Slovak translates the chrome", async ({ page }) => {
  await page.goto("/");

  // Tools ▸ Options opens the settings dialog with General selected by default.
  await page.getByRole("button", { name: "Tools" }).click();
  await page.getByRole("menuitem", { name: /Options/ }).click();
  const dialog = page.getByRole("dialog", { name: "Application Options" });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Language").selectOption("sk");
  await page.getByRole("button", { name: "Close Application Options" }).click();

  // The File menu label and a menu entry are now the Slovak strings from the dictionary.
  await expect(page.getByRole("button", { name: "Súbor" })).toBeVisible();
  await page.getByRole("button", { name: "Súbor" }).click();
  await expect(page.getByRole("menuitem", { name: "Uložiť ako" })).toBeVisible();
});
