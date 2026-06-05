"use client";

import { Sparkle as Sparkles } from "@phosphor-icons/react/ssr";
import { Button } from "@/components/ui/button";

/**
 * Centered card overlaid on the composer's preview area when a site has
 * zero body sections (and no shared nav/footer set). Offers two one-click
 * scaffold presets so the IT person can skip the manual "Add section"
 * loop and jump straight to editing.
 *
 *   • Basic   — lean preset, skips how-it-works / faq / cta blocks.
 *               Right size for cheaper packages where the client doesn't
 *               need a process explainer or extra cta module.
 *   • Premium — every category in the catalog.
 *
 * Disappears the moment any section is added (composer's empty check
 * flips false). Re-appears if the user removes everything — that's
 * intentional, since this IS the right entry point for re-rolling a
 * scaffold from scratch.
 */
interface Props {
  /** Total templates available in the catalog — shown as social proof
   *  ("11 sections from 25 templates" feels more legit than a bare button). */
  templateCount: number;
  /** Categories represented in the catalog. Lets the count line stay
   *  accurate even if a category gets added/removed later. */
  categoryCount: number;
  /** Fires the Basic-preset scaffold (skips how-it-works/faq/cta). */
  onGenerateBasic: () => void;
  /** Fires the Premium-preset scaffold (every category). */
  onGeneratePremium: () => void;
}

export function EmptyStateCard({
  templateCount,
  categoryCount,
  onGenerateBasic,
  onGeneratePremium,
}: Props) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-8 pointer-events-none">
      {/* The card itself takes pointer events back so the buttons are
          clickable; everything around it stays click-through (lets users
          still scroll the preview iframe behind if they want). */}
      <div className="pointer-events-auto max-w-md w-full dash-panel p-8 text-center">
        <div className="dash-chip-pink w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-5">
          <Sparkles className="h-6 w-6" />
        </div>

        <h2 className="text-lg font-semibold tracking-tight mb-2">Start with a full site</h2>

        <p className="text-sm text-muted-foreground mb-1 leading-relaxed">
          One click and we'll assemble a complete website. Pick the
          preset that matches the client package.
        </p>
        <p className="text-xs text-muted-foreground/70 mb-6 tabular-nums">
          Each section gets a random template from the catalog
          ({templateCount} templates across {categoryCount} categories).
          Edit anything afterward.
        </p>

        {/* Two side-by-side preset buttons. Basic = lean (no
            how-it-works / faq / cta), Premium = every category.
            Both have identical visual weight — the IT person picks
            based on the client's package, not on a styling cue. */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="lg"
            variant="outline"
            onClick={onGenerateBasic}
            className="gap-2"
            title="Lean preset: skips how-it-works, faq, and cta sections."
          >
            <Sparkles className="h-4 w-4" />
            Basic website
          </Button>
          <Button
            size="lg"
            onClick={onGeneratePremium}
            className="gap-2"
            title="Full preset: every category in the catalog."
          >
            <Sparkles className="h-4 w-4" />
            Premium website
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground/60 mt-4">
          Or pick sections one at a time from the left rail →
        </p>
      </div>
    </div>
  );
}
