import { describe, expect, it } from "vitest";

import { SEAT_STANDARDS } from "./holeStandards";

/**
 * The seat labels are user-visible — the property panel's seat summary prints one — and
 * they cite fastener standards by number. The spotface label shipped for weeks citing
 * "ISO 24014", which is a public-transport fare-management standard, not a screw standard,
 * and nothing caught it because no test looked. These pins make any future mis-citation of
 * a standard number fail here instead of reaching a drawing.
 */
describe("SEAT_STANDARDS citations", () => {
  it("cites the correct fastener standard for every seat type", () => {
    expect(SEAT_STANDARDS.counterbore.label).toBe("Socket Head Cap Screw ISO 4762");
    expect(SEAT_STANDARDS.spotface.label).toBe("Hex Head Bolt ISO 4014/4017");
    expect(SEAT_STANDARDS.countersink.label).toBe("Countersunk Flat Head Screw ISO 2009/7046");
  });
});
