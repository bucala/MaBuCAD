import { describe, expect, it } from "vitest";

import { DOCUMENT_FORMAT_VERSION } from "@/io/documentValidation";
import type { Sketch } from "@/sketch/types";
import type { Feature } from "@/types/document";

import { __clearComponentCacheForTesting, __componentCacheSizeForTesting, loadPartMesh } from "./componentLoader";
import { initKernel } from "./occ";
import { __clearRebuildCacheForTesting, getCurrentShape, rebuildDocument } from "./rebuild";

function squareSketch(id: string, size: number): Sketch {
  const pts: [number, number][] = [
    [0, 0],
    [size, 0],
    [size, size],
    [0, size],
  ];
  return {
    id,
    planeId: "plane-front",
    points: pts.map(([x, y], i) => ({ id: `${id}-p${i}`, x, y })),
    entities: pts.map((_, i) => ({
      id: `${id}-l${i}`,
      kind: "line" as const,
      start: `${id}-p${i}`,
      end: `${id}-p${(i + 1) % pts.length}`,
      construction: false,
    })),
    constraints: [],
    dimensions: [],
  };
}

function extrude(id: string, sketchId: string, depth: number): Feature {
  return { id, kind: "extrude", name: id, suppressed: false, isDefault: false, parents: [sketchId], parameters: { depth, endCondition: "blind", operation: "join" } };
}

function partFile(size: number): string {
  const features = [extrude("f0", "s1", 5)];
  return JSON.stringify({
    formatVersion: DOCUMENT_FORMAT_VERSION,
    unitSystem: "MMGS",
    document: { id: "doc", name: "Part", kind: "part", features, rollbackIndex: features.length },
    sketches: { s1: squareSketch("s1", size) },
  });
}

describe("loadPartMesh", () => {
  it("builds a part's mesh once per distinct file content", async () => {
    await initKernel();
    __clearComponentCacheForTesting();

    const first = await loadPartMesh(partFile(10), "A.mabucad");
    const again = await loadPartMesh(partFile(10), "A-copy.mabucad");
    expect(again.mesh).toBe(first.mesh);
    expect(again.contentHash).toBe(first.contentHash);
    expect(__componentCacheSizeForTesting()).toBe(1);

    const other = await loadPartMesh(partFile(20), "B.mabucad");
    expect(other.mesh).not.toBe(first.mesh);
    expect(__componentCacheSizeForTesting()).toBe(2);
  }, 30_000);

  it("never replaces the active document's confirmed shape", async () => {
    await initKernel();
    __clearRebuildCacheForTesting();
    __clearComponentCacheForTesting();

    await rebuildDocument([extrude("f0", "s1", 3)], { s1: squareSketch("s1", 7) });
    const confirmed = getCurrentShape();
    expect(confirmed).not.toBeNull();

    await loadPartMesh(partFile(30), "Big.mabucad");
    expect(getCurrentShape()).toBe(confirmed);
  }, 30_000);

  it("rejects a file that isn't a Part, and a Part with no solid", async () => {
    await initKernel();
    __clearComponentCacheForTesting();

    const drawing = JSON.parse(partFile(10)) as Record<string, Record<string, unknown>>;
    drawing.document!.kind = "drawing";
    await expect(loadPartMesh(JSON.stringify(drawing), "Sheet.mabucad")).rejects.toThrow(/not a saved Part/);

    const empty = JSON.parse(partFile(10)) as Record<string, Record<string, unknown>>;
    empty.document!.features = [];
    empty.document!.rollbackIndex = 0;
    await expect(loadPartMesh(JSON.stringify(empty), "Empty.mabucad")).rejects.toThrow(/no solid geometry/);
  }, 30_000);
});
