// Theme palette helpers. Pure — no server deps — so both the server renderer
// (render.ts) and the in-browser renderer (render-browser.ts) can import this.

/**
 * The user-controllable part of the site theme.
 *
 * Only Primary and Background are surfaced to the user. Secondary, Text, and
 * the various derived tokens (text-light, dark, bg-alt, border, etc.) are
 * computed in `template-base.css` from sensible defaults — they don't need
 * per-site tweaking and dropping them simplifies the picker dramatically.
 *
 * `secondary?` and `text?` are kept as optional fields purely so legacy
 * compositions saved with those values don't fail to deserialize. Anything
 * not listed in `THEME_VAR_MAP` is silently ignored at render time.
 */
export interface SiteTheme {
  primary?: string;
  bg?: string;
  /** Navbar background — applied as `--color-nav-bg` on :root. Solid
   *  navs (nav-01/03/05) use it directly. Glass navs (nav-02/04/06)
   *  use it via `color-mix(..., transparent)` so the user's tint
   *  preserves the existing translucency. Default fallback is white
   *  baked into the nav stylesheets. */
  nav_bg?: string;
  /** Navbar menu-link + dropdown text color — applied as
   *  `--color-nav-text` on :root. Only the navbar menu links and
   *  dropdown items read it; the CTA button stays brand-colored and the
   *  hamburger keeps its auto-contrast. Each nav template references it
   *  as `var(--color-nav-text, <its own default>)`, so it's a no-op until
   *  the user picks a color — needed so a dark `nav_bg` can pair with
   *  light link text. */
  nav_text?: string;
  /** Heading font — applied as `--font-heading`. Stored as a full CSS
   *  font-family value with fallback (e.g. `'Montserrat', sans-serif`)
   *  so buildThemeCss can drop it into a `--font-heading:` declaration
   *  without further processing. Pick from FONT_PAIRS in the UI. */
  heading_font?: string;
  /** Body font — applied as `--font-body`. Same shape as heading_font. */
  body_font?: string;
  /** @deprecated kept only for reading legacy stored compositions */
  secondary?: string;
  /** @deprecated kept only for reading legacy stored compositions */
  text?: string;
}

/** Maps user-controllable theme keys → CSS custom property names. */
export const THEME_VAR_MAP: Partial<Record<keyof SiteTheme, string>> = {
  primary: "--color-primary",
  bg: "--color-bg",
  nav_bg: "--color-nav-bg",
  nav_text: "--color-nav-text",
  heading_font: "--font-heading",
  body_font: "--font-body",
};

/** Pretty labels for UI — only the user-controllable keys. */
export const THEME_LABELS: Partial<Record<keyof SiteTheme, string>> = {
  primary: "Primary",
  bg: "Background",
  nav_bg: "Navbar background",
  nav_text: "Navbar text",
  heading_font: "Heading font",
  body_font: "Body font",
};

/** Extract the bare font name from a CSS font-family value.
 *  `"'Montserrat', sans-serif"` → `"Montserrat"`. Used to derive the
 *  Google Fonts URL — we strip quotes and stop at the first comma. */
export function extractFontName(family: string | undefined): string {
  if (!family) return "";
  const m = family.match(/^\s*['"]?([^'",]+?)['"]?\s*(?:,|$)/);
  return m ? m[1].trim() : "";
}

/** Build the Google Fonts URL that should be injected into <head> so
 *  the theme's chosen heading + body fonts actually load. Returns null
 *  if no custom fonts are set (templates fall back to their bundled
 *  defaults via the template-base.css `:root` declarations). */
export function buildGoogleFontsUrl(
  theme: SiteTheme | undefined,
): string | null {
  if (!theme) return null;
  const headingName = extractFontName(theme.heading_font);
  const bodyName = extractFontName(theme.body_font);
  if (!headingName && !bodyName) return null;

  // Heading needs 4 weights (400/500/600/700) because templates use
  // various weights for h1/h2/buttons/eyebrows. Body needs fewer
  // (400/500/700 covers paragraph / emphasised / strong).
  const families: string[] = [];
  if (headingName) {
    families.push(`${headingName.replace(/ /g, "+")}:wght@400;500;600;700`);
  }
  // Only emit body if it's different from heading — saves bytes.
  if (bodyName && bodyName.toLowerCase() !== headingName.toLowerCase()) {
    families.push(`${bodyName.replace(/ /g, "+")}:wght@400;500;700`);
  }
  return `https://fonts.googleapis.com/css2?${families
    .map((f) => `family=${f}`)
    .join("&")}&display=swap`;
}

/** Build the `<link rel="stylesheet">` tag for Google Fonts. Empty
 *  string when no custom fonts are set. */
export function buildGoogleFontsLinkTag(
  theme: SiteTheme | undefined,
): string {
  const url = buildGoogleFontsUrl(theme);
  if (!url) return "";
  // preconnect tags + the actual stylesheet link. Preconnects parallelise
  // the DNS/TLS handshake while the stylesheet downloads.
  return [
    `<link rel="preconnect" href="https://fonts.googleapis.com">`,
    `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`,
    `<link rel="stylesheet" href="${url}">`,
  ].join("");
}

/** Build the inner CSS (`:root { --x: y; }` plus defensive font rules)
 *  from a theme. Empty if no overrides.
 *
 *  Beyond just setting CSS variables on :root, when font keys are set
 *  we ALSO emit explicit `body { font-family: var(--font-body); }` and
 *  `h1..h6 { font-family: var(--font-heading); }` rules. These live in
 *  the `<style data-sk-theme>` tag which the renderer places AFTER all
 *  template CSS, so they win the cascade against any per-template
 *  rule that might (intentionally or accidentally) override the body
 *  font of a nested description / paragraph element. Without these
 *  rules, only elements with `font-family: var(--font-heading)`
 *  explicitly written in the template's CSS responded to font
 *  changes — every description that relied on body inheritance kept
 *  its original font in some browsers / specificity contexts. */
export function buildThemeCss(theme: SiteTheme | undefined): string {
  if (!theme) return "";
  const decls: string[] = [];
  for (const k of Object.keys(THEME_VAR_MAP) as (keyof SiteTheme)[]) {
    const cssVar = THEME_VAR_MAP[k];
    if (!cssVar) continue;
    const v = theme[k];
    if (typeof v === "string" && v.trim()) {
      decls.push(`${cssVar}: ${v.trim()};`);
    }
  }
  if (decls.length === 0) return "";

  const rules: string[] = [`:root { ${decls.join(" ")} }`];

  // Explicitly re-bind body / heading font-families to the CSS variables
  // so a theme change always takes effect site-wide, not just on
  // elements whose template CSS explicitly references var(--font-*).
  if (typeof theme.body_font === "string" && theme.body_font.trim()) {
    rules.push(`body { font-family: var(--font-body); }`);
  }
  if (typeof theme.heading_font === "string" && theme.heading_font.trim()) {
    rules.push(
      `h1, h2, h3, h4, h5, h6 { font-family: var(--font-heading); }`,
    );
  }

  return rules.join(" ");
}

/** Build a `<style>:root{...}</style>` block from a theme. Empty if no overrides. */
export function buildThemeStyleTag(theme: SiteTheme | undefined): string {
  const css = buildThemeCss(theme);
  if (!css) return "";
  return `<style data-sk-theme>${css}</style>`;
}
