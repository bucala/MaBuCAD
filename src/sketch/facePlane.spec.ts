import { describe, expect, it } from "vitest";
import { measureVolume } from "replicad";
import { Vector3 } from "three";

import { __clearRebuildCacheForTesting, getCurrentShape, rebuildDocument, type MeshData } from "@/kernel/rebuild";
import { initKernel } from "@/kernel/occ";
import type { Feature } from "@/types/document";

import { facePlaneFromMesh, facePlaneSpec, findMatchingPlane } from "./facePlane";
import type { Sketch } from "./types";
import { frameToWorld, planeFrame, worldToFrame } from "./planeBasis";

function rectSketch(id: string, planeId: string, x0: number, y0: number, x1: number, y1: number): Sketch {
  const corners: [number, number][] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const ids = corners.map((_, i) => `${id}-p${i}`);
  return {
    id,
    planeId,
    points: corners.map(([x, y], i) => ({ id: ids[i]!, x, y })),
    entities: ids.map((pid, i) => ({
      id: `${id}-l${i}`,
      kind: "line" as const,
      start: pid,
      end: ids[(i + 1) % ids.length]!,
      construction: false,
    })),
    constraints: [],
    dimensions: [],
  };
}

function feature(id: string, kind: Feature["kind"], parents: string[], parameters: Feature["parameters"]): Feature {
  return { id, kind, name: id, suppressed: false, isDefault: false, parents, parameters };
}

const BOX_SKETCHES = { s: rectSketch("s", "plane-front", 0, 0, 10, 10) };
const BOX: Feature[] = [feature("e", "extrude", ["s"], { depth: 20, endCondition: "blind", operation: "join" })];

async function boxMesh(): Promise<MeshData> {
  await initKernel();
  __clearRebuildCacheForTesting();
  const result = await rebuildDocument(BOX, BOX_SKETCHES);
  if (!result.mesh) throw new Error("no mesh");
  return result.mesh;
}

function faceWithNormal(mesh: MeshData, normal: [number, number, number]) {
  const wanted = new Vector3(...normal);
  for (const group of mesh.faceGroups) {
    const plane = facePlaneFromMesh(mesh, group.id);
    if (plane && plane.normal.dot(wanted) > 0.999) return plane;
  }
  throw new Error(`no face with normal ${normal}`);
}

describe("planeFrame", () => {
  it("round-trips points through an offset, flipped frame", () => {
    const features = [feature("rp", "reference-plane", ["plane-right"], { distance: 7, flipped: true })];
    const frame = planeFrame("rp", features);
    expect(frame.origin.x).toBeCloseTo(7);
    expect(frame.origin.length()).toBeCloseTo(7);
    expect(frame.normal.x).toBeCloseTo(-1);
    const world = frameToWorld(frame, 3, 4);
    const back = worldToFrame(frame, world);
    expect(back.x).toBeCloseTo(3);
    expect(back.y).toBeCloseTo(4);
  });

  it("survives a reference-plane cycle without recursing forever", () => {
    const features = [
      feature("a", "reference-plane", ["b"], { distance: 1 }),
      feature("b", "reference-plane", ["a"], { distance: 1 }),
    ];
    expect(() => planeFrame("a", features)).not.toThrow();
  });

  it("falls back to the parent plane when a stored frame is degenerate", () => {
    const features = [
      feature("rp", "reference-plane", ["plane-top"], {
        distance: 2,
        frame: { origin: [0, 0, 0], xDir: [0, 0, 1], normal: [0, 0, 1] },
      }),
    ];
    const frame = planeFrame("rp", features);
    expect(frame.origin.y).toBeCloseTo(2);
  });
});

describe("planes on model faces", () => {
  it("makes the top face a parametric Front offset and the bottom face a flipped one", async () => {
    const mesh = await boxMesh();

    const top = facePlaneSpec(faceWithNormal(mesh, [0, 0, 1]));
    expect(top).toEqual({ parents: ["plane-front"], parameters: { distance: 20, flipped: false, fromFace: true } });

    const bottom = facePlaneSpec(faceWithNormal(mesh, [0, 0, -1]));
    expect(bottom).toEqual({ parents: ["plane-front"], parameters: { distance: 0, flipped: true, fromFace: true } });

    const side = facePlaneSpec(faceWithNormal(mesh, [0, 1, 0]));
    expect(side.parents).toEqual(["plane-top"]);
    expect(side.parameters.distance).toBeCloseTo(10);
  }, 30_000);

  it("rejects a curved face", async () => {
    await initKernel();
    __clearRebuildCacheForTesting();
    const circle: Sketch = {
      id: "c",
      planeId: "plane-front",
      points: [{ id: "c0", x: 0, y: 0 }],
      entities: [{ id: "ce", kind: "circle", center: "c0", radius: 5, construction: false }],
      constraints: [],
      dimensions: [],
    };
    const result = await rebuildDocument(
      [feature("e", "extrude", ["c"], { depth: 10, endCondition: "blind", operation: "join" })],
      { c: circle },
    );
    const mesh = result.mesh!;
    const planar = mesh.faceGroups.filter((group) => facePlaneFromMesh(mesh, group.id));
    expect(mesh.faceGroups.length).toBeGreaterThan(planar.length);
    expect(planar.length).toBe(2);
  }, 30_000);

  it("a boss sketched on the bottom face grows outward, a blind cut on the top face cuts inward", async () => {
    const mesh = await boxMesh();
    const bottom = facePlaneSpec(faceWithNormal(mesh, [0, 0, -1]));
    const top = facePlaneSpec(faceWithNormal(mesh, [0, 0, 1]));

    __clearRebuildCacheForTesting();
    const result = await rebuildDocument(
      [
        ...BOX,
        feature("pb", "reference-plane", bottom.parents, bottom.parameters),
        feature("boss", "extrude", ["sb"], { depth: 5, endCondition: "blind", operation: "join" }),
        feature("pt", "reference-plane", top.parents, top.parameters),
        feature("cut", "cut-extrude", ["st"], { depth: 4, endCondition: "blind", operation: "cut", reversed: true }),
      ],
      {
        ...BOX_SKETCHES,
        // Flipped plane mirrors local X: world X 2..8 is local X -8..-2.
        sb: rectSketch("sb", "pb", -8, 2, -2, 8),
        st: rectSketch("st", "pt", 4, 4, 6, 6),
      },
    );
    expect(result.errors).toEqual({});
    const shape = getCurrentShape()!;
    const [min, max] = shape.boundingBox.bounds;
    expect(min[2]).toBeCloseTo(-5, 4);
    expect(max[2]).toBeCloseTo(20, 4);
    // 10·10·20 + 6·6·5 − 2·2·4
    expect(measureVolume(shape as never)).toBeCloseTo(2000 + 180 - 16, 2);
  }, 30_000);

  it("reuses an existing plane lying on the same face", () => {
    const spec = { parents: ["plane-front"], parameters: { distance: 20, flipped: false, fromFace: true } };
    const features = [
      feature("other", "reference-plane", ["plane-front"], { distance: 20, flipped: true }),
      feature("same", "reference-plane", ["plane-front"], { distance: 20 }),
    ];
    expect(findMatchingPlane(features, spec)).toBe("same");
    expect(findMatchingPlane([{ ...features[1]!, suppressed: true }], spec)).toBeNull();
  });
});
