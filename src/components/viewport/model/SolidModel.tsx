import { useEffect, useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, Color, Euler, LineSegments, Quaternion } from "three";

import { placeHoleAtPick } from "@/commands/commandRegistry";
import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import { buildFaceColorAttribute, faceAngleToAxis } from "@/kernel/faceColoring";
import { computeMassProperties } from "@/kernel/measure";
import type { MeshData } from "@/kernel/rebuild";
import { selectBuiltFeatures, useDocumentStore } from "@/state/documentStore";
import { GEOMETRY_FEATURE_KINDS, useGeometryStore } from "@/state/geometryStore";
import { useInspectStore } from "@/state/inspectStore";
import { sensorTriggered } from "@/state/sensors";
import { useSettingsStore } from "@/state/settingsStore";
import { selectIsSketchMode, useSketchStore } from "@/state/sketchStore";
import { useViewportStore } from "@/state/viewportStore";

import { useClickGuard } from "../controls/useClickGuard";
import { HoleThreadOverlay } from "./HoleThreadOverlay";

/** How close (world units) a new pick needs to land to an already-picked point to toggle it
 * off instead of adding a duplicate — clicking the same edge again deselects it. */
const EDGE_PICK_TOGGLE_DISTANCE = 2;
/** Highlight colour for the "face"/"edge" selection filters — the same cyan for both, since
 * they're the same "this is what the current selection-priority filter picked" concept just
 * applied to a different entity kind, distinct from the amber edge-pick highlight and the
 * red hole-placement marker so neither of those two ever reads as the same thing. */
const FACE_HIGHLIGHT_COLOR = "#3fd0ff";
/** Highlight colour for a picked Fillet/Chamfer edge's own contour — distinct from the
 * amber "still pickable" edge colour, the cyan face highlight, and the hole-placement
 * marker, so all four read as different things at a glance. */
const PICKED_EDGE_HIGHLIGHT_COLOR = "#ff2f92";
/** Highlight colour for Inspect > Measure's picked face(s)/edge(s) — distinct from every
 * other highlight colour above so a measure pick never reads as one of those unrelated
 * modes. Reused as-is for Inspect > Section Properties' single-face pick, since the two
 * tools are never open at the same time. */
const MEASURE_HIGHLIGHT_COLOR = "#a970ff";
/** Draft Analysis' pass/fail colours — green for a face whose angle to the pull axis
 * clears the limit, red for one that doesn't (a near-vertical wall the mould can't release
 * cleanly). The grey is the body's own base colour while the overlay is active, standing
 * in for whichever faces neither colour applies to (there are none — every face gets a
 * verdict — but `buildFaceColorAttribute` still needs a fallback to fill with). */
const DRAFT_SAFE_COLOR: [number, number, number] = [0.3, 0.72, 0.35];
const DRAFT_UNSAFE_COLOR: [number, number, number] = [0.85, 0.28, 0.28];
const DRAFT_FALLBACK_COLOR: [number, number, number] = [0.55, 0.55, 0.6];
/** Appearance's fallback for any face without its own colour override — the same grey the
 * plain (non-overlay) material already uses, so an unpainted body looks identical to normal. */
const APPEARANCE_FALLBACK_COLOR: [number, number, number] = [0.72, 0.77, 0.82];

function hexToRgb(hex: string): [number, number, number] {
  const color = new Color(hex);
  return [color.r, color.g, color.b];
}

/** Nearest `EdgeGroup.id` to a point already in the mesh's own un-rotated local space —
 * shared by the Fillet/Chamfer picked-edge highlight (`pickedEdgeHighlightGeometry`) and
 * Inspect > Measure's edge pick, both of which only have a raycaster hit point to start
 * from, not a kernel edge id. */
function nearestEdgeGroupId(mesh: MeshData, point: readonly [number, number, number]): number | null {
  let bestId: number | null = null;
  let bestDistanceSq = Infinity;
  for (const group of mesh.edgeGroups) {
    const startFloat = group.start * 3;
    const endFloat = startFloat + group.count * 3;
    for (let i = startFloat; i < endFloat; i += 3) {
      const dx = mesh.edges[i] - point[0];
      const dy = mesh.edges[i + 1] - point[1];
      const dz = mesh.edges[i + 2] - point[2];
      const distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestId = group.id;
      }
    }
  }
  return bestId;
}

/**
 * Renders the rebuilt solid: a shaded surface plus the B-Rep edges on top.
 *
 * Drawing real edges rather than a wireframe of the triangulation is what makes the model
 * read as CAD — only the boundaries the kernel considers edges are shown, so a curved face
 * looks smooth instead of faceted.
 */
export function SolidModel() {
  const committedMesh = useGeometryStore((state) => state.mesh);
  const previewMesh = useGeometryStore((state) => state.previewMesh);
  const rebuildPreview = useGeometryStore((state) => state.rebuildPreview);
  const clearPreview = useGeometryStore((state) => state.clearPreview);
  const isDark = useIsDarkTheme();
  const invalidate = useThree((state) => state.invalidate);

  const isSketchMode = useSketchStore(selectIsSketchMode);
  const selectFeature = useDocumentStore((state) => state.selectFeature);
  const openContextMenu = useDocumentStore((state) => state.openContextMenu);
  const updateParameters = useDocumentStore((state) => state.updateParameters);
  const displayMode = useViewportStore((state) => state.displayMode);
  const hiddenFeatureIds = useViewportStore((state) => state.hiddenFeatureIds);
  const modelColorOverride = useSettingsStore((state) => state.modelColor);
  const modelEdgeColorOverride = useSettingsStore((state) => state.modelEdgeColor);
  const cadDocument = useDocumentStore((state) => state.document);
  const sketches = useSketchStore((state) => state.sketches);
  const features = cadDocument.features;
  const rollbackIndex = cadDocument.rollbackIndex;
  const edgePickModeFeatureId = useViewportStore((state) => state.edgePickModeFeatureId);
  const pickingFeature = features.find((feature) => feature.id === edgePickModeFeatureId);
  const holePlacementActive = useViewportStore((state) => state.holePlacementActive);
  const setHolePlacementActive = useViewportStore((state) => state.setHolePlacementActive);
  const selectionFilterMode = useViewportStore((state) => state.selectionFilterMode);
  const selectedFaceId = useViewportStore((state) => state.selectedFaceId);
  const setSelectedFaceId = useViewportStore((state) => state.setSelectedFaceId);
  const selectedEdgeGroupId = useViewportStore((state) => state.selectedEdgeGroupId);
  const setSelectedEdgeGroupId = useViewportStore((state) => state.setSelectedEdgeGroupId);
  const inspectTool = useInspectStore((state) => state.activeTool);
  const measurePicks = useInspectStore((state) => state.measurePicks);
  const pickForMeasure = useInspectStore((state) => state.pickForMeasure);
  const sectionFacePick = useInspectStore((state) => state.sectionFacePick);
  const pickForSection = useInspectStore((state) => state.pickForSection);
  const draftAxis = useInspectStore((state) => state.draftAxis);
  const draftLimitDegrees = useInspectStore((state) => state.draftLimitDegrees);
  const faceColors = useInspectStore((state) => state.faceColors);
  const paintFace = useInspectStore((state) => state.paintFace);
  const resetMeshDerivedState = useInspectStore((state) => state.resetMeshDerivedState);
  const isPick = useClickGuard();

  // A face/edge id is only meaningful for the mesh it came from — `kernel/rebuild.ts`
  // renumbers both fresh on every rebuild, so a highlight (or Inspect pick/paint) left
  // over from a stale mesh could easily land on the wrong entity, or none, once the
  // geometry actually changes.
  useEffect(() => {
    setSelectedFaceId(null);
    setSelectedEdgeGroupId(null);
    resetMeshDerivedState();
  }, [committedMesh, setSelectedFaceId, setSelectedEdgeGroupId, resetMeshDerivedState]);

  /**
   * Inspect > Sensors' actual "monitor and alert" behaviour — evaluated here, not in
   * `InspectPanel.tsx`, specifically so it keeps running (and can still pop a toast) while
   * the Sensors tool isn't the one open: `SolidModel.tsx` is mounted for the whole time
   * there's a body to show, `InspectPanel.tsx` only while its own tab is active. Runs once
   * per rebuild (`committedMesh` changing is what that means), and only calls into
   * `setSensorStatus` — which bypasses `documentStore`'s undo history — on an actual status
   * change, both to avoid a toast firing again for a sensor that's already alerting and to
   * avoid writing to the store every single rebuild for no reason.
   */
  useEffect(() => {
    const documentState = useDocumentStore.getState();
    const sensors = documentState.document.sensors ?? [];
    if (sensors.length === 0) return;

    const properties = computeMassProperties();
    for (const sensor of sensors) {
      const value = properties ? (sensor.property === "volume" ? properties.volume : properties.area) : undefined;
      const status = value === undefined ? null : sensorTriggered(sensor.operator, value, sensor.threshold) ? "alert" : "ok";
      if (status === sensor.lastStatus) continue;

      documentState.setSensorStatus(sensor.id, status);
      if (status === "alert") {
        useGeometryStore.getState().showToast(`Sensor "${sensor.name}" tripped`, 4000);
      }
    }
    // Deliberately keyed on the mesh, not the sensor list — adding/editing a sensor is
    // its own action and shows its own current value in the panel immediately; this only
    // needs to re-run when the numbers a sensor watches could actually have changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedMesh]);

  // Escape backs out of Hole Wizard placement the same way it backs out of any other
  // modal viewport interaction, since there is (yet) no feature selected to drive this
  // the way `PropertyManager.tsx`'s effect drives `edgePickModeFeatureId`'s cancellation.
  useEffect(() => {
    if (!holePlacementActive) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHolePlacementActive(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [holePlacementActive, setHolePlacementActive]);

  // While picking, show the body as it was *before* the picking feature — see
  // `geometryStore.ts`'s own note on `previewMesh` for why an already-applied Fillet/Chamfer
  // can't be picked against its own result. Falls back to the normal committed mesh until the
  // preview's own (async) rebuild finishes, so the viewport doesn't flash empty.
  useEffect(() => {
    if (!edgePickModeFeatureId) {
      clearPreview();
      return;
    }
    const built = cadDocument.features.slice(0, cadDocument.rollbackIndex);
    void rebuildPreview(built, sketches, edgePickModeFeatureId);
  }, [edgePickModeFeatureId, cadDocument, sketches, rebuildPreview, clearPreview]);

  const mesh = pickingFeature ? (previewMesh ?? committedMesh) : committedMesh;

  /**
   * There is no per-feature partial geometry — every modelling feature fuses into one
   * mesh — so "hide this feature" for any of them is the closest honest approximation of
   * hiding *the body*: hiding any one that actually contributed geometry hides the whole
   * thing, same as `hiddenFeatureIds`'s own doc comment in `viewportStore.ts` explains.
   */
  const isBodyHidden = features
    .slice(0, rollbackIndex)
    .some(
      (feature) =>
        !feature.suppressed && GEOMETRY_FEATURE_KINDS.has(feature.kind) && hiddenFeatureIds.includes(feature.id),
    );

  /**
   * The renderer combines every modelling feature into one mesh, so there is no per-face
   * feature id to pick — right-clicking the body targets the most recent feature that
   * actually contributed geometry, which is the one a user reaching for "Suppress" or
   * "Delete" on the model almost always means.
   *
   * Reads the feature list via `getState()` rather than subscribing to `selectBuiltFeatures`
   * with `useDocumentStore`: that selector returns a new array on every call, and only the
   * value at the moment of the click is needed, not a live re-render on every document
   * change — subscribing to it would resubscribe (and re-render) on literally every store
   * update, since Zustand sees a new array reference each time.
   */
  const handleContextMenu = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    event.nativeEvent.preventDefault();

    const builtFeatures = selectBuiltFeatures(useDocumentStore.getState());
    const lastModellingFeature = [...builtFeatures]
      .reverse()
      .find((feature) => !feature.suppressed && GEOMETRY_FEATURE_KINDS.has(feature.kind));
    if (lastModellingFeature) {
      selectFeature(lastModellingFeature.id);
    }
    openContextMenu(event.nativeEvent.clientX, event.nativeEvent.clientY);
  };

  /**
   * Toggles the clicked point into or out of the picking feature's `edgePoints` — clicking
   * an already-picked edge again (within `EDGE_PICK_TOGGLE_DISTANCE`) deselects it, matching
   * how selection toggles everywhere else in this app.
   *
   * `event.point` comes out in world (display) space, resolved through every parent
   * transform including this group's own `mesh.rotation` — but the replicad `Solid` the
   * kernel actually runs `EdgeFinder.withinDistance` against is *not* rotated; `mesh.rotation`
   * only exists to orient the triangulated mesh for display (see `kernel/rebuild.ts`'s own
   * note on this). Stored points need to be in that same un-rotated space, so the click point
   * is rotated back by the inverse of `mesh.rotation` before saving — and the marker below
   * renders that same stored point straight as a local position inside this rotated group,
   * which re-applies the identical rotation forward, landing back exactly on the edge.
   */
  const handleEdgeClick = (event: ThreeEvent<MouseEvent>) => {
    if (!pickingFeature || !mesh || !isPick(event)) return;
    event.stopPropagation();

    const inverseRotation = new Quaternion().setFromEuler(new Euler(...mesh.rotation)).invert();
    const local = event.point.clone().applyQuaternion(inverseRotation);
    const point: [number, number, number] = [local.x, local.y, local.z];

    const existing = pickingFeature.parameters.edgePoints ?? [];
    const nearbyIndex = existing.findIndex(
      ([x, y, z]) => Math.hypot(x - point[0], y - point[1], z - point[2]) < EDGE_PICK_TOGGLE_DISTANCE,
    );
    const next = nearbyIndex >= 0 ? existing.filter((_, index) => index !== nearbyIndex) : [...existing, point];
    // The very first real pick clears `edgesPending` for good — see its own doc comment.
    // Toggling that first edge back off afterward correctly falls through to "every edge"
    // like any other Fillet/Chamfer with an empty pick list, not back to "nothing yet".
    const clearsPending = nearbyIndex < 0 && pickingFeature.parameters.edgesPending;
    updateParameters(pickingFeature.id, { edgePoints: next, ...(clearsPending ? { edgesPending: false } : {}) });
  };

  /**
   * Hole Wizard's "click a face to place a hole" flow — see `placeHoleAtPick`'s own doc
   * comment in `commandRegistry.ts` for why a face's raycaster-reported normal is enough
   * without any real per-face identity from the kernel. `event.face.normal` comes out in
   * the mesh's own local space; this group's only transform is `mesh.rotation`, so
   * rotating the normal by that same Euler is what turns it into a world-space normal —
   * the forward version of the inverse rotation `handleEdgeClick` above already applies
   * to points for the same reason.
   */
  const handleHolePlacementClick = (event: ThreeEvent<MouseEvent>) => {
    if (!holePlacementActive || !mesh || !event.face || !isPick(event)) return;
    event.stopPropagation();

    const rotationEuler = new Euler(...mesh.rotation);
    const worldNormal = event.face.normal.clone().applyEuler(rotationEuler).normalize();
    placeHoleAtPick(event.point.clone(), worldNormal);
  };

  /**
   * "Face" selection-priority filter: resolves exactly which kernel Face a click landed on
   * and highlights just that face, using the per-face triangle ranges replicad's own
   * `Shape.mesh()` already reports (`MeshData.faceGroups` — see its doc comment in
   * `kernel/rebuild.ts`). `event.faceIndex` is three.js's own concept — the index of the
   * *triangle* the raycaster hit within this geometry's index buffer — unrelated to the
   * kernel's Face id until mapped through `faceGroups` here: `event.faceIndex * 3` is that
   * triangle's position in `mesh.indices`, and whichever group's `[start, start+count)`
   * range contains it is the Face that was actually clicked.
   */
  const handleFaceSelectClick = (event: ThreeEvent<MouseEvent>) => {
    if (selectionFilterMode !== "face" || !mesh || event.faceIndex == null || !isPick(event)) return;
    event.stopPropagation();

    const triangleStart = event.faceIndex * 3;
    const group = mesh.faceGroups.find(
      (candidate) => triangleStart >= candidate.start && triangleStart < candidate.start + candidate.count,
    );
    setSelectedFaceId(group?.id ?? null);
  };

  /**
   * "Edge" selection-priority's own click — same point-based resolution as
   * `handleMeasureEdgeClick` below (there is no kernel edge id on a `ThreeEvent` from the
   * shaded mesh, only the raycaster's hit point, so the nearest `EdgeGroup` wins), feeding
   * `selectedEdgeGroupId`'s single highlight instead of Measure's accumulating pick list.
   */
  const handleEdgeSelectClick = (event: ThreeEvent<MouseEvent>) => {
    if (selectionFilterMode !== "edge" || !mesh || !isPick(event)) return;
    event.stopPropagation();

    const inverseRotation = new Quaternion().setFromEuler(new Euler(...mesh.rotation)).invert();
    const local = event.point.clone().applyQuaternion(inverseRotation);
    setSelectedEdgeGroupId(nearestEdgeGroupId(mesh, [local.x, local.y, local.z]));
  };

  /**
   * Inspect > Measure's face pick — the same `event.faceIndex` -> `FaceGroup` resolution
   * as `handleFaceSelectClick` above, but feeding `inspectStore`'s accumulating two-entity
   * pick list instead of the "face" selection filter's single highlight.
   */
  const handleMeasureFaceClick = (event: ThreeEvent<MouseEvent>) => {
    if (inspectTool !== "measure" || !mesh || event.faceIndex == null || !isPick(event)) return;
    event.stopPropagation();

    const triangleStart = event.faceIndex * 3;
    const group = mesh.faceGroups.find(
      (candidate) => triangleStart >= candidate.start && triangleStart < candidate.start + candidate.count,
    );
    if (group) pickForMeasure({ kind: "face", id: group.id });
  };

  /**
   * Inspect > Measure's edge pick. There is no kernel edge id in a `ThreeEvent` the way
   * `handleMeasureFaceClick` gets a triangle index — only the raycaster's hit point — so
   * this resolves it the same way `handleEdgeClick`'s Fillet/Chamfer picking already does:
   * rotate the world-space hit back into the mesh's own un-rotated space, then find the
   * nearest `EdgeGroup`.
   */
  const handleMeasureEdgeClick = (event: ThreeEvent<MouseEvent>) => {
    if (inspectTool !== "measure" || !mesh || !isPick(event)) return;
    event.stopPropagation();

    const inverseRotation = new Quaternion().setFromEuler(new Euler(...mesh.rotation)).invert();
    const local = event.point.clone().applyQuaternion(inverseRotation);
    const groupId = nearestEdgeGroupId(mesh, [local.x, local.y, local.z]);
    if (groupId !== null) pickForMeasure({ kind: "edge", id: groupId });
  };

  /** Inspect > Section Properties' face pick — single-entity version of
   * `handleMeasureFaceClick`, replacing whatever was picked before rather than accumulating. */
  const handleSectionFaceClick = (event: ThreeEvent<MouseEvent>) => {
    if (inspectTool !== "section" || !mesh || event.faceIndex == null || !isPick(event)) return;
    event.stopPropagation();

    const triangleStart = event.faceIndex * 3;
    const group = mesh.faceGroups.find(
      (candidate) => triangleStart >= candidate.start && triangleStart < candidate.start + candidate.count,
    );
    if (group) pickForSection(group.id);
  };

  /** Inspect > Appearance's face pick — applies the panel's currently selected paint
   * colour to whatever face was clicked (`inspectStore.paintFace`), same resolution as
   * every other face pick above. */
  const handleAppearanceFaceClick = (event: ThreeEvent<MouseEvent>) => {
    if (inspectTool !== "appearance" || !mesh || event.faceIndex == null || !isPick(event)) return;
    event.stopPropagation();

    const triangleStart = event.faceIndex * 3;
    const group = mesh.faceGroups.find(
      (candidate) => triangleStart >= candidate.start && triangleStart < candidate.start + candidate.count,
    );
    if (group) paintFace(group.id);
  };

  const geometry = useMemo(() => {
    if (!mesh) return null;

    const buffer = new BufferGeometry();
    buffer.setAttribute("position", new BufferAttribute(mesh.positions, 3));
    buffer.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
    buffer.setIndex(new BufferAttribute(mesh.indices, 1));
    buffer.computeBoundingSphere();
    return buffer;
  }, [mesh]);

  /**
   * The highlighted face's own overlay geometry — same `position`/`normal` buffers as the
   * main mesh (so it sits exactly flush with it, no seams), but an index buffer sliced down
   * to just that one face's triangles (`FaceGroup.start`/`count`, already in index-buffer
   * units). Drawn as a second, slightly-larger-radius-free mesh on top rather than
   * recolouring vertices in the base geometry, the same "overlay, don't mutate" convention
   * `pickingFeature`'s edge markers below already use.
   */
  const faceHighlightGeometry = useMemo(() => {
    if (!mesh || selectedFaceId === null) return null;
    const group = mesh.faceGroups.find((candidate) => candidate.id === selectedFaceId);
    if (!group) return null;

    const buffer = new BufferGeometry();
    buffer.setAttribute("position", new BufferAttribute(mesh.positions, 3));
    buffer.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
    buffer.setIndex(new BufferAttribute(mesh.indices.subarray(group.start, group.start + group.count), 1));
    buffer.computeBoundingSphere();
    return buffer;
  }, [mesh, selectedFaceId]);

  /** The single edge highlighted under "edge" selection priority — same "own overlay
   * geometry over the matched `EdgeGroup`'s own vertex range" shape `pickedEdgeHighlightGeometry`
   * below uses for Fillet/Chamfer's own (multi-edge) picks. */
  const edgeSelectHighlightGeometry = useMemo(() => {
    if (!mesh || selectedEdgeGroupId === null) return null;
    const group = mesh.edgeGroups.find((candidate) => candidate.id === selectedEdgeGroupId);
    if (!group) return null;

    const buffer = new BufferGeometry();
    const start = group.start * 3;
    const end = start + group.count * 3;
    buffer.setAttribute("position", new BufferAttribute(mesh.edges.subarray(start, end), 3));
    buffer.computeBoundingSphere();
    return buffer;
  }, [mesh, selectedEdgeGroupId]);

  const edgeGeometry = useMemo(() => {
    if (!mesh || mesh.edges.length === 0) return null;

    const buffer = new BufferGeometry();
    buffer.setAttribute("position", new BufferAttribute(mesh.edges, 3));
    buffer.computeBoundingSphere();
    return buffer;
  }, [mesh]);

  /**
   * The actual curve of every picked Fillet/Chamfer edge, highlighted as a contour rather
   * than a marker dropped at the click point — each `edgePoints` entry (see that field's
   * own doc comment in `types/document.ts`) is resolved to the nearest `EdgeGroup` (the
   * kernel's own per-edge slice of `mesh.edges`, straight from replicad's `meshEdges()`),
   * and every vertex belonging to a matched group is drawn. A point can land near more than
   * one group's vertices only right at a shared corner, in which case the nearest wins —
   * fine in practice since a corner point was picked by clicking *somewhere along* one of
   * the edges meeting there, not exactly on the corner itself.
   */
  const pickedEdgeHighlightGeometry = useMemo(() => {
    const edgePoints = pickingFeature?.parameters.edgePoints;
    if (!mesh || !edgePoints?.length || mesh.edgeGroups.length === 0) return null;

    const matchedGroupIds = new Set<number>();
    for (const point of edgePoints) {
      const bestGroupId = nearestEdgeGroupId(mesh, point);
      if (bestGroupId !== null) matchedGroupIds.add(bestGroupId);
    }
    if (matchedGroupIds.size === 0) return null;

    const segments: number[] = [];
    for (const group of mesh.edgeGroups) {
      if (!matchedGroupIds.has(group.id)) continue;
      const startFloat = group.start * 3;
      const endFloat = startFloat + group.count * 3;
      for (let i = startFloat; i < endFloat; i += 1) segments.push(mesh.edges[i]);
    }

    const buffer = new BufferGeometry();
    buffer.setAttribute("position", new BufferAttribute(Float32Array.from(segments), 3));
    buffer.computeBoundingSphere();
    return buffer;
  }, [mesh, pickingFeature]);

  /**
   * Inspect > Measure's picked-face overlay — same "sliced index buffer over the same
   * position/normal buffers" technique as `faceHighlightGeometry`, but built from however
   * many face picks `measurePicks` currently holds (0-2) rather than a single selection.
   */
  const measureFaceHighlightGeometry = useMemo(() => {
    if (!mesh || inspectTool !== "measure") return null;
    const faceIds = new Set(measurePicks.filter((pick) => pick.kind === "face").map((pick) => pick.id));
    if (faceIds.size === 0) return null;

    const parts = mesh.faceGroups
      .filter((group) => faceIds.has(group.id))
      .map((group) => mesh.indices.subarray(group.start, group.start + group.count));
    const combined = new Uint32Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      combined.set(part, offset);
      offset += part.length;
    }

    const buffer = new BufferGeometry();
    buffer.setAttribute("position", new BufferAttribute(mesh.positions, 3));
    buffer.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
    buffer.setIndex(new BufferAttribute(combined, 1));
    buffer.computeBoundingSphere();
    return buffer;
  }, [mesh, inspectTool, measurePicks]);

  /** Inspect > Measure's picked-edge overlay — same shape as `pickedEdgeHighlightGeometry`,
   * but keyed directly off `measurePicks`' own edge ids rather than resolving raw points. */
  const measureEdgeHighlightGeometry = useMemo(() => {
    if (!mesh || inspectTool !== "measure" || mesh.edgeGroups.length === 0) return null;
    const edgeIds = new Set(measurePicks.filter((pick) => pick.kind === "edge").map((pick) => pick.id));
    if (edgeIds.size === 0) return null;

    const segments: number[] = [];
    for (const group of mesh.edgeGroups) {
      if (!edgeIds.has(group.id)) continue;
      const startFloat = group.start * 3;
      const endFloat = startFloat + group.count * 3;
      for (let i = startFloat; i < endFloat; i += 1) segments.push(mesh.edges[i]);
    }
    if (segments.length === 0) return null;

    const buffer = new BufferGeometry();
    buffer.setAttribute("position", new BufferAttribute(Float32Array.from(segments), 3));
    buffer.computeBoundingSphere();
    return buffer;
  }, [mesh, inspectTool, measurePicks]);

  /** Inspect > Section Properties' picked-face overlay — same technique as
   * `measureFaceHighlightGeometry`, for the tool's single pick instead of up to two. */
  const sectionFaceHighlightGeometry = useMemo(() => {
    if (!mesh || inspectTool !== "section" || sectionFacePick === null) return null;
    const group = mesh.faceGroups.find((candidate) => candidate.id === sectionFacePick);
    if (!group) return null;

    const buffer = new BufferGeometry();
    buffer.setAttribute("position", new BufferAttribute(mesh.positions, 3));
    buffer.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
    buffer.setIndex(new BufferAttribute(mesh.indices.subarray(group.start, group.start + group.count), 1));
    buffer.computeBoundingSphere();
    return buffer;
  }, [mesh, inspectTool, sectionFacePick]);

  /**
   * A per-vertex colour buffer for Draft Analysis (colour every face green/red by its
   * angle to the pull axis) or Appearance (colour every painted face its assigned colour)
   * — `null` the rest of the time, which is what tells the material below to fall back to
   * its ordinary flat body colour instead of vertex colours.
   */
  const colorAttribute = useMemo(() => {
    if (!mesh) return null;

    if (inspectTool === "draft-analysis") {
      return buildFaceColorAttribute(
        mesh,
        (faceId) => {
          const angleToAxis = faceAngleToAxis(mesh, faceId, draftAxis);
          if (angleToAxis === null) return null;
          // Conventional "draft angle" is measured from the plane perpendicular to the
          // pull axis, i.e. 90° minus the angle to the axis itself: a vertical wall
          // running parallel to the pull direction (angle-to-axis 90°) has 0° draft — the
          // worst case for release — while a horizontal cap (angle-to-axis 0°/180°) has
          // the maximum 90°, and is never undercut regardless of the limit.
          const draftAngle = Math.abs(90 - angleToAxis);
          return draftAngle >= draftLimitDegrees ? DRAFT_SAFE_COLOR : DRAFT_UNSAFE_COLOR;
        },
        DRAFT_FALLBACK_COLOR,
      );
    }

    if (inspectTool === "appearance" && Object.keys(faceColors).length > 0) {
      return buildFaceColorAttribute(
        mesh,
        (faceId) => {
          const hex = faceColors[faceId];
          return hex ? hexToRgb(hex) : null;
        },
        APPEARANCE_FALLBACK_COLOR,
      );
    }

    return null;
  }, [mesh, inspectTool, draftAxis, draftLimitDegrees, faceColors]);

  // Vertex colours live on the shared `geometry` object (so the overlay meshes above don't
  // need their own copy) but aren't part of the `useMemo` that builds it, since they change
  // on a different cadence (an axis/threshold tweak, a paint stroke) than the geometry
  // itself does (a rebuild) — attaching/detaching the attribute imperatively here is what
  // keeps `geometry` from having to be rebuilt from scratch for either kind of change.
  useEffect(() => {
    if (!geometry) return;
    if (colorAttribute) geometry.setAttribute("color", new BufferAttribute(colorAttribute, 3));
    else if (geometry.hasAttribute("color")) geometry.deleteAttribute("color");
    invalidate();
  }, [geometry, colorAttribute, invalidate]);

  // The canvas only renders on demand, so a freshly built mesh — or a display mode that
  // swaps which materials/overlays are in the tree without touching the geometry itself —
  // has to ask for a frame explicitly.
  useEffect(() => {
    invalidate();
  }, [
    geometry,
    edgeGeometry,
    faceHighlightGeometry,
    pickedEdgeHighlightGeometry,
    measureFaceHighlightGeometry,
    measureEdgeHighlightGeometry,
    sectionFaceHighlightGeometry,
    colorAttribute,
    displayMode,
    isBodyHidden,
    pickingFeature,
    modelColorOverride,
    modelEdgeColorOverride,
    invalidate,
  ]);

  // Geometry is owned by this component; release the GPU buffers when it is replaced.
  useEffect(() => {
    return () => {
      geometry?.dispose();
      edgeGeometry?.dispose();
      faceHighlightGeometry?.dispose();
      pickedEdgeHighlightGeometry?.dispose();
      measureFaceHighlightGeometry?.dispose();
      measureEdgeHighlightGeometry?.dispose();
      sectionFaceHighlightGeometry?.dispose();
    };
  }, [
    geometry,
    edgeGeometry,
    faceHighlightGeometry,
    pickedEdgeHighlightGeometry,
    measureFaceHighlightGeometry,
    measureEdgeHighlightGeometry,
    sectionFaceHighlightGeometry,
  ]);

  useEffect(() => {
    return () => {
      faceHighlightGeometry?.dispose();
    };
  }, [faceHighlightGeometry]);

  useEffect(() => {
    return () => {
      edgeSelectHighlightGeometry?.dispose();
    };
  }, [edgeSelectHighlightGeometry]);

  if (!mesh || !geometry || isBodyHidden) return null;

  // Wireframe drops the shaded material but keeps the mesh itself in the tree — an
  // invisible-but-present material rather than hiding the mesh (`visible={false}`) or
  // omitting it, either of which would also drop it from raycasting and take right-click
  // selection with it. Shaded (no edges) is the mirror case: keep the material, drop the
  // B-Rep edge overlay.
  const showShadedMaterial = displayMode !== "wireframe";
  const showEdges = displayMode !== "shaded";

  return (
    <group rotation={mesh.rotation}>
      <mesh
        geometry={geometry}
        castShadow={false}
        receiveShadow={false}
        onContextMenu={isSketchMode ? undefined : handleContextMenu}
        onClick={
          holePlacementActive
            ? handleHolePlacementClick
            : inspectTool === "measure"
              ? handleMeasureFaceClick
              : inspectTool === "section"
                ? handleSectionFaceClick
                : inspectTool === "appearance"
                  ? handleAppearanceFaceClick
                  : selectionFilterMode === "face"
                    ? handleFaceSelectClick
                    : selectionFilterMode === "edge"
                      ? handleEdgeSelectClick
                      : undefined
        }
      >
        {showShadedMaterial ? (
          <meshStandardMaterial
            // Vertex colours (Draft Analysis/Appearance) replace the flat body colour by
            // multiplying it in, so the base colour needs to be white while they're
            // active — anything else would tint every painted/analysed face.
            color={colorAttribute ? "#ffffff" : (modelColorOverride ?? (isDark ? "#b8c4d0" : "#c9d4e0"))}
            vertexColors={!!colorAttribute}
            metalness={0.12}
            roughness={0.55}
            flatShading={false}
          />
        ) : (
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        )}
      </mesh>

      <HoleThreadOverlay
        features={features}
        rollbackIndex={rollbackIndex}
        sketches={sketches}
        color={isDark ? "#8fb6e8" : "#3f6aab"}
      />

      {sectionFaceHighlightGeometry && (
        <mesh geometry={sectionFaceHighlightGeometry} raycast={() => null}>
          <meshBasicMaterial
            color={MEASURE_HIGHLIGHT_COLOR}
            transparent
            opacity={0.45}
            depthTest={true}
            polygonOffset
            polygonOffsetFactor={-1}
          />
        </mesh>
      )}

      {faceHighlightGeometry && (
        <mesh geometry={faceHighlightGeometry} raycast={() => null}>
          <meshBasicMaterial
            color={FACE_HIGHLIGHT_COLOR}
            transparent
            opacity={0.45}
            depthTest={true}
            polygonOffset
            polygonOffsetFactor={-1}
          />
        </mesh>
      )}

      {edgeSelectHighlightGeometry && (
        <lineSegments geometry={edgeSelectHighlightGeometry} raycast={() => null}>
          <lineBasicMaterial color={FACE_HIGHLIGHT_COLOR} depthTest={false} linewidth={2} />
        </lineSegments>
      )}

      {edgeGeometry && showEdges && (
        <lineSegments
          geometry={edgeGeometry}
          // `raycast={undefined}` is NOT "don't override" — r3f still sets `instance.raycast =
          // undefined` as an own property, which shadows `LineSegments.prototype.raycast` (the
          // real hit-testing implementation) on the prototype chain, silently breaking clicks.
          // Passing the prototype method explicitly keeps raycasting real while picking.
          raycast={pickingFeature || inspectTool === "measure" ? LineSegments.prototype.raycast : () => null}
          onClick={pickingFeature ? handleEdgeClick : inspectTool === "measure" ? handleMeasureEdgeClick : undefined}
        >
          <lineBasicMaterial
            color={pickingFeature ? "#f5c542" : (modelEdgeColorOverride ?? (isDark ? "#1b1f24" : "#2b3138"))}
          />
        </lineSegments>
      )}

      {pickedEdgeHighlightGeometry && (
        <lineSegments geometry={pickedEdgeHighlightGeometry} raycast={() => null}>
          <lineBasicMaterial color={PICKED_EDGE_HIGHLIGHT_COLOR} depthTest={false} linewidth={2} />
        </lineSegments>
      )}

      {measureFaceHighlightGeometry && (
        <mesh geometry={measureFaceHighlightGeometry} raycast={() => null}>
          <meshBasicMaterial
            color={MEASURE_HIGHLIGHT_COLOR}
            transparent
            opacity={0.45}
            depthTest={true}
            polygonOffset
            polygonOffsetFactor={-1}
          />
        </mesh>
      )}

      {measureEdgeHighlightGeometry && (
        <lineSegments geometry={measureEdgeHighlightGeometry} raycast={() => null}>
          <lineBasicMaterial color={MEASURE_HIGHLIGHT_COLOR} depthTest={false} linewidth={2} />
        </lineSegments>
      )}
    </group>
  );
}
