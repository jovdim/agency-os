/**
 * Navbar logo height stamping — single source of truth for the inline
 * `height: Npx !important` declaration applied to the `.logo` ancestor
 * of every `[data-field="nav_logo"]` image.
 *
 * Why this lives in its own module
 *   The same rule is applied in three places: server publish
 *   (render.ts via cheerio), browser preview rebuild (render-browser.ts
 *   via DOMParser), and live patch (skApplyBrandPatch's inline JS).
 *   The cheerio path lives here so render.ts stays focused on
 *   orchestration. The browser variants reimplement the logic locally
 *   (they can't import cheerio, and their iframe-injected JS can't
 *   import anything at all) but use the SAME selector + declaration
 *   shape so all three stay visually identical.
 *
 * Selector strategy
 *   1. Find every `<img data-field="nav_logo">`.
 *   2. Walk to closest `.logo` ancestor — that's the element whose
 *      height the template styles. The image inherits via the
 *      template's `.logo img { height: 100%; width: auto }` rule, so
 *      growing the ancestor grows the image.
 *   3. Fall back to the image element itself when no `.logo` ancestor
 *      exists (non-canonical templates). template-base.css carries
 *      `.nav-inner .logo img { height: 40px }`, so we need the inline
 *      override on the img directly to win in that fallback case.
 *
 * The `!important` is purely a mobile @media cap-buster — inline
 * already beats class on desktop without it, but the per-template
 * `@media (max-width: 800px) .logo { height: 40px }` rule would
 * otherwise out-specify the user's chosen height on phone-width
 * previews.
 */

import type { CheerioAPI } from "cheerio";
import { LOGO_HEIGHT_MAX_PX, LOGO_HEIGHT_MIN_PX } from "@/lib/composer/brand";

/**
 * Apply (or strip) the navbar logo height inline style on a cheerio-
 * parsed HTML fragment in place. No-op when heightPx is undefined, out
 * of range, or NaN — the caller should pass `composition.brand
 * ?.logo_height_px` directly without pre-filtering. Pass `null` to
 * actively strip any previously stamped height (rare at publish time —
 * mostly useful when reusing this helper from a patch path).
 */
export function applyNavLogoHeight(
  $: CheerioAPI,
  heightPx: number | null | undefined,
): void {
  // Bail when there's nothing meaningful to apply. undefined =
  // "template default wins" — same shape the publisher sees when the
  // user hasn't touched the slider.
  if (heightPx === undefined) return;
  const valid =
    typeof heightPx === "number" &&
    Number.isFinite(heightPx) &&
    heightPx >= LOGO_HEIGHT_MIN_PX &&
    heightPx <= LOGO_HEIGHT_MAX_PX;
  // null OR out-of-range → strip our prior declaration. We still walk
  // the DOM so a previously published height can be cleared by setting
  // it back to undefined in the composer (which the renderer turns
  // into a removed key, which the publisher reads as "no height").
  if (heightPx !== null && !valid) return;

  $('[data-field="nav_logo"]').each((_, raw) => {
    const $img = $(raw);
    // closest('.logo') reads up the ancestor chain including the
    // element itself; that's fine — if the img were itself marked
    // `.logo` (unconventional but possible) the height would land on
    // it directly. Falls back to the img element if no `.logo`
    // ancestor exists. cheerio's `.closest()` returns an empty
    // collection on a miss, hence the .length check.
    const $logo = $img.closest(".logo");
    const $target = $logo.length > 0 ? $logo : $img;

    const prev = $target.attr("style") || "";
    const stripped = prev
      .replace(/height\s*:[^;]+(!important)?\s*;?/gi, "")
      .replace(/;\s*;/g, ";")
      .replace(/^\s*;/, "")
      .replace(/;\s*$/, "");

    if (heightPx === null || !valid) {
      if (stripped) $target.attr("style", stripped);
      else $target.removeAttr("style");
      return;
    }
    const decl = `height: ${heightPx}px !important`;
    $target.attr("style", stripped ? `${stripped}; ${decl}` : decl);
  });
}
