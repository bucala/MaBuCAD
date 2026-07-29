import { Grid } from "@react-three/drei";

import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";

import { DOCUMENT_SCALE } from "../constants";

/**
 * Ground reference grid on the Top plane (XZ), giving a sense of scale and horizon while
 * orbiting an otherwise empty document.
 *
 * Ruled in millimetres: a 10 mm cell with a heavier line every 100 mm.
 */
export function ViewportGrid() {
  const isDark = useIsDarkTheme();

  return (
    <Grid
      infiniteGrid
      cellSize={DOCUMENT_SCALE / 10}
      cellThickness={0.7}
      cellColor={isDark ? "#565c64" : "#93a3b5"}
      sectionSize={DOCUMENT_SCALE}
      sectionThickness={1.2}
      sectionColor={isDark ? "#6f7986" : "#6d8299"}
      fadeDistance={DOCUMENT_SCALE * 12}
      fadeStrength={1}
      // Grid lines must not swallow clicks meant for planes or, later, model faces.
      raycast={() => null}
    />
  );
}
