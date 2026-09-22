import { describe, expect, it } from "vitest";

import { viewsAreStale } from "./drawingStaleness";

/**
 * The "are this drawing's views still current?" contract — the one pure rule behind the
 * amber Update Views indicator. `viewsAreStale` compares the stamp captured when the
 * views were projected against a fresh stat of the referenced part file; anything
 * unverifiable must read as *not stale*, because the indicator may only ever point at a
 * change it can prove — never cry wolf over an old drawing or a session that can't stat
 * the part.
 */
describe("viewsAreStale", () => {
  const projected = { modifiedMs: 1000, size: 500 };

  it("an unchanged part file is current", () => {
    expect(viewsAreStale(projected, { ...projected })).toBe(false);
  });

  it("a newer modification time makes the views stale", () => {
    expect(viewsAreStale(projected, { modifiedMs: 2000, size: 500 })).toBe(true);
  });

  it("a size change alone makes the views stale (a same-tick rewrite)", () => {
    expect(viewsAreStale(projected, { modifiedMs: 1000, size: 501 })).toBe(true);
  });

  it("a drawing saved before stamps existed never alarms", () => {
    expect(viewsAreStale(undefined, { modifiedMs: 999, size: 499 })).toBe(false);
  });

  it("an unverifiable part file (unblessed path, browser build, deleted file) never alarms", () => {
    expect(viewsAreStale(projected, null)).toBe(false);
  });

  it("both unknowns together read as current", () => {
    expect(viewsAreStale(undefined, null)).toBe(false);
  });
});
