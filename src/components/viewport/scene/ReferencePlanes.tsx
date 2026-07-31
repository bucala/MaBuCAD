import { useEffect, useState } from "react";
import { Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import { DoubleSide } from "three";

import { selectSelectedPlaneId, useDocumentStore } from "@/state/documentStore";
import { useGeometryStore } from "@/state/geometryStore";
import { selectIsSketchMode, useSketchStore } from "@/state/sketchStore";
import { useViewportStore } from "@/state/viewportStore";

import { useClickGuard } from "../controls/useClickGuard";
import { PLANE_SIZE, REFERENCE_PLANES, type ReferencePlaneId } from "../constants";

const HALF = PLANE_SIZE / 2;

/** Closed outline of the square, drawn on the plane's own local XY. */
const BORDER_POINTS: [number, number, number][] = [
  [-HALF, -HALF, 0],
  [HALF, -HALF, 0],
  [HALF, HALF, 0],
  [-HALF, HALF, 0],
  [-HALF, -HALF, 0],
];

/**
 * The Front, Top and Right planes every new document starts with.
 *
 * Each is a translucent square with a solid border, so the plane still reads when it is
 * viewed edge-on and the fill collapses to nothing.
 *
 * Selection lives in the document store rather than locally, so picking a plane here
 * highlights its row in the feature tree and selecting that row highlights the plane —
 * the plane ids in `constants.ts` deliberately match the default feature ids.
 */
export function ReferencePlanes() {
  const [hoveredId, setHoveredId] = useState<ReferencePlaneId | null>(null);
  const isPick = useClickGuard();

  const selectedId = useDocumentStore(selectSelectedPlaneId);
  const selectFeature = useDocumentStore((state) => state.selectFeature);
  const openContextMenu = useDocumentStore((state) => state.openContextMenu);
  const onSelect = (id: ReferencePlaneId | null) => selectFeature(id);

  /**
   * A sketch is drawn on a plane, so the plane sits directly under the drawing surface and
   * would otherwise intercept every click meant for the sketch. Planes stop being pickable
   * — and fade back — while a sketch is open.
   */
  const isSketchMode = useSketchStore(selectIsSketchMode);

  /**
   * Once a solid exists the planes are visual noise, so they step back the way they do in
   * SolidWorks after the first feature. A selected plane still shows, since the selection
   * would otherwise have nothing to point at.
   */
  const hasSolid = useGeometryStore((state) => state.mesh !== null);

  /** Hide/Show on the ribbon or a right-click, per plane; a selected plane still shows
   * even when hidden, same as it does when dimmed for having a solid — the selection
   * needs something to point at. */
  const hiddenFeatureIds = useViewportStore((state) => state.hiddenFeatureIds);
  const invalidate = useThree((state) => state.invalidate);

  // Hide/Show (from the ribbon or the tree's own eye icon) and "a solid now exists, so
  // dim back" both originate outside this component's own render loop, so under
  // `frameloop="demand"` the resulting opacity change needs an explicit repaint — the
  // canvas would otherwise keep showing the plane's old, now-stale opacity indefinitely.
  useEffect(() => {
    invalidate();
  }, [hiddenFeatureIds, hasSolid, isSketchMode, selectedId, hoveredId, invalidate]);

  return (
    <group
      // Clicking empty space clears the selection, as in any CAD graphics area. Fires
      // when a click lands in the scene but misses everything in this group.
      //
      // Skipped while an edge-pick session is active: a miss there means the click landed
      // near, but not exactly on, an edge (or on a face, which isn't pickable), and should
      // just do nothing — not clear the selection and, with it, silently cancel picking
      // (`PropertyManager.tsx`'s effect exits pick mode the instant the picking feature stops
      // being the selected one). Read via `getState()` rather than a subscribed hook, same as
      // `SolidModel.tsx`'s own `handleContextMenu` and for the same reason: only the value at
      // the moment of the (rare) miss is needed, not a re-render of this whole plane group on
      // every edge-pick toggle.
      onPointerMissed={(event) => {
        if (useViewportStore.getState().edgePickModeFeatureId) return;
        if (isPick({ nativeEvent: event })) {
          onSelect(null);
        }
      }}
    >
      {REFERENCE_PLANES.map((plane) => {
        const isSelected = selectedId === plane.id;
        const isHovered = hoveredId === plane.id;
        const isDimmed =
          (hasSolid || hiddenFeatureIds.includes(plane.id)) && !isSketchMode && !isSelected;

        /**
         * A plane faded to full invisibility still sits exactly where it was drawn on —
         * typically coincident with a face of the solid it seeded — so without this it
         * keeps intercepting clicks and right-clicks meant for the solid underneath it,
         * even though nothing about it is visible any more. Still selectable in this state
         * from the feature tree, which is the SolidWorks convention this dimming mirrors.
         */
        const isInert = isSketchMode || isDimmed;

        const handleOver = (event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          setHoveredId(plane.id);
        };

        const handleOut = () => {
          setHoveredId((current) => (current === plane.id ? null : current));
        };

        const handleClick = (event: ThreeEvent<MouseEvent>) => {
          // Ignore the click that ends an orbit or pan gesture over this plane.
          if (!isPick(event)) return;
          event.stopPropagation();
          onSelect(isSelected ? null : plane.id);
        };

        // Right button drives no camera gesture (only middle-drag does), so unlike
        // `handleClick` this needs no drag guard — every right-click here is a genuine one.
        const handleContextMenu = (event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          event.nativeEvent.preventDefault();
          onSelect(plane.id);
          openContextMenu(event.nativeEvent.clientX, event.nativeEvent.clientY);
        };

        return (
          <group key={plane.id} rotation={plane.rotation}>
            <mesh
              name={plane.label}
              onPointerOver={isInert ? undefined : handleOver}
              onPointerOut={isInert ? undefined : handleOut}
              onClick={isInert ? undefined : handleClick}
              onContextMenu={isInert ? undefined : handleContextMenu}
              renderOrder={-1}
            >
              <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
              <meshBasicMaterial
                color={plane.color}
                transparent
                opacity={
                  isSketchMode ? 0.02 : isDimmed ? 0 : isSelected ? 0.16 : isHovered ? 0.1 : 0.05
                }
                side={DoubleSide}
                depthWrite={false}
              />
            </mesh>

            <Line
              points={BORDER_POINTS}
              color={plane.color}
              lineWidth={isSelected ? 2 : 1}
              transparent
              opacity={
                isSketchMode ? 0.2 : isDimmed ? 0.12 : isSelected ? 1 : isHovered ? 0.85 : 0.5
              }
              raycast={() => null}
            />
          </group>
        );
      })}
    </group>
  );
}
