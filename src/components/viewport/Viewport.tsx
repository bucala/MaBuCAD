import type { CSSProperties } from "react";
import { Canvas } from "@react-three/fiber";

import { useSettingsStore, type ViewportBackground } from "@/state/settingsStore";
import { useViewportStore } from "@/state/viewportStore";
import { mixHex } from "@/utils/colorMix";

import { Scene } from "./scene/Scene";
import { SketchContextMenu } from "./sketch/SketchContextMenu";
import styles from "./Viewport.module.css";

/**
 * The viewport's own CSS background, overriding `Viewport.module.css`'s default
 * light/dark/gray gradient — `undefined` for `"theme"` mode lets that default show
 * through untouched, which is the point of it being opt-in.
 */
function backgroundStyle(background: ViewportBackground): CSSProperties | undefined {
  const highlight = mixHex(background.color, "#ffffff", background.intensity);

  switch (background.mode) {
    case "solid":
      return { background: background.color };
    case "gradient-center":
      return { background: `radial-gradient(circle at 50% 45%, ${highlight} 0%, ${background.color} 100%)` };
    case "gradient-bottom":
      return { background: `linear-gradient(180deg, ${highlight} 0%, ${background.color} 100%)` };
    case "image":
      // The image itself is a separate layer (see the `imageDataUrl &&` block below) so
      // its own opacity can fade independently — this is just the colour showing through
      // wherever the image doesn't fully cover.
      return { background: background.color };
    default:
      return undefined;
  }
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
  const background = useSettingsStore((state) => state.viewportBackground);

  return (
    <div className={styles.viewport} style={backgroundStyle(background)}>
      {background.mode === "image" && background.imageDataUrl && (
        <div
          className={styles.backgroundImage}
          style={{ backgroundImage: `url(${background.imageDataUrl})`, opacity: background.imageOpacity }}
          aria-hidden="true"
        />
      )}

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
