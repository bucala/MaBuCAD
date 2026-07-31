import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import { useSettingsStore } from "@/state/settingsStore";

/** Mixes a hex colour toward white by `ratio` (0 = unchanged, 1 = white) — the WebGL
 * equivalent of `tokens.css`'s `color-mix(in srgb, var(--accent-hex) x%, white)`, needed
 * because three.js materials take an actual colour, not a CSS custom property. */
function lighten(hex: string, ratio: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;

  const value = parseInt(match[1], 16);
  const mix = (channel: number) => Math.round(channel + (255 - channel) * ratio);

  const r = mix((value >> 16) & 0xff);
  const g = mix((value >> 8) & 0xff);
  const b = mix(value & 0xff);

  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * The Settings dialog's accent colour, resolved for use in a `three.js` material colour
 * prop — scene geometry (sketch previews, selection highlights, the viewcube hover tint)
 * cannot read `var(--accent)` the way CSS can, so this mirrors `tokens.css`'s own
 * light/dark accent derivation in JavaScript instead.
 */
export function useSceneAccentColor(): string {
  const accentColor = useSettingsStore((state) => state.accentColor);
  const isDark = useIsDarkTheme();
  return isDark ? lighten(accentColor, 0.15) : accentColor;
}
