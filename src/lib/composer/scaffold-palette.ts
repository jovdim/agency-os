/**
 * Curated color palettes used by:
 *   - The "Generate full site" scaffold (composer-client.tsx) — picks one
 *     random PRIMARY color per scaffold; background stays white per spec.
 *   - The per-color randomize buttons in ThemePanel — separate dice icons
 *     next to Primary and Background let the user re-roll each independently.
 *
 * Why curated lists instead of random HSL: random hue/saturation produces
 * neon greens and acid pinks too often. These are hand-picked editorial
 * tones that read as "brand," not "lava lamp."
 */

/**
 * 16 brand-ready primary hues. Sampled from studio sites, magazine
 * palettes, and Slovak-business-friendly tones. Each has decent contrast
 * against the light backgrounds in BG_PALETTE so buttons stay legible.
 */
export const PRIMARY_PALETTE: readonly string[] = [
  "#d97f33", // burnt orange  (current default)
  "#3b5249", // forest green
  "#a8475a", // burgundy
  "#1d4d8c", // cobalt blue
  "#7e6c47", // mustard
  "#6b4f3d", // mocha brown
  "#5d4d6c", // muted plum
  "#2d4a5e", // teal-slate
  "#b86d4a", // terracotta
  "#3a4b5b", // deep slate-blue
  "#724c8b", // royal mauve
  "#4a5b3d", // olive
  "#a04545", // brick red
  "#1f6f5c", // emerald-deep
  "#8e4f2a", // sienna
  "#0f172a", // slate-900   (refined neutral)
];

/**
 * 10 light backgrounds. Deliberately ALL light — random rolling into a
 * dark bg would break sections that were designed assuming light theme
 * (text colors, button outlines, etc. all derive from --color-bg). Users
 * who want dark can pick manually via the color input.
 */
export const BG_PALETTE: readonly string[] = [
  "#ffffff", // pure white      (current default)
  "#fafaf7", // cream
  "#f8f6f1", // warm off-white
  "#f5f3ee", // linen
  "#fafafa", // neutral 50
  "#f9fafb", // cool gray-50
  "#f1f5f9", // slate-50
  "#fdf6e3", // solarized cream
  "#faf6f0", // peach cream
  "#fcfcfa", // bone
];

/**
 * Pick a random color from a palette, optionally avoiding a specific
 * value. Used by the randomize-button UX so clicking dice never returns
 * the same color you already had — that'd look like the button is broken.
 */
export function pickRandomColor(
  palette: readonly string[],
  avoid?: string,
): string {
  if (palette.length === 0) return "#000000";
  // Normalize for comparison (color inputs can return mixed case).
  const avoidLower = avoid?.toLowerCase();
  const candidates =
    avoidLower && palette.length > 1
      ? palette.filter((c) => c.toLowerCase() !== avoidLower)
      : palette;
  return candidates[Math.floor(Math.random() * candidates.length)]!;
}

/** Convenience wrapper for the scaffold flow — picks any primary. */
export function pickScaffoldPrimary(): string {
  return pickRandomColor(PRIMARY_PALETTE);
}
