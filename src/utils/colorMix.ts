/**
 * Blends two `#rrggbb` colours. Used to "dim" a colour by mixing it toward the viewport
 * background: over a solid backdrop, drawing a colour at 50% opacity looks identical to
 * drawing it at full opacity after mixing it 50/50 with that backdrop — and the grid's
 * shader (drei's `Grid`) has no opacity uniform to animate directly, so this is the
 * cheapest way to visually "fade" its line colours without forking the shader.
 */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * t);
  return toHex(mix(pa[0], pb[0]), mix(pa[1], pb[1]), mix(pa[2], pb[2]));
}

function parseHex(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function toHex(r: number, g: number, b: number): string {
  const channel = (value: number) => value.toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}
