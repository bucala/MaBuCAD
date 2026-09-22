import { describe, expect, it } from "vitest";

import { contentHash } from "./rebuildCache";

import { viewsAreStale, viewsMatchSource } from "./drawingStaleness";

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

/**
 * The counterpart rule behind Update Views skipping the part rebuild. Where `viewsAreStale`
 * is allowed to be cheap and approximate (it must never alarm without proof), this one must
 * never claim views are current without proof — the two failure modes are opposite, so a
 * missing hash reads as "re-project" here and as "not stale" above.
 */
describe("viewsMatchSource", () => {
  const partFile = JSON.stringify({ document: { id: "part-1" }, sketches: {} });

  it("the same bytes the views were projected from means re-projecting changes nothing", () => {
    expect(viewsMatchSource(contentHash(partFile), contentHash(partFile))).toBe(true);
  });

  it("an edited part file must re-project", () => {
    const edited = JSON.stringify({ document: { id: "part-1", features: ["extrude"] }, sketches: {} });
    expect(viewsMatchSource(contentHash(partFile), contentHash(edited))).toBe(false);
  });

  it("a whitespace-only rewrite of the same document still re-projects, rather than guessing", () => {
    // Hashing bytes rather than parsed content keeps the rule decidable without a rebuild:
    // it may only ever skip work it can prove is redundant, so a re-serialised file re-projects.
    const reserialised = JSON.stringify(JSON.parse(partFile), null, 2);
    expect(viewsMatchSource(contentHash(partFile), contentHash(reserialised))).toBe(false);
  });

  it("a drawing saved before the hash existed always re-projects", () => {
    expect(viewsMatchSource(undefined, contentHash(partFile))).toBe(false);
  });
});
