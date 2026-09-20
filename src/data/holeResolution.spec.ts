import { describe, expect, it } from "vitest";

import { TAPPED_STANDARDS, type TappedStandardId } from "./holeStandards";
import { defaultTappedDesignation, resolveTapDrill } from "./holeResolution";

/**
 * The Hole Wizard's default tapped designation — what a hole lands on the moment it
 * becomes Tapped, or when the standard dropdown is switched. The default used to be the
 * first row of the standard's table (an M1x0.25 instrument thread, a 1/16-27 NPT watch
 * fitting), which is never the size a real part wants; these pin the corrected choice.
 */
describe("defaultTappedDesignation", () => {
  it("defaults ISO and ANSI metric tapped holes to M6 coarse — the everyday size, not M1", () => {
    expect(defaultTappedDesignation("iso-metric")).toBe("M6x1");
    expect(defaultTappedDesignation("ansi-metric")).toBe("M6x1");
  });

  it("returns the coarse pitch of the size group, not a fine one", () => {
    // M6's rows carry M6x1 (coarse) first, then the fine pitches — the default must be the
    // coarse thread, with fine ones left for the user to deliberately pick.
    const entry = resolveTapDrill("iso-metric", defaultTappedDesignation("iso-metric"));
    expect(entry?.sizeLabel).toBe("M6");
    expect(entry?.pitch).toBe(1);
  });

  it("falls back to the middle of the range for standards with no M6 row", () => {
    // NPT's rows run 1/16 to 2 — the middle is a usable pipe size, not the 1/16 watch
    // fitting the old first-row default picked.
    const designation = defaultTappedDesignation("npt");
    expect(designation).toBe("1/2-14 NPT");

    // Every standard resolves to a designation that actually exists in its own table.
    for (const standardId of Object.keys(TAPPED_STANDARDS) as TappedStandardId[]) {
      const resolved = resolveTapDrill(standardId, defaultTappedDesignation(standardId));
      expect(resolved, `${standardId} default must resolve in its own table`).toBeDefined();
    }
  });
});
