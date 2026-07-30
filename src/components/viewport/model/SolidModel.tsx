import { useEffect, useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry } from "three";

import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import { selectBuiltFeatures, useDocumentStore } from "@/state/documentStore";
import { GEOMETRY_FEATURE_KINDS, useGeometryStore } from "@/state/geometryStore";
import { selectIsSketchMode, useSketchStore } from "@/state/sketchStore";
import { useViewportStore } from "@/state/viewportStore";

/**
 * Renders the rebuilt solid: a shaded surface plus the B-Rep edges on top.
 *
 * Drawing real edges rather than a wireframe of the triangulation is what makes the model
 * read as CAD — only the boundaries the kernel considers edges are shown, so a curved face
 * looks smooth instead of faceted.
 */
export function SolidModel() {
  const mesh = useGeometryStore((state) => state.mesh);
  const isDark = useIsDarkTheme();
  const invalidate = useThree((state) => state.invalidate);

  const isSketchMode = useSketchStore(selectIsSketchMode);
  const selectFeature = useDocumentStore((state) => state.selectFeature);
  const openContextMenu = useDocumentStore((state) => state.openContextMenu);
  const displayMode = useViewportStore((state) => state.displayMode);

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
  }, [geometry, edgeGeometry, displayMode, invalidate]);

  // Geometry is owned by this component; release the GPU buffers when it is replaced.
  useEffect(() => {
    return () => {
      geometry?.dispose();
      edgeGeometry?.dispose();
    };
  }, [geometry, edgeGeometry]);

  if (!mesh || !geometry) return null;

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
      >
        {showShadedMaterial ? (
          <meshStandardMaterial
            color={isDark ? "#b8c4d0" : "#c9d4e0"}
            metalness={0.12}
            roughness={0.55}
            flatShading={false}
          />
        ) : (
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        )}
      </mesh>

      {edgeGeometry && showEdges && (
        <lineSegments geometry={edgeGeometry} raycast={() => null}>
          <lineBasicMaterial color={isDark ? "#1b1f24" : "#2b3138"} />
        </lineSegments>
      )}
    </group>
  );
}
