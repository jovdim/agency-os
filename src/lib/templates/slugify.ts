import { htmlToPlainText } from "./sanitize";

/**
 * URL-safe anchor-id slug. Shared by:
 *   - The composer's editable section/item id chips (normalize on commit).
 *   - The server renderer (parser.ts Pass 4 + per-item id) when deriving
 *     ids from a source field.
 *   - The browser renderer (render-browser.ts) mirroring the same logic.
 *
 * The three call sites MUST produce byte-identical output, otherwise the
 * iframe preview and the published HTML drift apart and deep-links break.
 * Keep this function pure — no I/O, no locale-dependent ops — and don't
 * fork the implementation per call site.
 *
 * Rules (kept conservative for cross-browser URL-fragment safety):
 *   - Strip HTML tags + decode common entities FIRST. Field values now
 *     ship as HTML since the 2026-05-16 rich-editor unification, so a
 *     title stored as `<p>Title</p>` would otherwise slugify to
 *     `p-title-p` (the `p` characters from the tag survive the alnum
 *     filter). Same hazard for `<strong>` etc. inside the value.
 *   - Strip leading `#` (users sometimes paste full anchors)
 *   - Unicode NFKD decompose + strip combining diacritics
 *     (Slovak/Czech `š ž č ť ô` → `s z c t o`)
 *   - Lowercase
 *   - Replace any run of non-[a-z0-9-] with a single `-`
 *   - Collapse repeated `-`
 *   - Trim leading/trailing `-`
 */
export function slugifyAnchorId(input: string): string {
  if (!input) return "";
  return htmlToPlainText(input)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Page-scoped uniqueness for anchor ids. Two sections that share a
 * `defaultSectionId` (e.g. both services-01 and services-06 ship with
 * `id="sluzby"`) would render duplicate id attributes — invalid HTML
 * and breaks deep-linking because anchor navigation jumps to the FIRST
 * match only. This helper appends `-2`, `-3`, etc. to collisions, in
 * order, so the first section keeps the clean canonical id and later
 * ones get suffixed.
 *
 * Mutates `used` — the caller passes a single Set and reuses it across
 * every section on the page. Mirrors the existing per-item collision
 * logic in parser.ts:780-790 / render-browser.ts:1098-1108. Keep the
 * algorithms identical or the autocomplete (page-anchors.ts) will
 * suggest ids that don't match what the renderer actually emits.
 *
 * Empty input returns empty (sections without an id stay anchor-less).
 */
export function dedupeAnchorId(intended: string, used: Set<string>): string {
  if (!intended) return "";
  let final = intended;
  let n = 2;
  while (used.has(final)) {
    final = `${intended}-${n}`;
    n++;
  }
  used.add(final);
  return final;
}
