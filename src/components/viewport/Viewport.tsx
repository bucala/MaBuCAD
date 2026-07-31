import { Canvas } from "@react-three/fiber";

import { useViewportStore } from "@/state/viewportStore";

import { AXIS_COLORS } from "./constants";
import { Scene } from "./scene/Scene";
import { SketchContextMenu } from "./sketch/SketchContextMenu";
import styles from "./Viewport.module.css";

/** A small filled triangle at (tx, ty), pointing away from (ox, oy) — the arrowhead on
 * one arm of the corner axis-cross legend below. */
function arrowhead(tx: number, ty: number, ox: number, oy: number): string {
  const dx = tx - ox;
  const dy = ty - oy;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const size = 4.5;
  const backX = tx - ux * size;
  const backY = ty - uy * size;
  const perpX = -uy * size * 0.55;
  const perpY = ux * size * 0.55;
  return `M ${tx} ${ty} L ${backX + perpX} ${backY + perpY} L ${backX - perpX} ${backY - perpY} Z`;
}

/**
 * Graphics area.
 *
 * `frameloop="demand"` renders only when something actually changes, which is the right
 * behaviour for a modelling tool: a static model costs nothing, and navigation still runs
 * at full rate because the controls invalidate on every change.
 */
export function Viewport() {
  const projection = useViewportStore((state) => state.projection);

  return (
    <div className={styles.viewport}>
      <Canvas
        className={styles.canvas}
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        {/* Line pick tolerance is applied inside the tree, not here via `onCreated` — see
            `RaycasterTuning.tsx`: it needs to react to the Settings dialog changing the
            value live, not just set it once at canvas creation. */}
        <Scene projection={projection} />
      </Canvas>

      {/* A static legend, not a live navigation gizmo — GizmoViewcube in Scene.tsx already
          rotates with the camera in the opposite corner. This one just reminds which
          colour means which axis, drawn as a triad radiating from one point (the CAD
          convention) rather than three disconnected colour chips. */}
      <svg className={styles.originGizmo} width="42" height="38" viewBox="0 0 42 38" aria-hidden="true">
        <g stroke={AXIS_COLORS.z} strokeWidth="1.75" strokeLinecap="round">
          <line x1="14" y1="30" x2="4" y2="18" />
        </g>
        <path d={arrowhead(4, 18, 14, 30)} fill={AXIS_COLORS.z} />
        <text x="1" y="15" fill={AXIS_COLORS.z} fontSize="10" fontWeight="700">Z</text>

        <g stroke={AXIS_COLORS.y} strokeWidth="1.75" strokeLinecap="round">
          <line x1="14" y1="30" x2="14" y2="8" />
        </g>
        <path d={arrowhead(14, 8, 14, 30)} fill={AXIS_COLORS.y} />
        <text x="10" y="6" fill={AXIS_COLORS.y} fontSize="10" fontWeight="700">Y</text>

        <g stroke={AXIS_COLORS.x} strokeWidth="1.75" strokeLinecap="round">
          <line x1="14" y1="30" x2="34" y2="30" />
        </g>
        <path d={arrowhead(34, 30, 14, 30)} fill={AXIS_COLORS.x} />
        <text x="36" y="33" fill={AXIS_COLORS.x} fontSize="10" fontWeight="700">X</text>

        <circle cx="14" cy="30" r="1.75" fill="currentColor" className={styles.originDot} />
      </svg>

      <div className={styles.hint}>
        Middle drag orbit · Ctrl+middle pan · Shift+middle or wheel zoom
      </div>

      {/* Renders nothing outside sketch mode — SketchCanvas is the only thing that ever
          opens it, and it lives here (a plain DOM sibling of the Canvas) rather than
          inside the Canvas tree; see SketchContextMenu's own doc comment for why. */}
      <SketchContextMenu />

      {/* FeatureContextMenu (opened by ReferencePlanes/SolidModel for a right-click on a
          plane or the modelled solid) is mounted once at the app's top level, not here —
          see its own doc comment for why: the same global store this viewport uses to
          open it is also what the Feature Manager tree opens it from. */}
    </div>
  );
}
