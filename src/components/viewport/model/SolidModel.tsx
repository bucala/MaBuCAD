import { useEffect, useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, Euler, LineSegments, Quaternion } from "three";

import { placeHoleAtPick } from "@/commands/commandRegistry";
import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import { selectBuiltFeatures, useDocumentStore } from "@/state/documentStore";
import { GEOMETRY_FEATURE_KINDS, useGeometryStore } from "@/state/geometryStore";
import { useSettingsStore } from "@/state/settingsStore";
import { selectIsSketchMode, useSketchStore } from "@/state/sketchStore";
import { useViewportStore } from "@/state/viewportStore";

import { useClickGuard } from "../controls/useClickGuard";

/** How close (world units) a new pick needs to land to an already-picked point to toggle it
 * off instead of adding a duplicate — clicking the same edge again deselects it. */
const EDGE_PICK_TOGGLE_DISTANCE = 2;
const EDGE_MARKER_RADIUS = 1.1;

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
  const isPick = useClickGuard();

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
    updateParameters(pickingFeature.id, { edgePoints: next });
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

  const geometry = useMemo(() => {
    if (!mesh) return null;

    const buffer = new BufferGeometry();
    buffer.setAttribute("position", new BufferAttribute(mesh.positions, 3));
    buffer.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
    buffer.setIndex(new BufferAttribute(mesh.indices, 1));
    buffer.computeBoundingSphere();
    return buffer;
  }, [mesh]);

  const edgeGeometry = useMemo(() => {
    if (!mesh || mesh.edges.length === 0) return null;

    const buffer = new BufferGeometry();
    buffer.setAttribute("position", new BufferAttribute(mesh.edges, 3));
    buffer.computeBoundingSphere();
    return buffer;
  }, [mesh]);

  // The canvas only renders on demand, so a freshly built mesh — or a display mode that
  // swaps which materials/overlays are in the tree without touching the geometry itself —
  // has to ask for a frame explicitly.
  useEffect(() => {
    invalidate();
  }, [
    geometry,
    edgeGeometry,
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
    };
  }, [geometry, edgeGeometry]);

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
        onClick={holePlacementActive ? handleHolePlacementClick : undefined}
      >
        {showShadedMaterial ? (
          <meshStandardMaterial
            color={modelColorOverride ?? (isDark ? "#b8c4d0" : "#c9d4e0")}
            metalness={0.12}
            roughness={0.55}
            flatShading={false}
          />
        ) : (
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        )}
      </mesh>

      {edgeGeometry && showEdges && (
        <lineSegments
          geometry={edgeGeometry}
          // `raycast={undefined}` is NOT "don't override" — r3f still sets `instance.raycast =
          // undefined` as an own property, which shadows `LineSegments.prototype.raycast` (the
          // real hit-testing implementation) on the prototype chain, silently breaking clicks.
          // Passing the prototype method explicitly keeps raycasting real while picking.
          raycast={pickingFeature ? LineSegments.prototype.raycast : () => null}
          onClick={pickingFeature ? handleEdgeClick : undefined}
        >
          <lineBasicMaterial
            color={pickingFeature ? "#f5c542" : (modelEdgeColorOverride ?? (isDark ? "#1b1f24" : "#2b3138"))}
          />
        </lineSegments>
      )}

      {pickingFeature?.parameters.edgePoints?.map((point, index) => (
        <mesh key={index} position={point} raycast={() => null}>
          <sphereGeometry args={[EDGE_MARKER_RADIUS, 12, 12]} />
          <meshBasicMaterial color="#e0473d" />
        </mesh>
      ))}
    </group>
  );
}
