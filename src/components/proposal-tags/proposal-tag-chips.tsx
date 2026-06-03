"use client";

import type { ProposalTag, TagColor } from "@/types/database";
import { tagPalette } from "./tag-palette";
import { cn } from "@/lib/utils";

// Minimalist palette used by the "minimal" size: only the TEXT carries
// the colour. Background stays neutral (bg-muted), border is transparent.
// Reads more like a Linear-style metadata label than a coloured chip.
const TEXT_ONLY: Record<TagColor, string> = {
  red:     "text-red-600 dark:text-red-400",
  orange:  "text-orange-600 dark:text-orange-400",
  amber:   "text-amber-600 dark:text-amber-400",
  yellow:  "text-yellow-700 dark:text-yellow-400",
  green:   "text-green-600 dark:text-green-400",
  emerald: "text-emerald-600 dark:text-emerald-400",
  teal:    "text-teal-600 dark:text-teal-400",
  cyan:    "text-cyan-600 dark:text-cyan-400",
  blue:    "text-blue-600 dark:text-blue-400",
  indigo:  "text-indigo-600 dark:text-indigo-400",
  violet:  "text-violet-600 dark:text-violet-400",
  purple:  "text-purple-600 dark:text-purple-400",
  pink:    "text-pink-600 dark:text-pink-400",
  rose:    "text-rose-600 dark:text-rose-400",
  gray:    "text-muted-foreground",
  slate:   "text-muted-foreground",
};

/**
 * Read-only chip display for a list of proposal tags.
 *
 * Used in:
 *   - Sales proposal list rows (each row's left side)
 *   - Sales proposal detail header
 *   - Super admin oversight rows
 *   - Tech proposal builds queue (uses size="minimal")
 *
 * No interactivity beyond an optional onClick (for "click chip → toggle
 * filter on list view"). For the add/remove UX, use ProposalTagPicker.
 *
 * Sizes:
 *   - "minimal": squared-off, smallest, no fill — for dense lists where
 *     tags sit under another label (e.g. company name on the IT queue).
 *   - "xs": tight rounded pill (sales proposal list rows).
 *   - "sm": default rounded pill (detail headers, filter bar pills).
 */
export function ProposalTagChips({
  tags,
  size = "xs",
  onTagClick,
  className,
}: {
  tags: ProposalTag[] | null | undefined;
  size?: "minimal" | "xs" | "sm";
  /** Optional click handler — if set, chips render as <button>s. */
  onTagClick?: (tag: ProposalTag) => void;
  className?: string;
}) {
  if (!tags || tags.length === 0) return null;

  // Per-size weight + shape. Minimal stays square-cornered + normal
  // weight so chips read as quiet metadata, not highlighted pills.
  const sizeCls =
    size === "minimal"
      ? "text-[9px] px-1 py-0 leading-[14px] font-normal"
      : size === "xs"
      ? "text-[10px] px-1.5 py-0 h-[18px] leading-none rounded-full font-medium"
      : "text-xs px-2 py-0.5 rounded-full font-medium";

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {tags.map((tag) => {
        const palette = tagPalette(tag.color);
        // Minimal: neutral muted background, only the text carries colour,
        // no border, no rounding, normal weight. Other sizes keep the
        // tinted-pill look.
        const styleCls =
          size === "minimal"
            ? cn("bg-muted/60 border-transparent", TEXT_ONLY[tag.color])
            : palette.chip;
        const baseCls = cn(
          "inline-flex items-center whitespace-nowrap",
          size !== "minimal" && "border",
          sizeCls,
          styleCls,
        );
        if (onTagClick) {
          return (
            <button
              key={tag.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onTagClick(tag);
              }}
              className={cn(baseCls, "hover:opacity-80 cursor-pointer transition-opacity")}
              aria-label={`Filter by ${tag.name}`}
            >
              {tag.name}
            </button>
          );
        }
        return (
          <span key={tag.id} className={baseCls}>
            {tag.name}
          </span>
        );
      })}
    </div>
  );
}
