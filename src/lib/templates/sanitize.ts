// Lightweight rich-text sanitizer. Pure (no deps).
//
// IMPORTANT: This module is imported as TS — its regex literals are evaluated
// in a normal JS lexical scope, so escape characters like \b mean word boundary.
// DO NOT inline this code inside a template literal in render-browser.ts —
// that would re-interpret \b as the backspace character (U+0008) and break
// the entire iframe <script> block. We've been burned by that once already.
//
// Whitelist:
//   tags: p, br, strong, b, em, i, u, a, ul, ol, li
//   <a> may only carry an `href` attribute (no target, rel, etc.)
// Strips:
//   - <script>…</script>, <style>…</style>
//   - on*="…" event handlers
//   - href="javascript:|data:|vbscript:" URIs
//   - any tag not in the whitelist (inner text preserved)
//   - any attribute on any tag (except `href` on `<a>`)
//
// HISTORY note (2026-05-16): a brief experiment added <span> + a constrained
// `style` attribute whitelist (color, font-size, background-color, text-align)
// to support a Quill-based rich text editor with a Word-style toolbar. The
// inline styles ended up overriding template typography wholesale in the
// preview iframe and published HTML, so we reverted to this minimal
// whitelist. Future rich-formatting features should map to template CSS
// variables, not raw inline styles.

const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "a",
  "ul",
  "ol",
  "li",
]);

export function sanitizeRichText(input: string): string {
  if (typeof input !== "string") return "";

  let html = input.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");
  html = html.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "");
  html = html.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");
  html = html.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");
  html = html.replace(
    /\s(href|src)\s*=\s*"\s*(javascript|data|vbscript):[^"]*"/gi,
    "",
  );
  html = html.replace(
    /\s(href|src)\s*=\s*'\s*(javascript|data|vbscript):[^']*'/gi,
    "",
  );

  return html.replace(
    /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g,
    (_match, slash: string, tagRaw: string, attrs: string) => {
      const tag = tagRaw.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) return "";

      if (slash === "/") return `</${tag}>`;

      if (tag === "a") {
        const hrefMatch =
          attrs.match(/href\s*=\s*"([^"]*)"/i) ||
          attrs.match(/href\s*=\s*'([^']*)'/i);
        if (hrefMatch) {
          const href = hrefMatch[1].trim();
          if (/^(javascript|data|vbscript):/i.test(href)) return "<a>";
          return `<a href="${escapeAttr(href)}">`;
        }
        return "<a>";
      }

      return `<${tag}>`;
    },
  );
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Strip TipTap's top-level <p> wrapper when the target field container
 * is NOT a <div>. TipTap emits every document as <p>…</p> (it has no
 * "plain inline" mode), so injecting a text-field value into a heading
 * lands as <h2><p>Title</p></h2>. The nested <p> then inherits any
 * `.ancestor p` rule from template-base.css (.split-text p, .section-head p,
 * .service-card p, .cta-band p — all override color/size/weight) and the
 * heading visually collapses to gray 1rem body text. Unwrapping at
 * render time restores the template's typography for every heading,
 * eyebrow, badge, list item, etc. — see the audit in
 * project_session_2026-05-20 for the full impact list (67/68 templates).
 *
 * Bail (return input unchanged) on anything that isn't a clean sequence
 * of top-level <p> elements — preserves any future richtext intent
 * (mixed lists, blockquotes) without mangling.
 *
 * Multi-paragraph input ("<p>a</p><p>b</p>") collapses to "a<br>b" so
 * pressing Enter inside a heading-style field doesn't structurally
 * break the heading (you can't have multiple <p> inside an <h2>).
 *
 * Empty input → "" (NOT "<p></p>").
 */
export function unwrapTipTapWrap(html: string): string {
  if (typeof html !== "string" || !html) return "";
  const trimmed = html.trim();
  if (!trimmed) return "";
  // Must consist solely of <p…>…</p> sequences with optional whitespace
  // between them. Allow attributes on <p> defensively even though
  // sanitizeRichText strips them (this helper is sometimes called
  // pre-sanitize on iframe-script paths). The non-greedy [\s\S]*?
  // matches against an anchored ^…+$ pattern so the engine can only
  // succeed if the ENTIRE string is p-wrapped — bails cleanly on
  // mixed content (e.g. <p>intro</p><ul>…</ul>) by failing the match.
  if (!/^(\s*<p[^>]*>[\s\S]*?<\/p>\s*)+$/.test(trimmed)) return html;
  const parts: string[] = [];
  trimmed.replace(/<p[^>]*>([\s\S]*?)<\/p>/g, (_match, inner: string) => {
    parts.push(inner);
    return "";
  });
  return parts.join("<br>");
}

/**
 * Strip all HTML tags from an HTML-shaped string and decode the common
 * named entities. Used when a field's value is HTML (text / longtext /
 * richtext all do now after the 2026-05-16 unification) but we need its
 * plain-text form: anchor-id slugify sources, nav-dropdown row labels,
 * AI-fill heuristics that compare titles by string equality.
 *
 * Trade-offs vs a real HTML parser:
 *   · Pure regex — no DOMParser dependency, runs the same in Node and
 *     the browser. Fast enough for the per-keystroke slug recomputation
 *     in the composer.
 *   · Entities: handles the half-dozen Quill / TipTap actually emits
 *     (`&amp; &lt; &gt; &quot; &#39; &nbsp;`). A rare exotic entity
 *     survives as its raw form — acceptable because the rich editor
 *     never emits exotic entities.
 *   · Whitespace: collapses runs of whitespace + trims, so a block-level
 *     tag boundary (`</p><p>`) doesn't become a literal newline that
 *     the caller has to scrub.
 */
export function htmlToPlainText(input: string): string {
  if (typeof input !== "string" || !input) return "";
  return input
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}
