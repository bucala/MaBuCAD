import { useEffect } from "react";
import { useThree } from "@react-three/fiber";

import { useSettingsStore } from "@/state/settingsStore";

/**
 * Applies Settings > Display > "Line pick tolerance" to the live raycaster whenever it
 * changes, not just once at Canvas creation.
 *
 * `Line2`'s raycast (three's fat-line implementation, used by every sketch line and the
 * B-Rep edge overlay) adds `raycaster.params.Line2.threshold`, in screen pixels, straight
 * onto `material.linewidth` — see `LineSegments2.raycast`. `Line2` isn't part of three's
 * own `RaycasterParameters` type (it's an examples/jsm addition reading this object by
 * convention, not a declared field), so it's set here via an escape hatch rather than
 * through r3f's strictly-typed `raycaster` prop.
 */
export function RaycasterTuning() {
  const raycaster = useThree((state) => state.raycaster);
  const linePickTolerance = useSettingsStore((state) => state.linePickTolerance);

  useEffect(() => {
    const params = raycaster.params as unknown as Record<string, { threshold?: number } | undefined>;
    params.Line = { ...params.Line, threshold: linePickTolerance };
    params.Line2 = { ...params.Line2, threshold: linePickTolerance };
  }, [raycaster, linePickTolerance]);

  return null;
}
