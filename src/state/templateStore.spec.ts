import { describe, expect, it } from "vitest";

import { seedTemplateIdCounter, useTemplateStore } from "./templateStore";
import { highestIdSuffix } from "@/utils/idSuffix";

/**
 * Regression coverage for the "new template overwrites an existing one by id collision"
 * bug (WP00): `nextId`'s counter here is a plain module-level variable, not part of this
 * store's `persist`ed state, so a page reload rehydrates `borders`/`titleBlocks`/
 * `sheetFormats` from `localStorage` while the counter itself resets to 0 — the exact
 * failure mode `documentStore.ts` and `sketchModel.ts` close for feature and sketch ids.
 * `onRehydrateStorage` now reseeds this counter the same way on load; this pins the
 * reseed arithmetic itself via the same exported helper it calls.
 */
describe("templateStore: id counter reseeds via seedTemplateIdCounter", () => {
  it("a border added after seeding never collides with a high-numbered rehydrated id", () => {
    const highBorder = { id: "border-900", name: "Legacy", margin: 5, zoneColumns: 4, zoneRows: 4, centreMarks: false };

    seedTemplateIdCounter(highestIdSuffix({ borders: [highBorder] }));

    const newId = useTemplateStore.getState().addBorder({
      name: "New",
      margin: 10,
      zoneColumns: 8,
      zoneRows: 6,
      centreMarks: true,
    });

    expect(newId).not.toBe(highBorder.id);
  });
});
