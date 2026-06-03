import type { TagColor } from "@/types/database";

/**
 * Tag color → Tailwind class strings.
 *
 * Single source of truth. All tag chips, swatches, and filter pills use
 * this so a re-skin is one-file work. Mirrors the badgeClass pattern used
 * elsewhere (proposal status chips, etc.) — soft tinted bg + foreground +
 * subtle border so chips read in both light and dark mode.
 *
 * Why a hardcoded map vs. computed `bg-${color}-500/15`: Tailwind v4 only
 * emits classes it can statically detect. A template-literal class would
 * be purged from the production bundle. Map → safe.
 */
export interface TagPaletteEntry {
  /** Soft chip background (bg + text + border) — for the always-visible chip on a row. */
  chip: string;
  /** Slightly stronger filled variant — for the active state on a filter pill. */
  filled: string;
  /** Tiny solid swatch — for the picker color-grid. */
  swatch: string;
  /** Human label — used as accessible name on the swatch button. */
  label: string;
}

export const TAG_PALETTE: Record<TagColor, TagPaletteEntry> = {
  red: {
    chip: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
    filled: "bg-red-500 text-white border-red-500",
    swatch: "bg-red-500",
    label: "Red",
  },
  orange: {
    chip: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
    filled: "bg-orange-500 text-white border-orange-500",
    swatch: "bg-orange-500",
    label: "Orange",
  },
  amber: {
    chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    filled: "bg-amber-500 text-white border-amber-500",
    swatch: "bg-amber-500",
    label: "Amber",
  },
  yellow: {
    chip: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
    filled: "bg-yellow-500 text-white border-yellow-500",
    swatch: "bg-yellow-500",
    label: "Yellow",
  },
  green: {
    chip: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30",
    filled: "bg-green-500 text-white border-green-500",
    swatch: "bg-green-500",
    label: "Green",
  },
  emerald: {
    chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    filled: "bg-emerald-500 text-white border-emerald-500",
    swatch: "bg-emerald-500",
    label: "Emerald",
  },
  teal: {
    chip: "bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/30",
    filled: "bg-teal-500 text-white border-teal-500",
    swatch: "bg-teal-500",
    label: "Teal",
  },
  cyan: {
    chip: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/30",
    filled: "bg-cyan-500 text-white border-cyan-500",
    swatch: "bg-cyan-500",
    label: "Cyan",
  },
  blue: {
    chip: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
    filled: "bg-blue-500 text-white border-blue-500",
    swatch: "bg-blue-500",
    label: "Blue",
  },
  indigo: {
    chip: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30",
    filled: "bg-indigo-500 text-white border-indigo-500",
    swatch: "bg-indigo-500",
    label: "Indigo",
  },
  violet: {
    chip: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30",
    filled: "bg-violet-500 text-white border-violet-500",
    swatch: "bg-violet-500",
    label: "Violet",
  },
  purple: {
    chip: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
    filled: "bg-purple-500 text-white border-purple-500",
    swatch: "bg-purple-500",
    label: "Purple",
  },
  pink: {
    chip: "bg-pink-500/15 text-pink-600 dark:text-pink-400 border-pink-500/30",
    filled: "bg-pink-500 text-white border-pink-500",
    swatch: "bg-pink-500",
    label: "Pink",
  },
  rose: {
    chip: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
    filled: "bg-rose-500 text-white border-rose-500",
    swatch: "bg-rose-500",
    label: "Rose",
  },
  gray: {
    chip: "bg-gray-500/15 text-gray-700 dark:text-gray-300 border-gray-500/30",
    filled: "bg-gray-500 text-white border-gray-500",
    swatch: "bg-gray-500",
    label: "Gray",
  },
  slate: {
    chip: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30",
    filled: "bg-slate-600 text-white border-slate-600",
    swatch: "bg-slate-500",
    label: "Slate",
  },
};

/** Defensive lookup — falls back to gray for unknown colors. */
export function tagPalette(color: string | null | undefined): TagPaletteEntry {
  if (color && color in TAG_PALETTE) {
    return TAG_PALETTE[color as TagColor];
  }
  return TAG_PALETTE.gray;
}

/** Ordered list of color keys, useful for rendering the swatch picker. */
export const TAG_COLORS: TagColor[] = [
  "red", "orange", "amber", "yellow", "green", "emerald",
  "teal", "cyan", "blue", "indigo", "violet", "purple",
  "pink", "rose", "gray", "slate",
];
