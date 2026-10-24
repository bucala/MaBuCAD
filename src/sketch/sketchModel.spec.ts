import { describe, expect, it } from "vitest";

import { addLine, createSketch, seedSketchIdCounter } from "./sketchModel";
import { highestIdSuffix } from "@/utils/idSuffix";

/**
 * Regression coverage for the "new sketch overwrites existing geometry by id collision"
 * bug (WP00): this module's `uid` counter is a plain module-level variable, so loading a
 * sketch whose points/entities already carry high-numbered ids (Open, autosave restore, a
 * tab switch — all go through `sketchStore.ts`'s `loadSketches`) used to leave the counter
 * wherever it last was in *this* session, letting the very next `addLine`/`addPoint` mint
 * an id that already exists in what was just loaded. `loadSketches` now reseeds the
 * counter via `seedSketchIdCounter(highestIdSuffix(sketches))` before any new id is minted.
 */
describe("sketchModel: id counter reseeds via seedSketchIdCounter", () => {
  it("a line added after seeding never collides with a high-numbered loaded id", () => {
    const sketch = createSketch("sketch-1", "plane-top");
    const highPoint = { id: "pt-900", x: 0, y: 0 };
    const seeded = { ...sketch, points: [...sketch.points, highPoint] };

    seedSketchIdCounter(highestIdSuffix({ "sketch-1": seeded }));

    const { sketch: next, startId, endId } = addLine(seeded, { x: 1, y: 1 }, { x: 2, y: 2 });

    expect(startId).not.toBe(highPoint.id);
    expect(endId).not.toBe(highPoint.id);
    expect(next.points.filter((p) => p.id === highPoint.id)).toHaveLength(1);
  });
});
