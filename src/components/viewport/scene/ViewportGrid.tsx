import { Grid } from "@react-three/drei";

import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import { mixHex } from "@/utils/colorMix";

import { DOCUMENT_SCALE, VIEWPORT_BG_APPROX } from "../constants";

/**
 * Ground reference grid on the Top plane (XZ), giving a sense of scale and horizon while
 * orbiting an otherwise empty document.
 *
 * Ruled in millimetres: a 10 mm cell with a heavier line every 100 mm. Line colours are
 * mixed 50% toward the viewport background — see `mixHex`'s own doc comment for why that,
 * rather than an opacity prop, is what "dims" a drei `Grid`.
 */
export function ViewportGrid() {
  const isDark = useIsDarkTheme();
  const bg = isDark ? VIEWPORT_BG_APPROX.dark : VIEWPORT_BG_APPROX.light;

  return (
    <Grid
      infiniteGrid
      cellSize={DOCUMENT_SCALE / 10}
      cellThickness={0.7}
      cellColor={mixHex(isDark ? "#565c64" : "#93a3b5", bg, 0.5)}
      sectionSize={DOCUMENT_SCALE}
      sectionThickness={1.2}
      sectionColor={mixHex(isDark ? "#6f7986" : "#6d8299", bg, 0.5)}
      fadeDistance={DOCUMENT_SCALE * 12}
      fadeStrength={1}
      // Grid lines must not swallow clicks meant for planes or, later, model faces.
      raycast={() => null}
    />
  );
}
