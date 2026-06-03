/**
 * Brand identity layer — owns the auto-vs-custom logo state for a site
 * and resolves it to concrete URLs at render time.
 *
 * The Brand panel in the composer (theme-panel.tsx) writes the user's
 * chosen state into `composition.brand`; the renderer (server + browser)
 * reads it back through `resolveBrand()` to know which URL to drop into
 * nav/footer logo `<img>` tags + the page <head> favicon.
 *
 * Three states are possible:
 *   - "auto"   → SVG generated on the fly from theme.primary + company_text
 *   - "custom" → user uploaded their own logo (image picker / Brand panel)
 *   - missing  → brand has never been initialized (legacy site, fresh row);
 *                resolver still returns a sensible fallback so logos render
 *
 * Pure module — no React, no DOM, no Supabase. Both renderers and the
 * composer can import freely.
 */

import {
  buildFaviconSvg,
  buildLogoSvg,
  firstLetter,
  svgToDataUrl,
} from "./logo-generator";
import type { SiteTheme } from "@/lib/templates/theme";

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * Persisted brand identity. Stored on `composition.brand`; nullable for
 * backwards-compatibility with sites created before this layer existed.
 */
export interface SiteBrand {
  /** "auto" → SVG generated from company_text + current theme primary.
   *  "custom" → use whatever URL is in custom_logo_url verbatim. */
  mode: "auto" | "custom";
  /** Company name shown next to the auto-generated icon. Also used to
   *  derive the favicon letter. Falls back to "Logo" when empty. */
  company_text: string;
  /** Asset URL when mode=custom. Can be a `pending:` marker (just-uploaded
   *  via image picker, lives in IndexedDB until publish), a Supabase URL
   *  (legacy), or a `/_uploads/x.png` path (after publish). */
  custom_logo_url?: string;
  /** Optional separate custom favicon URL — when mode=custom and the user
   *  also wants a different favicon image. When absent, custom mode reuses
   *  custom_logo_url for both (works fine for square logos). */
  custom_favicon_url?: string;

  /* ── Site-wide contact identity ─────────────────────────────────────
   * Pre-filled from the linked proposal's contact on first composer
   * open. Auto-applied across every section field whose key matches
   * `phone` / `email` / `address` (case-insensitive contains-match) by
   * the renderer's brand-contact override pass — same pattern as
   * `company_text` propagating to nav + footer logos. Type once in the
   * Brand panel, shows everywhere. No per-section retyping.
   * ──────────────────────────────────────────────────────────────── */

  /** Primary phone number shown in nav CTAs, footers, contact sections.
   *  Free-form string (templates render verbatim, no formatting helper).
   *  Preferred input format: dialable international, e.g. "+421 905 123 456". */
  phone?: string;
  /** Primary contact email shown in footers, contact sections. */
  email?: string;
  /** Single-line postal address shown in footers, contact sections, map
   *  callouts. Convention: "12 Main Street, London EC1A 1BB". Kept
   *  as one string so renderer + JSON workflow have one slot to fill,
   *  not three (street / city / zip). Templates that want multi-line
   *  rendering can split on comma at presentation time. */
  address?: string;

  /* ── LocalBusiness JSON-LD enrichment fields ────────────────────────
   * These don't appear in any template field (yet) — they exist purely
   * to enrich the LocalBusiness structured-data block on publish. UI
   * lives inside the SEO panel's "Google tools → Local business"
   * section so users edit them next to the indicator that explains
   * what they DO. Schema is on SiteBrand (not SiteSeo) because they
   * describe the business itself; future template fields like footer
   * "Opening hours" can read from here too via the brand-contact
   * auto-fill pattern.
   * ────────────────────────────────────────────────────────────────── */

  /** Free-form opening hours, e.g. "Mon-Fri 8:00-17:00, Sat 9:00-12:00".
   *  Emitted into LocalBusiness JSON-LD as `openingHours`. Google
   *  accepts free-form strings here (not ideal — they prefer the
   *  ISO-like "Mo-Fr 08:00-17:00" — but a free-form string is
   *  better than nothing, and parsing every dialect of "Mon-Fri" is
   *  more brittle than letting Google's NLP handle it). */
  opening_hours?: string;

  /** Business category — maps to a schema.org LocalBusiness subtype
   *  for the JSON-LD `@type` field. Stored as the schema.org class
   *  name (e.g. "Plumber", "Electrician"), or the sentinel `"Custom"`
   *  when the user picked "Other — name it yourself" in the dropdown.
   *  The SEO panel's dropdown shows English labels for each option.
   *  Empty / unknown → defaults to "LocalBusiness" (generic), still
   *  works but less specific. */
  business_type?: string;

  /** Free-form description used when `business_type === "Custom"`.
   *  Emitted as the schema's `description` field instead of forcing
   *  an invented `@type`. Schema.org's `description` is a legitimate
   *  short-text slot Google uses in some snippets — better than a
   *  fake type that fails validation, better than nothing. */
  business_type_custom?: string;

  /** Facebook page URL — emitted in LocalBusiness JSON-LD `sameAs`
   *  array. Helps Google connect the website to the business's
   *  social presence. Full URL required (e.g.
   *  https://www.facebook.com/abcfirma). */
  social_facebook?: string;
  /** Instagram profile URL — emitted in LocalBusiness JSON-LD `sameAs`. */
  social_instagram?: string;

  /** Navbar logo height in CSS pixels. Stamped on the `.logo` ancestor
   *  of `[data-field="nav_logo"]` by both renderers. The image inherits
   *  via the template's `.logo img { height: 100%; width: auto }` rule
   *  so its width scales with the natural aspect ratio. When undefined
   *  the template's default height wins (48px desktop / 40px mobile on
   *  most navs). UI clamps to LOGO_HEIGHT_MIN_PX..LOGO_HEIGHT_MAX_PX. */
  logo_height_px?: number;
}

/** Logo size knobs. 24..160 px range with a 4 px step — big enough that
 *  every click visibly changes the logo, but fine enough to land on a
 *  height the user likes without typing. Default 48 matches the
 *  canonical nav template height (`.logo { height: 48px }`). */
export const LOGO_HEIGHT_MIN_PX = 24;
export const LOGO_HEIGHT_MAX_PX = 160;
export const LOGO_HEIGHT_DEFAULT_PX = 48;
export const LOGO_HEIGHT_STEP_PX = 4;

/**
 * What the renderer cares about: the two URLs to inject into the page.
 * Computed by `resolveBrand()` from a SiteBrand + the current theme.
 */
export interface ResolvedBrand {
  /** URL safe to drop into `<img src="...">` for the nav/footer logo. */
  logoUrl: string;
  /** URL safe to drop into `<link rel="icon" href="...">`. */
  faviconUrl: string;
}

// ── Public helpers ──────────────────────────────────────────────────────────

/**
 * Build a fresh SiteBrand record for a brand-new site. Uses the proposal
 * company name (or site name fallback) as the auto-mode text.
 *
 * Auto-init on composer open — when a site has no `brand` field yet, the
 * composer calls this once and persists the result. Idempotent: never
 * overwrites an existing brand record.
 */
export function makeDefaultBrand(companyText: string): SiteBrand {
  return {
    mode: "auto",
    company_text: (companyText ?? "").trim() || "Logo",
  };
}

/**
 * Resolve a brand record + theme into the concrete URLs the renderer
 * needs. Always returns a valid ResolvedBrand — falls back to auto-mode
 * with "Logo" text on legacy sites that have no brand record at all, so
 * nav/footer logo slots never go empty.
 *
 * Caller passes `companyTextFallback` for the legacy-site case so the
 * fallback logo at least has the site's name in it. When brand is set
 * (the modern path), the fallback is unused.
 */
export function resolveBrand(
  brand: SiteBrand | null | undefined,
  theme: SiteTheme | null | undefined,
  companyTextFallback: string,
): ResolvedBrand {
  // Custom mode — user uploaded their own asset; never auto-generate
  // anything regardless of theme color changes.
  if (brand?.mode === "custom" && brand.custom_logo_url) {
    return {
      logoUrl: brand.custom_logo_url,
      // Custom favicon falls back to the custom logo (works for square
      // assets). Browsers + crawlers handle SVG/PNG/JPEG equally for
      // favicon hints, so reusing the same URL is fine.
      faviconUrl: brand.custom_favicon_url ?? brand.custom_logo_url,
    };
  }

  // Auto mode (or missing brand record) — synthesize SVG + base64 it.
  // Theme primary fallback matches the SAFI-STAV reference color so a
  // brand-new site without a theme still renders a recognizable mark.
  const text = (brand?.company_text ?? "").trim() || companyTextFallback || "Logo";
  const primary = (theme?.primary ?? "").trim() || "#142733";

  const logoSvg = buildLogoSvg({ text, primaryColor: primary });
  const faviconSvg = buildFaviconSvg({
    letter: firstLetter(text),
    primaryColor: primary,
  });

  return {
    logoUrl: svgToDataUrl(logoSvg),
    faviconUrl: svgToDataUrl(faviconSvg),
  };
}

/**
 * Convenience: derive the auto-mode logo URL only (skips favicon work).
 * Used by the Brand panel preview where we only want the inline preview
 * `<img>` source. Cheap enough to call on every render — no memoization
 * needed (SVG construction is microseconds).
 */
export function previewLogoUrl(text: string, primaryColor: string): string {
  return svgToDataUrl(
    buildLogoSvg({
      text: text.trim() || "Logo",
      primaryColor: primaryColor.trim() || "#142733",
    }),
  );
}
