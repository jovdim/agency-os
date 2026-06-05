/**
 * Pure SVG generators for the auto-brand logo + favicon.
 *
 * The Brand panel in the composer (theme-panel.tsx) feeds the user's
 * company text + the current theme primary color into these helpers,
 * gets back raw SVG strings, and embeds them as data URLs in nav/footer
 * `<img>` tags + the page <head> favicon. No file uploads, no DB writes,
 * no network calls — the logo recomputes synchronously every render
 * pass, so primary-color changes (theme dice 🎲) recolor the logo
 * instantly with zero latency.
 *
 * Visual reference: SAFI-STAV (erik website proposal/SAFI-STAV/images/logo.svg)
 *   - Rounded square icon on the left, brand color background, single
 *     letter in white sans-serif type
 *   - Company name to the right in matching sans-serif, dark text
 *   - Per Peter's spec: NO subtitle line, single letter only
 *
 * Font note: the logo SVG is loaded via `<img src="data:...">`, an
 * ISOLATED rendering context where the host page's Google/web fonts do
 * NOT apply — only system-installed fonts resolve. So the wordmark uses a
 * modern system-UI sans stack (see LOGO_FONT_FAMILY) that renders cleanly
 * on every OS and stays neutral enough to pair with any site we build.
 *
 * Pure module — no React, no DOM, no Supabase. Imported by both the
 * server renderer (render.ts) and the browser renderer (render-browser.ts).
 */

// Layout constants — tuned to match the SAFI-STAV proportions but
// without the subtitle row, so the icon vertically centers in a shorter
// 50px strip instead of 60px.
const ICON_SIZE = 40;
const ICON_RADIUS = 6;
const HEIGHT = 50;
const PADDING_X = 12; // gap between icon and name text
const NAME_FONT_SIZE = 22;
// Per-character width estimate for sizing the SVG viewBox. We use the
// WIDEST possible letter at 22px bold (W/M in Georgia ≈ 22px) as the
// per-char value, NOT an average. Why so generous: the SVG is loaded
// via `<img src="data:...">` which clips anything outside the viewBox —
// there is no "overflow: visible" escape hatch in img context. The cost
// of over-estimating is invisible trailing whitespace inside the SVG
// (transparent), which costs nothing visually. The cost of under-
// estimating is a cut-off company name, which the user has explicitly
// rejected. So we ALWAYS over-estimate to guarantee zero clipping at
// any text length. Short names will have empty trailing space inside
// the logo box; that's fine — the page background shows through, no
// visible artifact.
const NAME_AVG_CHAR_WIDTH = 22;
// Tail buffer for descender tails, accent marks on Slovak letters
// (Á/Č/Ď/Ľ/Ň/Š/Ť/Ž), and italic-style serif slants that can poke past
// the nominal advance width of the last glyph.
const NAME_END_BUFFER = 30;

// Font stack for the auto-logo wordmark + monogram. Because the SVG is
// loaded via `<img src="data:...">` (an isolated context with no access to
// the page's Google/web fonts), this MUST be a system-font stack — only
// fonts installed on the viewer's OS will render. This modern system-UI
// sans stack resolves to SF Pro (macOS/iOS), Segoe UI (Windows), Roboto
// (Android/ChromeOS), then Helvetica/Arial elsewhere — all clean, neutral
// sans-serifs that suit any industry without clashing with the body font.
// Single-quote names with spaces: the SVG attribute is double-quoted.
const LOGO_FONT_FAMILY =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

// Subtle negative tracking on the wordmark so it reads as an intentional,
// designed mark rather than default UI text. Negative only — it makes the
// text NARROWER than the (over-)estimated viewBox width, so it can never
// introduce clipping.
const NAME_LETTER_SPACING = -0.5;

/** Single hex color or any CSS color string the SVG runtime accepts. */
export interface LogoBuildOptions {
  /** Company name displayed next to the icon. Trimmed before render. */
  text: string;
  /** Brand color (hex) — fills the icon block. The single letter inside is
   *  auto-flipped to white or near-black for readability via WCAG luminance. */
  primaryColor: string;
}

export interface FaviconBuildOptions {
  /** Single character shown inside the rounded square. */
  letter: string;
  primaryColor: string;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Build the SAFI-STAV-style horizontal logo: rounded square + name.
 * Returns a self-contained SVG string sized to fit `text` without clipping.
 */
export function buildLogoSvg(options: LogoBuildOptions): string {
  const text = (options.text ?? "").trim() || "Logo";
  const primary = normalizeHex(options.primaryColor) || "#142733";
  const iconLetter = firstLetter(text);
  const letterFg = readableTextOn(primary);

  // Width = icon + padding + estimated text width + tail buffer.
  // The buffer protects against wide end-letters that exceed the average
  // (S, M, W, E render notably wider than mid-range letters).
  const estimatedTextWidth =
    Math.ceil(text.length * NAME_AVG_CHAR_WIDTH) + NAME_END_BUFFER;
  const width = ICON_SIZE + PADDING_X + estimatedTextWidth;

  // Y positions chosen so both the icon-letter and the name baseline visually
  // center within HEIGHT. Tweaked by eye against the SAFI-STAV reference.
  const iconY = (HEIGHT - ICON_SIZE) / 2; // 5 with 50/40
  const letterBaselineY = iconY + ICON_SIZE * 0.7; // ~33
  const iconLetterCenterX = ICON_SIZE / 2;
  const nameX = ICON_SIZE + PADDING_X;
  // Baseline so the name visually centers in HEIGHT. Empirical offset.
  const nameBaselineY = HEIGHT / 2 + NAME_FONT_SIZE * 0.36;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${HEIGHT}" width="${width}" height="${HEIGHT}">`,
    `<rect x="0" y="${iconY}" width="${ICON_SIZE}" height="${ICON_SIZE}" rx="${ICON_RADIUS}" fill="${escapeXml(primary)}"/>`,
    `<text x="${iconLetterCenterX}" y="${letterBaselineY}" font-family="${LOGO_FONT_FAMILY}" font-size="22" font-weight="700" text-anchor="middle" fill="${letterFg}">${escapeXml(iconLetter)}</text>`,
    `<text x="${nameX}" y="${nameBaselineY}" font-family="${LOGO_FONT_FAMILY}" font-size="${NAME_FONT_SIZE}" font-weight="700" letter-spacing="${NAME_LETTER_SPACING}" fill="#1c1917">${escapeXml(text)}</text>`,
    `</svg>`,
  ].join("");
}

/**
 * Build the favicon: same rounded-square icon block as the logo, scaled
 * up to a 64×64 square. Single letter centered. Used for the browser tab
 * + Apple touch icon when no explicit favicon is set in the SEO panel.
 */
export function buildFaviconSvg(options: FaviconBuildOptions): string {
  const primary = normalizeHex(options.primaryColor) || "#142733";
  const letter = firstLetter(options.letter ?? "");
  const fg = readableTextOn(primary);

  // 64×64 with 12px corner radius — matches the SAFI-STAV favicon.
  // Letter is positioned at y=44 with font-size=32 so it visually centers
  // in the rounded square (cap-height landing on the centerline).
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`,
    `<rect width="64" height="64" rx="12" fill="${escapeXml(primary)}"/>`,
    `<text x="32" y="44" font-family="${LOGO_FONT_FAMILY}" font-size="32" font-weight="700" text-anchor="middle" fill="${fg}">${escapeXml(letter)}</text>`,
    `</svg>`,
  ].join("");
}

/**
 * Encode an SVG string as a `data:image/svg+xml;...` URL safe to drop
 * into `<img src="...">` or `<link rel="icon" href="...">`.
 *
 * Uses base64 (not URL-encoding) for two reasons:
 *   - Survives every HTML escaping pass without further fix-ups.
 *   - Predictable length (4/3 of input) — easier to reason about page size.
 *
 * Works in both Node (Buffer) and browser (btoa) — both renderers import
 * this and we don't want a runtime branch per call site.
 */
export function svgToDataUrl(svg: string): string {
  // Trim because leading whitespace inside an SVG data URL has tripped
  // up at least one Outlook on Windows in the past — cheap defensive normalize.
  const normalized = svg.trim();
  return `data:image/svg+xml;base64,${toBase64(normalized)}`;
}

/**
 * Pick the first user-visible letter from a string. Skips leading
 * whitespace and falls back to "L" (for "Logo") on an empty input so
 * the favicon never renders as a blank square.
 *
 * Intentionally simple: takes the first code point only. Doesn't try to
 * handle grapheme clusters / emoji / RTL — Slovak business names are
 * Latin-script ASCII-extended, so keeping this trivial keeps it fast and
 * never wrong for the actual input domain.
 */
export function firstLetter(text: string): string {
  for (const ch of text ?? "") {
    if (/\S/.test(ch)) return ch.toUpperCase();
  }
  return "L";
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalize a possibly-shorthand or messy hex string to lowercase 6-char
 * `#rrggbb`. Returns null on bad input so callers can fall back to a
 * sensible default rather than emitting `fill="undefined"` into SVG.
 */
function normalizeHex(input: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((input ?? "").trim());
  if (!m) return null;
  let hex = m[1].toLowerCase();
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  return `#${hex}`;
}

/**
 * Pick a readable foreground (#fff or near-black) for a given background
 * via WCAG sRGB luminance. Mirrors the helper in crawl-files.ts (couldn't
 * import it without dragging in unrelated types). Tested independently to
 * stay in sync.
 */
function readableTextOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
  const lin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.5 ? "#0f172a" : "#ffffff";
}

/**
 * Cross-runtime base64 encoder. Node: Buffer. Browser: btoa with a
 * UTF-8 → binary-string bridge so non-ASCII characters (e.g. Slovak
 * accented letters in company names) don't throw `InvalidCharacterError`.
 */
function toBase64(input: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(input, "utf8").toString("base64");
  }
  if (typeof btoa !== "undefined") {
    // Encode UTF-8 first, then map each byte to a Latin-1 code point so
    // btoa accepts it. The TextEncoder path is safer than the legacy
    // unescape/encodeURIComponent trick.
    const bytes = new TextEncoder().encode(input);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
    return btoa(bin);
  }
  // Should never happen — both runtimes have one of the above.
  throw new Error("No base64 encoder available in this environment");
}

/**
 * Escape XML special chars for safe interpolation inside SVG attributes
 * + text nodes. Apostrophe included (we use double-quoted attrs so it's
 * not strictly needed there, but cheap insurance for text content).
 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
