"use client";

import { useState } from "react";
import { CaretDown as ChevronDown, CaretUp as ChevronUp, DiceFive as Dices, Question as HelpCircle, Palette } from "@phosphor-icons/react/ssr";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { type SiteTheme } from "@/lib/templates/theme";
import {
  BG_PALETTE,
  PRIMARY_PALETTE,
  pickRandomColor,
} from "@/lib/composer/scaffold-palette";
import { FontPicker } from "./font-picker";

// User-controllable theme keys. Secondary and Text have sensible derived
// defaults baked into template-base.css.
type UserKey = "primary" | "bg" | "nav_bg" | "nav_text";

const THEME_KEYS: UserKey[] = ["primary", "bg", "nav_bg", "nav_text"];

const DEFAULTS: Record<UserKey, string> = {
  primary: "#d97f33",
  bg: "#ffffff",
  // White matches the historical solid-nav default and the rgba(255,255,255,X)
  // base of every glass nav variant — picking white keeps every nav looking
  // identical to its current state until the user explicitly changes it.
  nav_bg: "#ffffff",
  // Matches the default --color-text in template-base.css — the resting
  // color most navbars already use, so the swatch reflects the current look.
  nav_text: "#292524",
};

const LABELS: Record<UserKey, string> = {
  primary: "Primary",
  bg: "Background",
  nav_bg: "Navbar",
  nav_text: "Navbar text",
};

/** Plain-language help shown on hover of the (?) icon next to each color. */
const THEME_DESCRIPTIONS: Record<UserKey, string> = {
  primary:
    "Main brand color — used on every button, link, hover highlight, and accent on the site. Also fills the auto-generated logo icon.",
  bg: "Page background color — applied to most sections and surfaces.",
  nav_bg:
    "Navigation bar color. Solid navbar variants use this color directly. Glass / frosted variants tint the translucent effect with it, so the navbar inherits your color while keeping its glass character.",
  nav_text:
    "Color of the navbar menu links and dropdown items. Pair it with the navbar color above — e.g. set a dark navbar and light text. The call-to-action button keeps its brand color.",
};

interface Props {
  theme: SiteTheme | undefined;
  onChange: (key: keyof SiteTheme, value: string) => void;
}

export function ThemePanel({ theme, onChange }: Props) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="dash-panel overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="dash-row dash-subhead w-full flex items-center gap-2 px-3 py-2.5 border-b dash-hairline"
      >
        {collapsed ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="dash-chip inline-flex h-6 w-6 items-center justify-center rounded-md shrink-0">
          <Palette className="h-3.5 w-3.5" />
        </span>
        <span className="text-sm font-medium">Theme</span>
        <div className="ml-auto flex gap-1">
          {THEME_KEYS.map((k) => (
            <span
              key={k}
              className="h-3.5 w-3.5 rounded-full dash-hairline border"
              style={{ background: theme?.[k] || DEFAULTS[k] }}
              title={LABELS[k]}
            />
          ))}
        </div>
      </button>

      {!collapsed && (
        <TooltipProvider delayDuration={150}>
          <div className="px-3 py-3 space-y-3">
            {/* Font pickers — full Google Fonts catalog via the Webfonts
                Developer API (1600+ fonts). Heading and Body picked
                independently from searchable dropdowns. Stored as two
                separate theme keys (heading_font, body_font) so the
                renderer derives Google Fonts <link>s + CSS variables
                each render. */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Typography
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground transition-colors p-0.5 -m-0.5 rounded shrink-0"
                      aria-label="What do these fonts affect?"
                    >
                      <HelpCircle className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="left"
                    className="max-w-65 text-xs leading-snug"
                  >
                    <strong className="block mb-1">Typography</strong>
                    Heading font is used on H1/H2/buttons/eyebrows. Body
                    font is used on paragraphs, lists, form fields, and
                    long-form text. Both load from Google Fonts (free)
                    and are baked into the published HTML.
                  </TooltipContent>
                </Tooltip>
              </div>
              <FontPicker
                label="Heading"
                value={theme?.heading_font}
                onChange={(v) => onChange("heading_font", v)}
                placeholder="Space Grotesk"
              />
              <FontPicker
                label="Body"
                value={theme?.body_font}
                onChange={(v) => onChange("body_font", v)}
                placeholder="DM Sans"
              />
            </div>

            <div className="h-px dash-hairline border-t" />

            {/* Brand mark control lives inside the Navbar slot now (logos
                belong with the navbar UI, not buried in the Theme tab).
                Primary color stays here because the auto-generated brand
                derives its icon fill from it — recolors live as you drag
                the picker. */}
            <div className="space-y-1.5">
            {THEME_KEYS.map((k) => {
              const value = theme?.[k] || DEFAULTS[k];
              // Each color has its own curated palette for the randomize
              // dice — primary picks from PRIMARY_PALETTE (16 editorial
              // brand colors), bg picks from BG_PALETTE (10 light bgs).
              // Avoids re-rolling the same color you already had so the
              // dice never looks broken on click.
              const palette = k === "primary" ? PRIMARY_PALETTE : BG_PALETTE;
              return (
                <div
                  key={k}
                  className="dash-row flex items-center gap-2.5 rounded-md px-1.5 py-1.5"
                >
                  <input
                    type="color"
                    value={value}
                    onChange={(e) => onChange(k, e.target.value)}
                    className="h-8 w-10 rounded-md dash-hairline border cursor-pointer p-0.5 shrink-0"
                    aria-label={LABELS[k]}
                  />
                  <span className="text-xs font-semibold">
                    {LABELS[k]}
                  </span>
                  <span className="text-[10px] font-mono tabular-nums text-muted-foreground ml-auto">
                    {value}
                  </span>
                  {/* Dice = randomize. No tooltip on purpose — it pops up
                      every time you click and gets in the way (the whole
                      point is to click it repeatedly to re-roll). aria-label
                      keeps screen-reader access; native title="" intentionally
                      omitted so hover is silent too. */}
                  <button
                    type="button"
                    onClick={() =>
                      onChange(k, pickRandomColor(palette, value))
                    }
                    className="text-muted-foreground hover:text-(--dash-accent) transition-colors p-0.5 -m-0.5 rounded shrink-0"
                    aria-label={`Randomize ${LABELS[k]}`}
                  >
                    <Dices className="h-3.5 w-3.5" />
                  </button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground transition-colors p-0.5 -m-0.5 rounded shrink-0"
                        aria-label={`What does ${LABELS[k]} affect?`}
                      >
                        <HelpCircle className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="left"
                      className="max-w-65 text-xs leading-snug"
                    >
                      <strong className="block mb-1">{LABELS[k]}</strong>
                      {THEME_DESCRIPTIONS[k]}
                    </TooltipContent>
                  </Tooltip>
                </div>
              );
            })}
            </div>
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}

