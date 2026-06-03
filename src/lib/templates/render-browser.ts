// Browser-safe rendering of a site composition. Mirrors src/lib/templates/render.ts
// but runs in the browser using DOMParser, so the composer can update its iframe
// preview synchronously from React state — no server roundtrip per edit.
//
// Uses the same data-field convention + content_overrides shape as the server
// renderer so client-preview and published output stay in sync.

import { buildGoogleFontsLinkTag, buildThemeStyleTag } from "./theme";
import { buildHeadMeta, mergePageSeo } from "./seo";
import { sanitizeRichText, unwrapTipTapWrap } from "./sanitize";
import { slugifyAnchorId, dedupeAnchorId } from "./slugify";
import {
  LOGO_HEIGHT_MAX_PX,
  LOGO_HEIGHT_MIN_PX,
  resolveBrand,
} from "@/lib/composer/brand";
import { withBrandContact } from "./brand-contact";
import { getCachedBlobUrl, isPendingUrl } from "@/lib/composer/image-store";

/**
 * Translate a `pending:xyz` image marker to its in-memory blob: URL,
 * or pass through unchanged. Used in the iframe-render path so the
 * preview can show images that are still mid-upload (sitting in
 * IndexedDB as a `pending:` token, not yet on Cloudflare). Without
 * this, `<img src="pending:xyz">` shows a broken-icon when the
 * iframe srcDoc rebuilds during structural changes — same path the
 * SK_PATCH_FIELD postMessage already uses via `translateValueForIframe`
 * in composer-client.tsx, just applied at render time too.
 *
 * Sync because the in-memory blob cache is sync (warmed by
 * `prefetchPendingBlobUrls` on mount). When a pending: URL hasn't
 * been warmed yet (rare race), returns the pending: marker as-is —
 * the eventual srcDoc rebuild after the cache fills paints correctly.
 */
function translatePendingImage(url: string | undefined): string {
  if (!url) return "";
  if (!isPendingUrl(url)) return url;
  return getCachedBlobUrl(url) ?? url;
}

/**
 * Browser-side mirror of nav-logo-height.ts's `applyNavLogoHeight`.
 *
 * Stamps `height: Npx !important` on the `.logo` ancestor of every
 * `[data-field="nav_logo"]` inside a freshly rendered nav fragment.
 * Used at structural rebuild time (when the iframe srcDoc is being
 * built from scratch); the surgical live-patch path lives inside
 * `skApplyBrandPatch` for keystroke-grade updates.
 *
 * Returns the patched HTML string. No-op (returns input unchanged)
 * when `heightPx` is undefined, NaN, or out of range — matches the
 * server-side helper byte-for-byte so the iframe preview and the
 * published page render the same height.
 */
function applyNavLogoHeightInBrowser(
  html: string,
  heightPx: number | null | undefined,
): string {
  if (heightPx === undefined) return html;
  const valid =
    typeof heightPx === "number" &&
    Number.isFinite(heightPx) &&
    heightPx >= LOGO_HEIGHT_MIN_PX &&
    heightPx <= LOGO_HEIGHT_MAX_PX;
  if (heightPx !== null && !valid) return html;

  // Wrap in a single root so DOMParser doesn't synthesize <html>/<body>
  // around fragments — we want the fragment back out, not a full doc.
  // `parseFromString` with `text/html` is the cheapest route in modern
  // browsers and is what applyOverridesInBrowser already uses.
  const parser = new DOMParser();
  const doc = parser.parseFromString(
    `<div id="__skroot__">${html}</div>`,
    "text/html",
  );
  const root = doc.getElementById("__skroot__");
  if (!root) return html;

  const imgs = root.querySelectorAll('[data-field="nav_logo"]');
  imgs.forEach((img) => {
    const target = (img.closest(".logo") ?? img) as HTMLElement;
    const prevStyle = target.getAttribute("style") || "";
    const stripped = prevStyle
      .replace(/height\s*:[^;]+(!important)?\s*;?/gi, "")
      .replace(/;\s*;/g, ";")
      .replace(/^\s*;/, "")
      .replace(/;\s*$/, "");
    if (heightPx === null || !valid) {
      if (stripped) target.setAttribute("style", stripped);
      else target.removeAttribute("style");
      return;
    }
    const decl = `height: ${heightPx}px !important`;
    target.setAttribute("style", stripped ? `${stripped}; ${decl}` : decl);
  });

  return root.innerHTML;
}
import type {
  CompositionSection,
  CompositionPage,
  SiteComposition,
} from "./render";
import type {
  PlaceholderSchema,
  FieldSchema,
  FieldValue,
} from "./parser";
import { buildPhoneHref, buildWhatsappHref, looksLikePhone } from "./parser";

/** Mirror of parser.ts `PHONE_FIELD_KEY_RE`. Kept duplicated so a tweak
 *  on one side is impossible to forget on the other — but the actual
 *  rewrite logic (`buildPhoneHref`) is imported from parser.ts so both
 *  call sites produce byte-identical hrefs. */
const PHONE_FIELD_KEY_RE = /phone|tel/i;
/** Mirror of parser.ts `WHATSAPP_FIELD_KEY_RE`. */
const WHATSAPP_FIELD_KEY_RE = /whatsapp/i;

// What the composer pre-loads for every template at startup.
export interface TemplateBody {
  id: string;
  category: string;
  name: string;
  html: string;
  css: string;
  schema: PlaceholderSchema;
  /** The section root element's `id` attribute (e.g. "hero", "services").
   *  The composer reads this to display the default anchor next to each
   *  section in the rail/card, and the renderer falls back to it when
   *  `content_overrides.__section_id` is not set. */
  defaultSectionId?: string | null;
}

export interface RenderClientOptions {
  baseCss: string;
  pagePath?: string;
  /** When false, omit composer-only chrome (section outlines, click/postMessage
   *  handlers, fade-up override). Use for the "Preview site" output so the
   *  HTML behaves like a real visitor's view. Default: true. */
  chrome?: boolean;
  /** Origin to resolve relative URLs against (e.g. `/_uploads/abc.png` from
   *  prior publishes). Without this, the iframe loads images from the dev
   *  server domain and 404s. Pass the site's published URL if it has one. */
  deploymentBaseUrl?: string;
}

/**
 * Render the active page of a composition into a full HTML document string,
 * suitable for `<iframe srcDoc={...}>`. Runs entirely in the browser.
 */
export function renderInBrowser(
  composition: SiteComposition,
  templates: Map<string, TemplateBody>,
  options: RenderClientOptions,
): string {
  const targetPath = options.pagePath ?? "index.html";
  const page: CompositionPage =
    composition.pages.find((p) => p.path === targetPath) ??
    composition.pages[0] ?? { path: "index.html", label: "Home", sections: [] };

  const wrapWithChrome = options.chrome !== false;
  const sectionHtmls: string[] = [];

  // ── Brand resolution ──
  // Same layering as the server renderer: composition.brand is the single
  // source of truth for the logo. We swap in the resolved URL as an
  // override on the conventional `nav_logo` / `footer_logo` field keys
  // so every nav/footer template renders the same logo without needing
  // any per-template setup. Auto mode regenerates the SVG inline on every
  // call — cheap (microseconds) and instantly reflects theme color changes.
  const resolvedBrand = resolveBrand(composition.brand, composition.theme, "");
  // Translate pending: → blob: URLs once for both nav + footer brand
  // injections. resolveBrand returns brand.custom_logo_url as-is when
  // brand mode === "custom"; if the user's brand upload is still
  // sitting in IndexedDB (`pending:abc`), the iframe `<img>` would
  // 404 on broken-icon. Same translation `translateValueForIframe`
  // does for SK_PATCH_FIELD postMessages — applied at render-time
  // here so the structural-rebuild path matches the patch path.
  // Bug Peter caught 2026-05-15: clicking "Reset to Brand" on a
  // footer that had its own upload triggered a srcDoc rebuild, which
  // re-injected the pending: brand URL straight into <img src>.
  const brandLogoForIframe = translatePendingImage(resolvedBrand.logoUrl);
  const navOverridesWithBrand = {
    ...(composition.shared?.nav_overrides ?? {}),
    // Nav always uses the brand logo — overwrites any stored value
    // (Brand panel is the single source of truth for navbar mark).
    nav_logo: brandLogoForIframe,
  };
  // Footer logo is FALLBACK semantics (Peter 2026-05-15): brand fills
  // only when no footer-specific logo has been uploaded. A non-empty
  // footer_overrides.footer_logo wins so techs can ship a different
  // mark in the footer than in the navbar (mirrors the same fallback
  // change in render.ts:withBrandLogo).
  const footerStored = composition.shared?.footer_overrides ?? {};
  const footerLogoExisting = footerStored.footer_logo;
  const footerLogoIsEmpty =
    footerLogoExisting === undefined ||
    footerLogoExisting === null ||
    (typeof footerLogoExisting === "string" &&
      footerLogoExisting.trim().length === 0);
  // When the footer has its OWN logo upload, translate THAT URL too —
  // it might also be pending: if the upload just landed and the user
  // clicked something that triggered a structural rebuild before the
  // SK_PATCH_FIELD path applied.
  const footerOverridesWithBrand = footerLogoIsEmpty
    ? { ...footerStored, footer_logo: brandLogoForIframe }
    : {
        ...footerStored,
        footer_logo:
          typeof footerLogoExisting === "string"
            ? translatePendingImage(footerLogoExisting)
            : footerLogoExisting,
      };

  // Shared nav
  if (composition.shared?.nav_template_id) {
    const tpl = templates.get(composition.shared.nav_template_id);
    if (tpl) {
      // Brand-contact override layer — site-wide phone/email/address
      // from composition.brand stamped onto matching field keys in
      // the nav schema. Same idea as the logo layering above; same
      // helper as the server renderer so composer preview = publish.
      const navWithBrandContact = withBrandContact(
        navOverridesWithBrand as Record<string, unknown>,
        tpl.schema as unknown as Parameters<typeof withBrandContact>[1],
        composition.brand,
      ) as Record<string, FieldValue>;
      const innerRaw = applyOverridesInBrowser(
        tpl.html,
        navWithBrandContact,
        tpl.schema,
        undefined, // no field_styles for nav slot
        composition.shared.nav_hidden_fields,
      );
      // Stamp the chosen navbar-logo height onto every `.logo` ancestor
      // of `nav_logo`. No-op when the user hasn't picked a custom size —
      // template defaults win unchanged. Same helper shape as the
      // server renderer's cheerio path so iframe preview matches publish.
      const inner = applyNavLogoHeightInBrowser(
        innerRaw,
        composition.brand?.logo_height_px,
      );
      sectionHtmls.push(wrapWithChrome ? wrapWithMarker("shared:nav", inner) : inner);
    }
  }

  // Page sections (sorted)
  // ── Section-id dedup pass ──
  // Same logic as render.ts: two sections sharing the same default
  // anchor id (e.g. two services-* variants both `id="sluzby"`) would
  // duplicate ids in the iframe — anchor links jump to the first match
  // only. Track emitted ids, suffix collisions with `-2`/`-3`, pre-seed
  // with the footer's default id so a custom section can't collide
  // with `#paticka`. Same algorithm as parser.ts per-item dedup,
  // sourced from slugify.ts:dedupeAnchorId.
  const usedSectionIds = new Set<string>();
  const footerTplForDedup = composition.shared?.footer_template_id
    ? templates.get(composition.shared.footer_template_id)
    : null;
  if (footerTplForDedup?.defaultSectionId) {
    usedSectionIds.add(footerTplForDedup.defaultSectionId);
  }
  const sorted = [...page.sections].sort((a, b) => a.order - b.order);
  for (const sec of sorted) {
    const tpl = templates.get(sec.template_id);
    if (!tpl) continue;
    const overrideRaw = (sec.content_overrides as Record<string, unknown> | undefined)?.__section_id;
    const overrideId =
      typeof overrideRaw === "string" ? slugifyAnchorId(overrideRaw) : "";
    const intendedId = overrideId || tpl.defaultSectionId || "";
    const finalId = dedupeAnchorId(intendedId, usedSectionIds);
    const effectiveOverrides: Record<string, FieldValue> = finalId
      ? {
          ...(sec.content_overrides ?? {}),
          __section_id: finalId as FieldValue,
        }
      : sec.content_overrides ?? {};
    const sectionWithBrandContact = withBrandContact(
      effectiveOverrides as Record<string, unknown>,
      tpl.schema as unknown as Parameters<typeof withBrandContact>[1],
      composition.brand,
    ) as Record<string, FieldValue>;
    const inner = applyOverridesInBrowser(
      tpl.html,
      sectionWithBrandContact,
      tpl.schema,
      sec.field_styles,
      sec.hidden_fields,
    );
    sectionHtmls.push(wrapWithChrome ? wrapWithMarker(sec.id, inner) : inner);
  }

  // Shared footer
  if (composition.shared?.footer_template_id) {
    const tpl = templates.get(composition.shared.footer_template_id);
    if (tpl) {
      const footerWithBrandContact = withBrandContact(
        footerOverridesWithBrand as Record<string, unknown>,
        tpl.schema as unknown as Parameters<typeof withBrandContact>[1],
        composition.brand,
      ) as Record<string, FieldValue>;
      const inner = applyOverridesInBrowser(
        tpl.html,
        footerWithBrandContact,
        tpl.schema,
        undefined, // no field_styles for footer slot
        composition.shared.footer_hidden_fields,
      );
      sectionHtmls.push(wrapWithChrome ? wrapWithMarker("shared:footer", inner) : inner);
    }
  }

  // Dedupe template CSS (one chunk per template id)
  const seenCss = new Set<string>();
  const cssChunks: string[] = [options.baseCss];
  const allUsedTplIds = new Set<string>();
  if (composition.shared?.nav_template_id)
    allUsedTplIds.add(composition.shared.nav_template_id);
  if (composition.shared?.footer_template_id)
    allUsedTplIds.add(composition.shared.footer_template_id);
  for (const sec of page.sections) allUsedTplIds.add(sec.template_id);
  for (const id of allUsedTplIds) {
    const t = templates.get(id);
    if (t?.css && !seenCss.has(id)) {
      seenCss.add(id);
      cssChunks.push(t.css);
    }
  }

  const chromeOn = options.chrome !== false;
  const composerStyles = chromeOn
    ? `<style>
    /* Composer-only: hover + selection visuals on each section. */
    [data-sk-section] {
      display: block !important;
      position: relative !important;
      /* When a section is scrolled-to via SK_SET_SELECTED, leave room for the
         sticky navbar so the section's top doesn't end up under it. */
      scroll-margin-top: 90px;
    }
    [data-sk-section]::after {
      content: '';
      position: absolute;
      inset: 0;
      pointer-events: none;
      box-sizing: border-box;
      border: 0 solid transparent;
      z-index: 2147483646;
      transition: border-width 80ms ease, border-color 80ms ease;
    }
    [data-sk-section]:hover {
      outline: 1.5px solid #2563eb !important;
      outline-offset: -1.5px;
      box-shadow: 0 0 0 1.5px #2563eb !important;
      cursor: pointer;
      z-index: 1;
    }
    [data-sk-section]:hover::after {
      border: 1.5px solid #2563eb;
    }
    [data-sk-section][data-sk-selected="true"] {
      outline: 1.5px solid #2563eb !important;
      outline-offset: -1.5px;
      box-shadow:
        0 0 0 1.5px #2563eb,
        0 0 0 5px rgba(37, 99, 235, 0.18) !important;
      z-index: 2;
    }
    [data-sk-section][data-sk-selected="true"]::after {
      border: 1.5px solid #2563eb;
    }
    /* Composer preview shows the FINAL state of every section. */
    .fade-up, .fade-left, .fade-right {
      opacity: 1 !important;
      transform: none !important;
    }
    body {
      padding: 2px !important;
      margin: 0 !important;
    }
    /* Navbar dominance: each section is wrapped in a [data-sk-section] div
       that's position:relative with no z-index, so it doesn't create a
       stacking context -- letting hero-inner (z:2) and our own outline
       pseudo (z:2147483646) escape to the document root and paint over the
       navbar's overflowing dropdown / mobile menu. Promote the navbar's
       wrapper to its own max-z stacking context so everything inside it
       (dropdown, mobile menu) wins unconditionally. */
    [data-sk-section]:has(.site-nav) {
      z-index: 2147483647 !important;
      isolation: isolate;
    }
    /* Field highlight: the right panel asks for an outline on the element
       that maps to the focused input. Amber so it reads as distinct from
       the blue section outlines. Outline (not border) means zero layout
       shift even on inline text nodes. */
    [data-field].sk-field-highlight {
      outline: 2px solid #f59e0b !important;
      outline-offset: 2px;
      border-radius: 1px;
      transition: outline-color 100ms ease;
    }
  </style>`
    : "";

  // <base href> — only the href form, never with target. A target="_blank"
  // base would route every click through a popup that the iframe sandbox
  // (no allow-popups) blocks with about:blank#blocked. The href form just
  // tells the browser how to resolve relative URLs (like /_uploads/abc.png
  // from a prior publish) so images stored as relative paths load from the
  // deployment domain instead of the dev server.
  const baseTag = options.deploymentBaseUrl
    ? `<base href="${options.deploymentBaseUrl.replace(/[<>"']/g, "")}/">`
    : "";

  // SEO meta — same engine as the published page so what you see in the
  // composer preview matches the live site's <title>, OG tags, etc. We
  // pass a placeholder siteName since the browser renderer doesn't have
  // the DB site row; falls back to "Website" if seo.title is empty.
  // siteUrl lets buildHeadMeta resolve `/_uploads/...` og:image paths to
  // absolute URLs in the preview HTML — purely cosmetic here (the iframe
  // doesn't get crawled), but keeps preview vs. live in sync.
  //
  // Favicon precedence: explicit SEO panel choice wins, otherwise the
  // brand favicon flows through. Patching seo here (vs. in buildHeadMeta)
  // keeps that helper focused on emission, not policy.
  // Per-page SEO merged over the site defaults, so the preview's <title>
  // / description reflect the page being viewed (parity with publish).
  const mergedPageSeo = mergePageSeo(composition.seo, page.seo);
  const seoWithBrandFavicon = {
    ...mergedPageSeo,
    favicon_url: mergedPageSeo.favicon_url || resolvedBrand.faviconUrl,
  };
  const headMeta = buildHeadMeta(seoWithBrandFavicon, {
    siteName: composition.seo?.title ?? "Website",
    siteUrl: options.deploymentBaseUrl,
    // Brand for LocalBusiness JSON-LD. In composer preview the
    // siteUrl gate prevents the schema from emitting (and there's
    // no preview value in showing it), but we pass the brand so
    // future preview surfaces can use the same buildHeadMeta call.
    brand: composition.brand,
    brandLogoUrl: resolvedBrand.logoUrl,
  });

  // Initial font load — derived from the current theme.heading_font /
  // body_font. When the user picks a different font in the Theme panel,
  // composer-client.tsx sends an SK_PATCH_FONTS message that replaces
  // the [data-sk-fonts] <link> below with the new URL (see iframe
  // script further down). Default fallback (Space Grotesk + DM Sans)
  // covers sites that don't have a font theme set.
  const themeFontsHref = buildGoogleFontsLinkTag(composition.theme);
  const initialFontsTag = themeFontsHref
    ? // Tag the link so the SK_PATCH_FONTS handler can find + update it.
      themeFontsHref.replace(
        '<link rel="stylesheet" href="',
        '<link data-sk-fonts rel="stylesheet" href="',
      )
    : `<link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link data-sk-fonts rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:wght@400;500;700&display=swap">`;

  return `<!DOCTYPE html>
<html lang="sk">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${baseTag}
  ${headMeta}
  ${initialFontsTag}
  <style>${cssChunks.filter(Boolean).join("\n\n")}</style>
  ${composerStyles}
  ${buildThemeStyleTag(composition.theme)}
</head>
<body>
${sectionHtmls.join("\n\n")}
${chromeOn ? `<script>
  // Preview-only: block link clicks, post selection up to parent on any click,
  // and accept SK_SET_SELECTED messages from the parent to highlight the matching section.

  // Defensive link neutralizer.
  // preventDefault on click should be enough, but some browsers still
  // flicker the URL to about:blank#blocked when a sandboxed iframe tries
  // to navigate to an absolute href. Strip non-navigation hrefs entirely
  // so there is nothing for the browser to attempt. Hash anchors,
  // tel:, and mailto: keep their hrefs because the click handler below
  // uses them. Original href is stashed on data-sk-href so it survives.
  function skIsSafeHref(h) {
    if (!h) return true;
    var c = h.charAt(0);
    if (c === '#') return true;
    if (h.indexOf('tel:') === 0) return true;
    if (h.indexOf('mailto:') === 0) return true;
    return false;
  }
  function skNeutralizeLinks() {
    var links = document.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var h = a.getAttribute('href') || '';
      if (!skIsSafeHref(h)) {
        a.setAttribute('data-sk-href', h);
        a.removeAttribute('href');
        a.style.cursor = 'default';
      }
    }
  }
  skNeutralizeLinks();

  document.addEventListener('click', function (e) {
    var t = e.target;
    var section = t && t.closest ? t.closest('[data-sk-section]') : null;
    var link = t && t.closest ? t.closest('a') : null;
    // Block navigation but DO NOT stopPropagation — templates (e.g. nav dropdowns)
    // attach their own click handlers and need the event to keep bubbling.
    if (link) {
      e.preventDefault();
      // Dropdown triggers (aria-haspopup="true") aren't real destinations --
      // their job is to open the dropdown so the user picks a child item.
      // Without this skip, clicking "Services" in nav-01 would still scroll
      // to #services because we'd run scrollIntoView ourselves even though
      // the template's own click handler called preventDefault.
      var isDropdownTrigger =
        link.getAttribute('aria-haspopup') === 'true' ||
        (link.parentElement && link.parentElement.classList &&
         link.parentElement.classList.contains('has-dropdown'));
      if (!isDropdownTrigger) {
        // If it's a hash-anchor link (#services, #about, etc.), do the
        // same-page scroll we suppressed by preventDefault'ing — so nav
        // dropdowns and inline anchors still feel right in the preview.
        var href = link.getAttribute('href') || '';
        if (href.charAt(0) === '#' && href.length > 1) {
          var id = href.slice(1);
          var target = null;
          try {
            target = document.getElementById(id) ||
              document.querySelector('[data-section="' + id + '"]') ||
              document.querySelector('section[id="' + id + '"]');
          } catch (_) {}
          if (target && target.scrollIntoView) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      }
    }
    if (section) {
      try {
        parent.postMessage({
          type: 'SK_SELECT_SECTION',
          id: section.getAttribute('data-sk-section')
        }, '*');
      } catch (_) {}
    }
  }, true);
  document.addEventListener('submit', function (e) { e.preventDefault(); }, true);

  function skEscape(s) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
  }

  // Mirror of unwrapTipTapWrap in src/lib/templates/sanitize.ts. Inlined
  // here (not imported) because this whole block ships into the iframe
  // as a string-serialized script and can't reach the module imports.
  // No regex literals -- character-code comparison avoids the iframe
  // template-literal escape trap (see memory feedback_iframe_script_trap).
  // Returns input unchanged if it isn't a clean sequence of top-level
  // <p> elements; otherwise returns the concatenated inner HTML joined
  // by <br>. Empty input → "".
  function skUnwrapTipTapWrap(html) {
    if (typeof html !== 'string' || !html) return '';
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    var nodes = tmp.childNodes;
    var hasP = false;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.nodeType === 3) {
        var t = n.nodeValue || '';
        for (var k = 0; k < t.length; k++) {
          // > 32 → any non-whitespace ASCII (tab=9, LF=10, CR=13, space=32).
          if (t.charCodeAt(k) > 32) return html;
        }
        continue;
      }
      if (n.nodeType === 1) {
        if (n.tagName !== 'P') return html;
        hasP = true;
        continue;
      }
      return html;
    }
    if (!hasP) return html;
    var parts = [];
    for (var j = 0; j < tmp.children.length; j++) {
      if (tmp.children[j].tagName === 'P') parts.push(tmp.children[j].innerHTML);
    }
    return parts.join('<br>');
  }

  // Surgically apply a font-size override to one [data-field] element
  // without rebuilding the iframe. Mirrors the inline-style logic in
  // applyOverridesInBrowser Pass 3. When sizePx is null/undefined or
  // out of range, the existing inline font-size is stripped (template
  // default wins). Uses !important to beat template CSS rules that
  // target the same element with higher specificity (e.g. .hero h1).
  //
  // Why this exists separately from skApplyFieldPatch: that one
  // handles VALUE (text/href/src) updates; this one handles STYLE
  // updates. Splitting them means SizeControls clicks don't go
  // through the value-patcher (which would touch textContent and
  // wipe the user's text mid-typing).
  function skApplyFieldStylePatch(sectionId, fieldKey, sizePx, widthPx, fill) {
    var section = document.querySelector(
      '[data-sk-section="' + skEscape(String(sectionId)) + '"]'
    );
    if (!section) return;
    var el = section.querySelector(
      '[data-field="' + skEscape(String(fieldKey)) + '"]'
    );
    if (!el) return;
    // Strip ALL prior inline declarations we own (font-size + max-width)
    // FIRST so toggling between values doesn't leave a stale declaration
    // concatenated to the style attr. Each is stripped independently so
    // a clear-size patch doesn't accidentally clear width. data-fill is
    // attribute-toggled separately (the CSS rule in template-base.css
    // does the layout work — no inline styles owned by fill).
    var existing = el.getAttribute('style') || '';
    var stripped = existing
      .replace(/font-size\s*:[^;]+(!important)?\s*;?/gi, '')
      .replace(/max-width\s*:[^;]+(!important)?\s*;?/gi, '')
      .replace(/;\s*;/g, ';')
      .replace(/^\s*;/, '')
      .replace(/;\s*$/, '');
    var declarations = [];
    var sPx = typeof sizePx === 'number' && isFinite(sizePx) ? sizePx : null;
    if (sPx !== null && sPx >= 8 && sPx <= 200) {
      // No !important here (matches the server-side stamp). Inline
      // wins over class-level CSS by specificity anyway; mobile
      // !important @media rules can now cap the size on phones.
      // See parser.ts:1222 + render-browser.ts:1361 for the same fix.
      declarations.push('font-size: ' + sPx + 'px');
    }
    // fill === true takes priority over width — set data-fill, skip the
    // max-width declaration. Otherwise remove data-fill and honor width.
    if (fill === true) {
      el.setAttribute('data-fill', 'true');
    } else {
      el.removeAttribute('data-fill');
      var wPx = typeof widthPx === 'number' && isFinite(widthPx) ? widthPx : null;
      if (wPx !== null && wPx >= 240 && wPx <= 1400) {
        declarations.push('max-width: ' + wPx + 'px !important');
      }
    }
    if (declarations.length === 0) {
      if (stripped) el.setAttribute('style', stripped);
      else el.removeAttribute('style');
      return;
    }
    var joined = declarations.join('; ');
    el.setAttribute(
      'style',
      stripped ? stripped + '; ' + joined : joined
    );
  }

  function skApplyFieldPatch(sectionId, fieldKey, fieldType, value) {
    var section = document.querySelector('[data-sk-section="' + skEscape(sectionId) + '"]');
    if (!section) return;
    // querySelectorAll, not querySelector — some templates (map-02 /
    // map-03 / nav-dropdown-mirror) attach the SAME data-field to
    // multiple elements (a text card AND the map iframe, or a link
    // label AND its dropdown row). The publish-time cheerio renderer
    // already handles this via .each(); the live patch path must
    // mirror that, otherwise typing the address only moves the text
    // card and the iframe stays pointing at the template default.
    var allEls = section.querySelectorAll('[data-field="' + skEscape(fieldKey) + '"]');
    if (allEls.length === 0) return;
    for (var elIdx = 0; elIdx < allEls.length; elIdx++) {
    var el = allEls[elIdx];
    if (fieldType === 'image') {
      // Empty string is a deliberate clear (MediaGroupField's mutual
      // exclusion path wipes the image field when a video is uploaded).
      // Strip src/srcset so the gallery script's isPlaceholder check
      // fires and auto-thumbnail takes over. The previous early return
      // on !v kept the stale image visible after a video upload.
      var v = typeof value === 'string' ? value : '';
      if (el.tagName === 'IMG' || el.tagName === 'IFRAME') {
        if (v) {
          el.src = v;
        } else {
          el.removeAttribute('src');
        }
        if (el.tagName === 'IMG') el.removeAttribute('srcset');
      } else if (v) {
        var style = el.getAttribute('style') || '';
        var replaced = style.replace(/background-image:\s*url\([^)]+\)/i, "background-image: url('" + v + "')");
        el.setAttribute('style', replaced !== style ? replaced : (style ? style.replace(/;?\s*$/, '; ') : '') + "background-image: url('" + v + "')");
      }
    } else if (fieldType === 'video') {
      // Mirrors parser.ts's video case. <video>/<source>: set src for
      // inline players. Any other element (e.g. the hidden <span> data
      // carrier gallery-04 uses to drive its lightbox script): write
      // the URL into textContent so a MutationObserver on the carrier
      // can re-run the gallery's has-video / auto-thumbnail logic.
      var vv = typeof value === 'string' ? value : '';
      if (el.tagName === 'VIDEO' || el.tagName === 'SOURCE') {
        if (vv) el.src = vv; else el.removeAttribute('src');
      } else {
        el.textContent = vv;
      }
    } else if (fieldType === 'link') {
      if (value && typeof value === 'object') {
        // Icon-only links (social pills, phone-call widget, whatsapp
        // widget) wrap an SVG with no visible text. Writing textContent
        // would destroy the SVG and replace it with the label string,
        // so the icon disappears on first edit. Detect via a direct
        // SVG child and skip the textContent write.
        var hasSvg = !!el.querySelector(':scope > svg');
        if (typeof value.label === 'string' && !hasSvg) el.textContent = value.label;
        if (typeof value.href === 'string') {
          // Same neutralization rule as on initial load — keep hash /
          // tel: / mailto: live, stash anything else on data-sk-href so
          // the preview doesn't try to navigate.
          if (skIsSafeHref(value.href)) {
            el.setAttribute('href', value.href);
            el.removeAttribute('data-sk-href');
            el.style.cursor = '';
          } else {
            el.setAttribute('data-sk-href', value.href);
            el.removeAttribute('href');
            el.style.cursor = 'default';
          }
        }
      } else if (typeof value === 'string') {
        el.textContent = value;
      }
    } else if (fieldType === 'richtext') {
      // Trusts the value to be pre-sanitized by the parent. No regex, no
      // template-literal escape gymnastics, no chance of breaking the script.
      // Non-div targets (rare for richtext but possible) get TipTap's
      // <p> wrapper stripped via skUnwrapTipTapWrap.
      var rtVal = typeof value === 'string' ? value : '';
      var rtTag = el.tagName.toLowerCase();
      el.innerHTML = rtTag === 'div' ? rtVal : skUnwrapTipTapWrap(rtVal);
    } else {
      // text / longtext / map — the map case is detected by the element's
      // own data-type="map" attribute. Three string formats supported:
      //   1. Full URL (https://…) → used directly (rich Google embed)
      //   2. address / coordinates → wrapped in q= for the simple embed
      var textVal = typeof value === 'string' ? value : '';
      if (el.tagName === 'IFRAME' && (el.getAttribute('data-type') || '').toLowerCase() === 'map') {
        // Backslash-heavy regex literals do NOT survive being inside a TS
        // template-literal — single-backslash escapes (s and slash) get
        // stripped at compile time, emitting plain s and slash into the
        // iframe and producing a fatal SyntaxError that killed the whole
        // chrome script. Use plain String trim + indexOf instead — same
        // logic, zero escape traps.
        var trimmed = textVal.trim();
        var lower = trimmed.toLowerCase();
        if (lower.indexOf('http://') === 0 || lower.indexOf('https://') === 0) {
          el.src = trimmed;
        } else {
          el.src = 'https://maps.google.com/maps?q=' + encodeURIComponent(textVal) + '&t=&z=15&ie=UTF8&iwloc=B&output=embed';
        }
      } else {
        // text + longtext: the composer routes these through the same
        // rich editor as richtext (2026-05-16). The parent already
        // sanitized the HTML before sending the patch. innerHTML keeps
        // inline marks (bold, italic, underline, link, lists) visible
        // on the live patch path. Plain-text values render identically,
        // since innerHTML on a string with no tags just sets a text node.
        //
        // Non-<div> targets (h1-h6, span, strong, em, li, a, p, ...)
        // get TipTap's <p> wrapper stripped — without this the generic
        // .ancestor p rules in template-base.css override headings.
        // (NO backticks in this comment block -- it lives inside an outer
        // JS template literal that ships to the iframe; stray backticks
        // close the literal and break the build. See memory
        // feedback_iframe_script_trap.)
        var tagLc = el.tagName.toLowerCase();
        el.innerHTML = tagLc === 'div' ? textVal : skUnwrapTipTapWrap(textVal);
      }
    }
    } // end for elIdx
  }

  // In-place patch for a single field within a single repeater item.
  // Targets the Nth child of [data-repeat="<repeaterKey>"] inside the
  // section, then finds [data-field="<fieldKey>"] within that child and
  // applies the value with the same per-type rules as skApplyFieldPatch.
  // Lets the composer keep typing into a nav-link label without bumping
  // publishVersion (which would re-render the iframe and flicker).
  function skApplyRepeaterItemPatch(
    sectionId, repeaterKey, itemIndex, fieldKey, fieldType, value
  ) {
    var section = document.querySelector('[data-sk-section="' + skEscape(sectionId) + '"]');
    if (!section) return;
    var container = section.querySelector('[data-repeat="' + skEscape(repeaterKey) + '"]');
    if (!container) return;
    var item = container.children[itemIndex];
    if (!item) return;
    // querySelector walks descendants only -- so if data-field lives on
    // the item ROOT element (e.g. how-it-works-01 puts step_image on the
    // article card with background-image inline style), the descendant
    // lookup misses it and the live patch silently no-ops, leaving the
    // iframe stale until a full srcDoc re-render. Falling back to the
    // item element itself when its own data-field matches fixes that
    // without affecting items that carry the field on a descendant.
    // (NO backticks in these comments -- this whole function body is
    // embedded inside an outer JS template literal that ships to the
    // iframe; stray backticks close the literal and break the build.
    // See memory: feedback_iframe_script_trap.)
    var el = item.querySelector('[data-field="' + skEscape(fieldKey) + '"]');
    if (!el && item.getAttribute('data-field') === fieldKey) el = item;
    if (!el) return;
    // Apply with the same rules as the flat patch path. Dispatching by
    // type rather than re-implementing keeps the two paths in lock-step.
    if (fieldType === 'image') {
      // Same empty-string-clears-src rule as skApplyFieldPatch above.
      var v = typeof value === 'string' ? value : '';
      if (el.tagName === 'IMG' || el.tagName === 'IFRAME') {
        if (v) {
          el.src = v;
        } else {
          el.removeAttribute('src');
        }
        if (el.tagName === 'IMG') el.removeAttribute('srcset');
      } else if (v) {
        var style = el.getAttribute('style') || '';
        var replaced = style.replace(/background-image:\s*url\([^)]+\)/i, "background-image: url('" + v + "')");
        el.setAttribute('style', replaced !== style ? replaced : (style ? style.replace(/;?\s*$/, '; ') : '') + "background-image: url('" + v + "')");
      }
    } else if (fieldType === 'video') {
      // <video>/<source>: set src. Else (span data carrier): textContent.
      // The gallery-04 script's MutationObserver listens for both.
      var vv = typeof value === 'string' ? value : '';
      if (el.tagName === 'VIDEO' || el.tagName === 'SOURCE') {
        if (vv) el.src = vv; else el.removeAttribute('src');
      } else {
        el.textContent = vv;
      }
    } else if (fieldType === 'link') {
      if (value && typeof value === 'object') {
        // Mirror of the per-field PATCH path above — skip textContent
        // for icon-only links (SVG child) so social / phone / whatsapp
        // widget icons survive in-place edits.
        var hasSvg = !!el.querySelector(':scope > svg');
        if (typeof value.label === 'string' && !hasSvg) el.textContent = value.label;
        if (typeof value.href === 'string') {
          if (skIsSafeHref(value.href)) {
            el.setAttribute('href', value.href);
            el.removeAttribute('data-sk-href');
            el.style.cursor = '';
          } else {
            el.setAttribute('data-sk-href', value.href);
            el.removeAttribute('href');
            el.style.cursor = 'default';
          }
        }
      } else if (typeof value === 'string') {
        el.textContent = value;
      }
    } else if (fieldType === 'richtext') {
      var rtVal = typeof value === 'string' ? value : '';
      var rtTag = el.tagName.toLowerCase();
      el.innerHTML = rtTag === 'div' ? rtVal : skUnwrapTipTapWrap(rtVal);
    } else {
      // Same three-format dispatch as skApplyFieldPatch above.
      var textVal = typeof value === 'string' ? value : '';
      if (el.tagName === 'IFRAME' && (el.getAttribute('data-type') || '').toLowerCase() === 'map') {
        // Backslash-heavy regex literals do NOT survive being inside a TS
        // template-literal — single-backslash escapes (s and slash) get
        // stripped at compile time, emitting plain s and slash into the
        // iframe and producing a fatal SyntaxError that killed the whole
        // chrome script. Use plain String trim + indexOf instead — same
        // logic, zero escape traps.
        var trimmed = textVal.trim();
        var lower = trimmed.toLowerCase();
        if (lower.indexOf('http://') === 0 || lower.indexOf('https://') === 0) {
          el.src = trimmed;
        } else {
          el.src = 'https://maps.google.com/maps?q=' + encodeURIComponent(textVal) + '&t=&z=15&ie=UTF8&iwloc=B&output=embed';
        }
      } else {
        // text + longtext repeater item patches — value already sanitized
        // by the composer's onChange. innerHTML keeps inline formatting
        // (bold/italic/etc.) consistent with the richtext branch above.
        // Non-<div> targets get TipTap's <p> wrapper stripped — same
        // reasoning as skApplyFieldPatch above. Critical for repeater
        // items like service titles (h3) and nav-link labels (span/a).
        var tagLc = el.tagName.toLowerCase();
        el.innerHTML = tagLc === 'div' ? textVal : skUnwrapTipTapWrap(textVal);
      }
    }
    // Keep a featured "mirror" image (data-sk-mirror-repeater) in sync when
    // the FIRST item's mirrored field changes live — mirrors the server-side
    // mirror pass so gallery-05's big stage updates without a full srcDoc
    // rebuild. Plain string ops only (no regex/backticks): this whole body
    // is embedded in an outer JS template literal. See feedback_iframe_script_trap.
    if (itemIndex === 0 && fieldType === 'image') {
      var mirrors = section.querySelectorAll('[data-sk-mirror-repeater="' + skEscape(repeaterKey) + '"]');
      for (var mIdx = 0; mIdx < mirrors.length; mIdx++) {
        var mEl = mirrors[mIdx];
        var mField = mEl.getAttribute('data-sk-mirror-field') || 'image';
        if (mField === fieldKey && mEl.tagName === 'IMG') {
          var mVal = typeof value === 'string' ? value : '';
          if (mVal) mEl.src = mVal;
        }
      }
    }
  }

  // Auto-synced dropdown patch — composer sends this whenever a
  // source section (e.g. services) changes in a way that affects an
  // auto-syncing nav menu item: title edits, per-item id edits,
  // add/remove/reorder. Replaces the menu items dropdown contents
  // wholesale with the derived list so the iframe shows the new
  // labels + hrefs instantly. Without this, the iframe would have to
  // do a full srcDoc rebuild every keystroke (jank) or wait until the
  // next structural change to refresh (stale).
  function skApplyAutoSyncedDropdown(sectionId, repeaterKey, navMenuItemIndex, derivedItems) {
    var navSection = document.querySelector('[data-sk-section="' + skEscape(sectionId) + '"]');
    if (!navSection) return;
    var container = navSection.querySelector('[data-repeat="' + skEscape(repeaterKey) + '"]');
    if (!container) return;
    var menuItem = container.children[navMenuItemIndex];
    if (!menuItem) return;
    var dropdown = null;
    for (var c = 0; c < menuItem.children.length; c++) {
      var child = menuItem.children[c];
      if (child.classList && child.classList.contains('dropdown')) {
        dropdown = child;
        break;
      }
    }
    if (!dropdown) return;
    var html = '';
    for (var i = 0; i < derivedItems.length; i++) {
      var it = derivedItems[i] || {};
      var label = String(it.label == null ? '' : it.label);
      var href = String(it.href == null ? '' : it.href);
      // Attribute-escape href, text-escape label. Both fields are
      // user input so we cannot trust them — skEscape converts the
      // characters that break HTML parsing.
      html += '<li><a data-field="label" data-type="link" href="' +
        skEscape(href) + '">' + skEscape(label) + '</a></li>';
    }
    dropdown.innerHTML = html;
  }

  // Per-item anchor id patch — surgically updates the id attribute on
  // the [data-item-id-source] element inside the Nth child of a
  // repeater. Composer sends this whenever the source field changes
  // (auto-id re-derives from new title) or the user commits a new
  // value on the per-item id chip. Without this, the iframe rendered
  // ids stay frozen at the value baked into the last full srcDoc build
  // and the only way to see the new id is to publish + reload.
  function skApplyItemIdPatch(sectionId, repeaterKey, itemIndex, newId) {
    var section = document.querySelector('[data-sk-section="' + skEscape(sectionId) + '"]');
    if (!section) return;
    var container = section.querySelector('[data-repeat="' + skEscape(repeaterKey) + '"]');
    if (!container) return;
    var item = container.children[itemIndex];
    if (!item) return;
    // The id-bearing element can be the item itself OR a descendant —
    // the template author picks by placing data-item-id-source on
    // whichever wrapper they want anchored.
    var idEl = item.hasAttribute('data-item-id-source')
      ? item
      : item.querySelector('[data-item-id-source]');
    if (!idEl) return;
    if (typeof newId === 'string' && newId) {
      idEl.setAttribute('id', newId);
    } else {
      idEl.removeAttribute('id');
    }
  }

  function skApplyThemePatch(css) {
    var styleEl = document.querySelector('style[data-sk-theme]');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.setAttribute('data-sk-theme', '');
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = css || '';
  }

  // Fonts patch — swap the [data-sk-fonts] <link> href to point at a
  // new Google Fonts URL. The new font downloads in the background;
  // the CSS variable update that arrived alongside this patch already
  // re-binds elements to the new font-family name, so they re-render
  // as soon as the font finishes loading. Browser caches subsequent
  // hits to the same font instantly.
  function skApplyFontsPatch(linkHref) {
    var link = document.querySelector('link[data-sk-fonts]');
    if (!link) {
      link = document.createElement('link');
      link.setAttribute('data-sk-fonts', '');
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    if (linkHref) link.href = linkHref;
  }

  // Brand patch — drop in a new logo URL across every nav/footer logo
  // slot + the page favicon link, without rebuilding the iframe. Lets
  // the Brand panel's text input + the primary color dice both feel
  // instant: the auto-generated SVG is computed in the parent (cheap),
  // shipped as a data URL, and applied here in a few DOM writes.
  // Without this, every keystroke or dice click would queue a full
  // iframe rebuild (publishVersion bump) and the preview would blink.
  function skApplyBrandPatch(logoUrl, faviconUrl, logoHeightPx) {
    if (logoUrl) {
      // Both nav_logo and footer_logo are conventional field keys
      // shared by every nav/footer template — single selector covers
      // all of them. Background-image fallback for the rare case where
      // a template uses a div+CSS instead of an <img>.
      var els = document.querySelectorAll(
        '[data-field="nav_logo"], [data-field="footer_logo"]'
      );
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.tagName === 'IMG') {
          el.src = logoUrl;
          el.removeAttribute('srcset');
        } else {
          var style = el.getAttribute('style') || '';
          var replaced = style.replace(
            /background-image:\s*url\([^)]+\)/i,
            "background-image: url('" + logoUrl + "')"
          );
          el.setAttribute(
            'style',
            replaced !== style
              ? replaced
              : (style ? style.replace(/;?\s*$/, '; ') : '') +
                  "background-image: url('" + logoUrl + "')"
          );
        }
      }
    }
    if (faviconUrl) {
      var iconLink = document.querySelector('link[rel="icon"]');
      if (!iconLink) {
        iconLink = document.createElement('link');
        iconLink.setAttribute('rel', 'icon');
        document.head.appendChild(iconLink);
      }
      iconLink.setAttribute('href', faviconUrl);
    }
    // Navbar logo height: stamp height in CSS pixels on the .logo
    // ancestor of every nav_logo image. Templates carry .logo img with
    // height 100% width auto, so growing the ancestor grows the image
    // and the entire navbar around it (.nav-inner has no fixed height,
    // just padding).
    //
    //   logoHeightPx === undefined : no change (brand patches that only
    //                                touch logo URL or favicon must not
    //                                disturb the height).
    //   logoHeightPx === null      : clear override; .logo returns to
    //                                its template-default height.
    //   typeof === 'number'        : set inline height-in-px-!important
    //                                on .logo (the !important is purely
    //                                the mobile media-query cap-buster;
    //                                inline beats class on desktop
    //                                without it).
    //
    // Footer is intentionally NOT included — Peter scoped this control
    // to the navbar logo. The footer logo keeps its template default.
    if (typeof logoHeightPx !== 'undefined') {
      var logoImgs = document.querySelectorAll('[data-field="nav_logo"]');
      for (var j = 0; j < logoImgs.length; j++) {
        var imgEl = logoImgs[j];
        // Prefer the conventional .logo ancestor — templates style
        // ITS height and the img inherits 100%. Falling back to the
        // image itself keeps non-canonical templates working
        // (template-base.css's .nav-inner .logo img height-40px would
        // otherwise win without an inline override on the img).
        var target = imgEl.closest && imgEl.closest('.logo');
        if (!target) target = imgEl;
        // Strip any prior height we own so toggling values doesn't
        // accumulate stale declarations. Mirrors skApplyFieldStylePatch.
        var prevStyle = target.getAttribute('style') || '';
        var stripped = prevStyle
          .replace(/height\s*:[^;]+(!important)?\s*;?/gi, '')
          .replace(/;\s*;/g, ';')
          .replace(/^\s*;/, '')
          .replace(/;\s*$/, '');
        if (logoHeightPx === null ||
            typeof logoHeightPx !== 'number' ||
            !isFinite(logoHeightPx)) {
          if (stripped) target.setAttribute('style', stripped);
          else target.removeAttribute('style');
          continue;
        }
        var decl = 'height: ' + logoHeightPx + 'px !important';
        target.setAttribute(
          'style',
          stripped ? stripped + '; ' + decl : decl
        );
      }
    }
  }

  // Field highlight — outline the [data-field] element matching the input
  // the user just focused in the right panel. Pass null/null to clear.
  // Always clears any previous highlight first so only one element is ever
  // outlined at a time. Scrolls the target into view so off-screen fields
  // surface naturally as the user clicks through inputs.
  function skHighlightField(sectionId, fieldKey) {
    var prev = document.querySelectorAll('.sk-field-highlight');
    for (var i = 0; i < prev.length; i++) {
      prev[i].classList.remove('sk-field-highlight');
    }
    if (!sectionId || !fieldKey) return;
    var section = document.querySelector(
      '[data-sk-section="' + skEscape(String(sectionId)) + '"]'
    );
    if (!section) return;
    var el = section.querySelector(
      '[data-field="' + skEscape(String(fieldKey)) + '"]'
    );
    if (!el) return;
    el.classList.add('sk-field-highlight');
    if (el.scrollIntoView) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  window.addEventListener('message', function (e) {
    if (!e.data || !e.data.type) return;
    var d = e.data;

    if (d.type === 'SK_SET_SELECTED') {
      document.querySelectorAll('[data-sk-section]').forEach(function (el) {
        el.removeAttribute('data-sk-selected');
      });
      if (d.id) {
        var el = document.querySelector('[data-sk-section="' + skEscape(String(d.id)) + '"]');
        if (el) {
          el.setAttribute('data-sk-selected', 'true');
          // 'start' so the section always jumps to the top — feels responsive.
          // scroll-margin-top (CSS rule below) leaves room for the sticky nav.
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
      return;
    }

    if (d.type === 'SK_PATCH_FIELD') {
      skApplyFieldPatch(d.sectionId, d.fieldKey, d.fieldType, d.value);
      return;
    }

    if (d.type === 'SK_PATCH_FIELD_STYLE') {
      skApplyFieldStylePatch(d.sectionId, d.fieldKey, d.sizePx, d.widthPx, d.fill);
      return;
    }

    if (d.type === 'SK_PATCH_REPEATER_ITEM') {
      skApplyRepeaterItemPatch(
        d.sectionId, d.repeaterKey, d.itemIndex, d.fieldKey, d.fieldType, d.value
      );
      return;
    }

    if (d.type === 'SK_PATCH_ITEM_ID') {
      skApplyItemIdPatch(d.sectionId, d.repeaterKey, d.itemIndex, d.newId);
      return;
    }

    if (d.type === 'SK_PATCH_AUTO_SYNCED_DROPDOWN') {
      skApplyAutoSyncedDropdown(d.sectionId, d.repeaterKey, d.navMenuItemIndex, d.items);
      return;
    }

    if (d.type === 'SK_PATCH_THEME') {
      skApplyThemePatch(d.css);
      return;
    }

    if (d.type === 'SK_PATCH_FONTS') {
      skApplyFontsPatch(d.href);
      return;
    }

    if (d.type === 'SK_PATCH_BRAND') {
      skApplyBrandPatch(d.logoUrl, d.faviconUrl, d.logoHeightPx);
      return;
    }

    if (d.type === 'SK_HIGHLIGHT_FIELD') {
      skHighlightField(d.sectionId, d.fieldKey);
      return;
    }
  });

  // ── Propagation-aware image loader ────────────────────────────────────
  //
  // Composer-only. After a fresh publish, the iframe's <base href>
  // points at the just-deployed URL but Cloudflare's edge / DNS may
  // not have propagated yet — every /_uploads/* image briefly 404s
  // while the staging copies have already been deleted on Supabase.
  // Without intervention the user sees the browser's broken-image
  // glyph and assumes the publish failed.
  //
  // This handler watches for image errors on deployment-hosted URLs
  // (anything containing /_uploads/ or *.pages.dev), swaps the
  // visible src to a "Propagating…" SVG placeholder so the slot reads
  // as intentional, and retries the original URL in the background
  // with cache-buster query strings + exponential backoff. As soon as
  // the edge serves a 200, we swap back to the real src — no refresh
  // required, no manual republish.
  //
  // Scope:
  //   - Only deployment URLs. Other broken images (typo'd href,
  //     deleted file) still show the normal broken-image icon so the
  //     user knows it's a real problem.
  //   - Capture-phase listener so we catch errors regardless of which
  //     <img> fires them.
  //   - One concurrent retry loop per <img> (guarded by a dataset
  //     flag); a single image bouncing won't fork into N timers.
  //   - Gives up after ~6 retries (~64s with backoff). Beyond that
  //     the issue is unlikely to be propagation and showing the
  //     broken icon is more honest than hiding indefinitely.
  var SK_PROPAGATING_SRC = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice">' +
    '<rect fill="#f3f4f6" width="400" height="300"/>' +
    '<g transform="translate(200 130)">' +
    '<circle cx="0" cy="0" r="14" fill="none" stroke="#9ca3af" stroke-width="3" stroke-dasharray="40 30" stroke-linecap="round" transform-origin="0 0">' +
    '<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1.2s" repeatCount="indefinite"/>' +
    '</circle></g>' +
    '<text x="200" y="180" text-anchor="middle" fill="#6b7280" font-family="system-ui,-apple-system,sans-serif" font-size="14" font-weight="500">Propagating…</text>' +
    '<text x="200" y="200" text-anchor="middle" fill="#9ca3af" font-family="system-ui,-apple-system,sans-serif" font-size="11">Image will appear in a moment</text>' +
    '</svg>'
  );

  function skIsDeploymentUrl(src) {
    if (!src) return false;
    return src.indexOf('/_uploads/') !== -1 || src.indexOf('.pages.dev') !== -1;
  }

  document.addEventListener('error', function (e) {
    var img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    if (img.dataset.skPropagating === '1') return;
    var original = img.getAttribute('src') || '';
    if (!skIsDeploymentUrl(original)) return;
    if (original.indexOf('data:') === 0) return;

    img.dataset.skPropagating = '1';
    img.dataset.skOriginalSrc = original;
    img.src = SK_PROPAGATING_SRC;

    var attempt = 0;
    function tryNext() {
      attempt += 1;
      if (attempt > 6) {
        // Give up — show whatever happens next (the real broken-image
        // icon if we restore the src and it still 404s).
        img.removeAttribute('data-sk-propagating');
        return;
      }
      var probe = new Image();
      probe.onload = function () {
        // Edge has the file. Restore the real src so the layout uses
        // it for cache, sizing, and right-click "Save image" — and
        // because the placeholder SVG was just a stand-in.
        img.src = original;
        img.removeAttribute('data-sk-propagating');
        img.removeAttribute('data-sk-original-src');
      };
      probe.onerror = function () {
        // Backoff: 1.5s, 3s, 6s, 12s, 24s, 30s (capped).
        var delay = Math.min(30000, 1500 * Math.pow(2, attempt - 1));
        setTimeout(tryNext, delay);
      };
      // Cache-buster forces the browser to actually hit the edge
      // instead of replaying a cached 404.
      probe.src = original + (original.indexOf('?') >= 0 ? '&' : '?') + '_skp=' + Date.now();
    }
    setTimeout(tryNext, 1500);
  }, true);
<\/script>` : `<script>
  // Scroll-reveal: add .visible to .fade-up / .fade-left / .fade-right elements
  // when they enter the viewport. Mirrors what the production site does.
  (function () {
    var els = document.querySelectorAll('.fade-up, .fade-left, .fade-right');
    if (!els.length) return;
    if (!('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('visible'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });
    els.forEach(function (el) { io.observe(el); });
  })();

  // Hash-link interceptor — necessary because the head's <base href>
  // (set to the deployed site URL so /_uploads/ images resolve) also
  // rebases <a href="#service-1"> to "<deployedUrl>/#service-1". Without
  // this script, clicking a nav-dropdown item in the Preview Site tab
  // would navigate the tab AWAY from the blob: preview INTO the live
  // deployed site — which is jarring (different URL, possibly stale
  // HTML, possibly mobile-sized depending on viewport carryover).
  //
  // Strategy: intercept clicks on <a href="#..."> in the capture phase,
  // preventDefault to block the base-href-rebased navigation, then do
  // the same-page smooth-scroll ourselves. Bypassed for non-hash links
  // (real navigation should still work) and for empty / hash-only "#"
  // links (no target to scroll to).
  (function () {
    document.addEventListener('click', function (e) {
      var t = e.target;
      var link = t && t.closest ? t.closest('a[href]') : null;
      if (!link) return;
      var href = link.getAttribute('href') || '';
      if (!href) return;
      // External / special-scheme links are real destinations — leave
      // them to the browser.
      if (/^(https?:|mailto:|tel:|ftp:|sms:)/i.test(href)) return;

      var hashIdx = href.indexOf('#');
      var pathPart = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
      var id = hashIdx >= 0 ? href.slice(hashIdx + 1) : '';

      // 1) Fragment that resolves to a section ON THIS PAGE → smooth
      //    scroll in-place. Covers same-page anchors AND nav-dropdown
      //    items like "#sluzba" / "index.html#sluzba" while previewing
      //    home — these must never jump to the deployed site.
      if (id) {
        var target = null;
        try {
          target = document.getElementById(id) ||
            document.querySelector('section[id="' + id + '"]');
        } catch (_) {}
        if (target && target.scrollIntoView) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          try { history.replaceState(null, '', '#' + id); } catch (_) {}
          return;
        }
      }

      // 2) Pure fragment with NO local target (e.g. a "#sluzba" whose
      //    section lives on another page) → block it. The <base href>
      //    would otherwise rebase it to the deployed site — the jarring
      //    "sent to the deployed version" jump.
      if (!pathPart) {
        e.preventDefault();
        return;
      }

      // 3) A real link to ANOTHER page ("o-nas.html", "o-nas.html#x").
      //    This standalone preview only renders the home page, so it
      //    can't show another page's fresh edits — let the browser
      //    follow the link to the deployed equivalent so the subpage
      //    link still goes somewhere instead of doing nothing.
    }, true);
  })();
<\/script>`}
</body>
</html>`;
}

/**
 * Self-contained MULTI-PAGE preview for the "Preview site" new-tab button.
 *
 * The single-page render (renderInBrowser with a fixed pagePath) only
 * contains the home page, so clicking a subpage link there had nowhere
 * fresh to go — with the deployment <base href> it jumped the tab to the
 * LIVE deployed site (e.g. t-2cb4.pages.dev/first), leaving the preview.
 *
 * This builds ONE document holding EVERY page, each wrapped in a
 * `[data-sk-page="path"]` container (only one visible at a time), plus a
 * tiny client router: clicking any internal link (page path, cross-page
 * anchor, or bare `#fragment`) swaps the visible page and scrolls to the
 * fragment IN-PLACE — it never navigates, so it can never escape to the
 * deployed site. External links (http/tel/mailto) still open normally.
 *
 * Implementation note: we render each page through `renderInBrowser`
 * (chrome:false) so section rendering stays a SINGLE source of truth —
 * no duplicated brand/dedup/override logic to drift. We then strip each
 * page's runtime <script>s (we add one shared router instead), collect
 * its <style>/<base>/fonts, and stack the bodies. Runs client-side only
 * (needs DOMParser); falls back to a home-only render under SSR.
 */
export function renderMultiPagePreview(
  composition: SiteComposition,
  templates: Map<string, TemplateBody>,
  options: { baseCss: string; deploymentBaseUrl?: string; initialPath?: string },
): string {
  const homePath = composition.pages[0]?.path ?? "index.html";
  const initialPath =
    options.initialPath &&
    composition.pages.some((p) => p.path === options.initialPath)
      ? options.initialPath
      : homePath;

  // SSR / no-DOMParser safety: just render the initial page on its own.
  if (typeof DOMParser === "undefined") {
    return renderInBrowser(composition, templates, {
      baseCss: options.baseCss,
      pagePath: initialPath,
      chrome: false,
      deploymentBaseUrl: options.deploymentBaseUrl,
    });
  }

  const parser = new DOMParser();
  const styleTexts: string[] = [];
  const styleSeen = new Set<string>();
  // Per-template inline scripts (gallery lightbox, accordions, sliders…)
  // collected during the per-page loop and emitted ONCE at the end of
  // the body. Dedup by content so a script that repeats on every page
  // binds its handlers exactly once — matches the live published site,
  // where each page is its own HTML so each script runs once per page.
  // Without this, the multi-page preview was stripping ALL scripts (it
  // pre-dated the gallery lightbox JS) and full-view didn't work in the
  // preview while it worked on live (Peter 2026-05-29).
  const scriptTexts: string[] = [];
  const scriptSeen = new Set<string>();
  let fontsTag = "";
  let baseTag = "";
  const containers: string[] = [];

  for (const p of composition.pages) {
    const docHtml = renderInBrowser(composition, templates, {
      baseCss: options.baseCss,
      pagePath: p.path,
      chrome: false,
      deploymentBaseUrl: options.deploymentBaseUrl,
    });
    const doc = parser.parseFromString(docHtml, "text/html");

    // Collect CSS (dedupe identical chunks across pages — shared
    // nav/footer/theme CSS is identical on every page).
    doc.querySelectorAll("style").forEach((s) => {
      const txt = s.textContent || "";
      if (txt && !styleSeen.has(txt)) {
        styleSeen.add(txt);
        styleTexts.push(txt);
      }
    });
    // <base> + fonts <link> are identical across pages — capture once.
    if (!baseTag) {
      const b = doc.querySelector("base");
      if (b) baseTag = b.outerHTML;
    }
    if (!fontsTag) {
      const f = doc.querySelector("link[data-sk-fonts]");
      if (f) fontsTag = f.outerHTML;
    }

    // Collect per-page inline scripts (gallery lightbox, sliders, …)
    // into scriptTexts before stripping them from the page container —
    // we re-emit a deduped set after the router below so they run once
    // and bind to all matching elements across stacked pages. External
    // <script src="…"> tags (e.g. ../_common/preview.js) are dropped:
    // their relative paths don't resolve in the iframe and would 404.
    // nav-07's scroll-aware navbar will run BOTH its own collected
    // script AND the router's mirror; that's harmless because they
    // both toggle the same class (idempotent).
    doc.body.querySelectorAll("script").forEach((s) => {
      const hasSrc = s.hasAttribute("src");
      const txt = s.textContent || "";
      if (!hasSrc && txt && !scriptSeen.has(txt)) {
        scriptSeen.add(txt);
        scriptTexts.push(txt);
      }
      s.remove();
    });

    const safePath = String(p.path).replace(/"/g, "&quot;");
    const hidden = p.path === initialPath ? "" : " hidden";
    containers.push(
      `<div data-sk-page="${safePath}"${hidden}>\n${doc.body.innerHTML}\n</div>`,
    );
  }

  // Client router. Intercepts every link click: internal links switch
  // the visible page + scroll to any fragment; external links pass
  // through. Fragment lookups are scoped to the VISIBLE page container
  // because ids repeat across pages (shared nav/footer + per-section
  // ids), so a global getElementById could resolve onto a hidden page.
  const routerScript = `<script>(function(){
  var HOME = ${JSON.stringify(homePath)};
  function pageEl(path){
    var pages = document.querySelectorAll('[data-sk-page]');
    for (var i = 0; i < pages.length; i++){
      if (pages[i].getAttribute('data-sk-page') === path) return pages[i];
    }
    return null;
  }
  function resolvePage(path){
    return pageEl(path) || pageEl(path + '.html') || pageEl(path.replace(/\\.html$/, ''));
  }
  function show(target){
    var pages = document.querySelectorAll('[data-sk-page]');
    for (var i = 0; i < pages.length; i++){ pages[i].hidden = pages[i] !== target; }
  }
  function elById(scope, id){
    var el = null;
    try { el = scope.querySelector('#' + CSS.escape(id)); } catch(_){}
    if(!el){ try { el = scope.querySelector('[id="' + id.replace(/"/g,'') + '"]'); } catch(_){} }
    return el;
  }
  function findPageById(id){
    var pages = document.querySelectorAll('[data-sk-page]');
    for (var i = 0; i < pages.length; i++){
      var el = elById(pages[i], id);
      if(el) return { page: pages[i], el: el };
    }
    return null;
  }
  document.addEventListener('click', function(e){
    var link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if(!link) return;
    var href = link.getAttribute('href') || '';
    if(!href) return;
    if(/^(https?:|mailto:|tel:|ftp:|sms:)/i.test(href)) return; // real external destination
    e.preventDefault();
    var hashIdx = href.indexOf('#');
    var pathRaw = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
    var id = hashIdx >= 0 ? href.slice(hashIdx + 1) : '';
    var path = pathRaw.replace(/^[.\\/]+/, '');
    // Resolve an explicit target page from the path part. A path that
    // normalizes to empty ("/", "./") is a ROOT link → home (the logo
    // case: logos link to "/" or "index.html" and must return to home).
    var targetPage = pathRaw ? (path === '' ? pageEl(HOME) : resolvePage(path)) : null;
    if(id){
      // Scroll to the fragment. Prefer the explicitly targeted page;
      // otherwise find whichever page actually contains the id — so a
      // bare cross-page anchor ("#kontakt" clicked from another page)
      // jumps to the right page instead of doing nothing.
      var found = null;
      if(targetPage){ var hit = elById(targetPage, id); if(hit) found = { page: targetPage, el: hit }; }
      if(!found) found = findPageById(id);
      if(found){
        show(found.page);
        // Defer the scroll one frame: when the target lives on a page we
        // just switched FROM hidden→visible, the browser hasn't laid it
        // out yet, and scrollIntoView in the same tick silently no-ops
        // (the "I clicked a home-page anchor from a subpage and it didn't
        // go there" symptom). rAF lets layout settle first.
        var goEl = found.el;
        if(goEl.scrollIntoView){
          requestAnimationFrame(function(){
            requestAnimationFrame(function(){
              goEl.scrollIntoView({ behavior:'smooth', block:'start' });
            });
          });
        }
        return;
      }
    }
    if(targetPage){ show(targetPage); window.scrollTo({ top: 0 }); return; }
    // Nothing resolved (logo "#" / "/" / a dead "#" placeholder) → home.
    var home = pageEl(HOME);
    if(home){ show(home); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  }, true);
  // No scroll-triggered animation in the preview — reveal everything up front.
  document.querySelectorAll('.fade-up').forEach(function(el){ el.classList.add('visible'); });
  // Scroll-aware navbar (nav-07): replicate the live transparent->solid
  // swap. The nav's own scroll script was stripped (we use one shared
  // router instead), so re-add the scrollY threshold toggle here. Same
  // 120px threshold + rAF throttle the template script used.
  var skNavs = document.querySelectorAll('.site-nav.nav-scroll');
  if (skNavs.length){
    var skTicking = false;
    function skUpdateNav(){
      var solid = window.scrollY > 120;
      for (var i = 0; i < skNavs.length; i++){ skNavs[i].classList.toggle('is-scrolled', solid); }
      skTicking = false;
    }
    window.addEventListener('scroll', function(){
      if(!skTicking){ skTicking = true; requestAnimationFrame(skUpdateNav); }
    }, { passive: true });
    skUpdateNav();
  }
  // Infinite-marquee galleries (gallery-06): the template's own script was
  // stripped above, so re-add its VISUAL part here — clone each track once
  // for a seamless loop, then flip on the animation via .is-animating. This
  // makes the Preview-site tab show the moving marquee like the live site
  // (the click-to-open lightbox is not re-added here — preview is look-only).
  var skMarquees = document.querySelectorAll('.gallery-marquee');
  for (var smi = 0; smi < skMarquees.length; smi++){
    var smq = skMarquees[smi];
    if (smq.dataset.skMarqueeInit) continue;
    smq.dataset.skMarqueeInit = '1';
    var smTracks = smq.querySelectorAll('.gallery-marquee__track');
    for (var sti = 0; sti < smTracks.length; sti++){
      var smTrack = smTracks[sti];
      var smKids = Array.prototype.slice.call(smTrack.children);
      for (var ski = 0; ski < smKids.length; ski++){
        var smClone = smKids[ski].cloneNode(true);
        smClone.setAttribute('aria-hidden','true');
        smTrack.appendChild(smClone);
      }
    }
    smq.classList.add('is-animating');
  }
})();<\/script>`;

  return `<!DOCTYPE html>
<html lang="sk">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${baseTag}
  ${fontsTag}
  <style>${styleTexts.join("\n\n")}
  /* Page router visibility — keep hidden pages out of flow regardless of
     any template reset that revives [hidden] via display:revert. */
  [data-sk-page][hidden]{display:none !important;}</style>
</head>
<body>
${containers.join("\n")}
${routerScript}
${scriptTexts.map((t) => `<script>${t}<\/script>`).join("\n")}
</body>
</html>`;
}

function wrapWithMarker(id: string, innerHtml: string): string {
  // Each section in the preview gets a wrapper carrying its composition id.
  // Hover + click handlers in the injected script use this to talk to the parent.
  const safeId = String(id).replace(/"/g, "&quot;");
  return `<div data-sk-section="${safeId}">\n${innerHtml}\n</div>`;
}

/**
 * DOMParser-based override application. Browser-safe. Mirrors
 * applyContentOverrides in parser.ts but uses native DOM instead of cheerio.
 */
/** Same px range as parser.ts. Both renderers MUST clamp identically
 *  so iframe preview and server-rendered HTML stay byte-aligned. */
const FIELD_SIZE_MIN_PX_BROWSER = 8;
const FIELD_SIZE_MAX_PX_BROWSER = 200;
/** Same width bounds as parser.ts FIELD_WIDTH_MIN/MAX_PX. */
const FIELD_WIDTH_MIN_PX_BROWSER = 240;
const FIELD_WIDTH_MAX_PX_BROWSER = 1400;

interface FieldStyleInputBrowser {
  size?: number;
  width?: number;
  fill?: boolean;
}

export function applyOverridesInBrowser(
  html: string,
  overrides: Record<string, FieldValue>,
  schema: PlaceholderSchema,
  /** Per-field style overrides (font size today, more later). Mirrors
   *  the optional fieldStyles parameter on parser.ts applyContentOverrides
   *  so the composer iframe and the deployed HTML resolve sizes identically. */
  fieldStyles?: Record<string, FieldStyleInputBrowser>,
  /** Composite field keys the author wants HIDDEN from this render.
   *  Two shapes:
   *    · "hero_cta"                      — top-level link/button
   *    · "services_items[2].service_cta" — repeater item sub-field
   *  Applied as the very last pass (after expansion + overrides +
   *  styles + section-id override) so the targeted elements are
   *  present in the DOM and ready to remove. Pure DOM removal —
   *  no display:none, no orphan accessibility text. */
  hiddenFields?: string[],
): string {
  if (typeof DOMParser === "undefined") {
    // Defensive — should not be hit in client code.
    return html;
  }

  // Wrap in a <body> fragment so DOMParser stays predictable
  const doc = new DOMParser().parseFromString(
    `<!DOCTYPE html><html><body>${html}</body></html>`,
    "text/html",
  );

  // ── Pass 1: repeaters ──
  // Mirrors the cheerio version in parser.ts: clone the first child of each
  // [data-repeat="<key>"] container N times, applying per-item overrides.
  // Done before flat fields so the inner data-fields don't get matched as
  // section-wide keys by the loop below.
  for (const [key, fieldRaw] of Object.entries(schema)) {
    if (fieldRaw.type !== "repeater") continue;
    const safeKey = cssEscape(key);
    const container = doc.body.querySelector(
      `[data-repeat="${safeKey}"]`,
    ) as HTMLElement | null;
    if (!container) continue;
    const childArr = Array.from(container.children) as HTMLElement[];
    if (childArr.length === 0) continue;

    const itemSchema = (fieldRaw.item_schema ?? {}) as PlaceholderSchema;
    const overrideValue = overrides[key];
    const items: Array<Record<string, FieldValue>> = Array.isArray(overrideValue)
      ? (overrideValue as Array<Record<string, FieldValue>>)
      : (fieldRaw.default_items ?? []);

    // Pick the STRUCTURAL TEMPLATE — the first child that carries
    // nested [data-repeat] markup, falling back to the first child
    // when none do. Mirrors parser.ts (top-level walker + cheerio
    // renderer use the same `findIndex` criterion), so the composer's
    // live preview and the published HTML stay in lockstep. Real
    // motivation: a nav can place Sluzby in the middle of the link
    // list (Home → About → Services → Gallery → Contact) while still
    // cloning Sluzby's <li> (dropdown markup included) for every
    // item, so per-item overrides preserve the dropdown UL on every
    // cloned <li>.
    const tmplIdx = childArr.findIndex(
      (c) => c.querySelector("[data-repeat]") !== null,
    );
    const templateChild = childArr[tmplIdx >= 0 ? tmplIdx : 0];
    const templateHTML = templateChild.outerHTML;
    // Mirror parser.ts per-item id generation. The TS schema's
    // `item_id_source` (set at parse time from a template element's
    // `data-item-id-source="<fieldKey>"`) names which item field
    // drives each cloned item's anchor id. We render each item's HTML
    // first, then surgically patch the [data-item-id-source] element's
    // id in a tiny DOMParser pass before joining. Collisions get -2 / -3
    // suffixes so two services with the same title still produce unique
    // ids. Without `item_id_source`, the template's hard-coded ids
    // (if any) pass through untouched.
    const idSourceKey = (fieldRaw as { item_id_source?: string }).item_id_source;
    const usedItemIds = new Set<string>();

    const renderedHTML = items
      .map((itemOverride, itemIdx) => {
        const itemHtml = applyOverridesInBrowser(
          templateHTML,
          itemOverride,
          itemSchema,
        );
        if (!idSourceKey) return itemHtml;

        const itemDoc = new DOMParser().parseFromString(
          `<!DOCTYPE html><html><body>${itemHtml}</body></html>`,
          "text/html",
        );
        const idEl = itemDoc.body.querySelector(
          "[data-item-id-source]",
        ) as HTMLElement | null;
        if (!idEl) return itemHtml;

        const explicit =
          typeof itemOverride.__item_id === "string"
            ? (itemOverride.__item_id as string).trim()
            : "";
        let id: string;
        if (explicit) {
          id = slugifyAnchorId(explicit);
        } else {
          const raw = itemOverride[idSourceKey];
          const sourceText =
            typeof raw === "string"
              ? raw
              : raw &&
                  typeof raw === "object" &&
                  !Array.isArray(raw) &&
                  typeof (raw as { label?: unknown }).label === "string"
                ? ((raw as { label: string }).label)
                : "";
          id = slugifyAnchorId(sourceText);
        }
        // `polozka` (Slovak: "item") — matches parser.ts. See that
        // file for the rationale on the rename.
        if (!id) id = `polozka-${itemIdx + 1}`;
        let final = id;
        let n = 2;
        while (usedItemIds.has(final)) {
          final = `${id}-${n}`;
          n++;
        }
        usedItemIds.add(final);
        idEl.id = final;
        return itemDoc.body.innerHTML;
      })
      .join("");
    container.innerHTML = renderedHTML;
  }

  // ── Pass 1b: mirror first repeater image into a featured element ──
  // Mirror of the cheerio pass in parser.ts. An element with
  // `data-sk-mirror-repeater="<key>"` copies the `src` of the FIRST
  // rendered item's image (field via `data-sk-mirror-field`, default
  // "image") so a "featured photo + thumbnail rail" layout (gallery-05)
  // shows the first gallery image in the big stage WITHOUT any client JS —
  // the composer never runs section scripts, so this is the only way the
  // big image can reflect the rail in the preview. Live edits of the first
  // item keep it in sync via skApplyRepeaterItemPatch below.
  doc.body.querySelectorAll("[data-sk-mirror-repeater]").forEach((rawEl) => {
    const mirror = rawEl as HTMLElement;
    const repeaterKey = mirror.getAttribute("data-sk-mirror-repeater");
    if (!repeaterKey) return;
    const fieldKey = mirror.getAttribute("data-sk-mirror-field") || "image";
    const container = doc.body.querySelector(
      `[data-repeat="${cssEscape(repeaterKey)}"]`,
    );
    if (!container) return;
    const firstImg = container.querySelector(
      `[data-field="${cssEscape(fieldKey)}"]`,
    ) as HTMLElement | null;
    const src = firstImg?.getAttribute("src");
    if (src) mirror.setAttribute("src", src);
    // NB: keep the data-sk-mirror-* attributes in the iframe DOM so the
    // live patch path (skApplyRepeaterItemPatch) can re-sync the mirror
    // when the first item's image is edited without a full rebuild.
  });

  // ── Pass 2: flat fields ──
  // querySelectorAll (not querySelector) so the same field can drive
  // multiple elements. Original use case (2026-05-12): map-02 / map-03
  // have ONE address field that updates both the visible address text
  // AND the iframe map embed src. Each matching element dispatches by
  // its own tag inside applyFieldValue (a <span> gets text, an
  // <iframe data-type="map"> gets a built embed URL).
  for (const [key, value] of Object.entries(overrides)) {
    const field = schema[key];
    if (!field) continue;
    if (field.type === "repeater") continue; // already handled

    const safeKey = cssEscape(key);
    // Filter out [data-field] elements that live INSIDE a [data-repeat]
    // container — they belong to the repeater's items and are written
    // by the recursive applyOverridesInBrowser call in Pass 1 with the
    // proper per-item overrides. Mirrors the cheerio-side filter in
    // parser.ts. Without this, a top-level field key that collides with
    // an item-local field key (e.g. nav: top-level `nav_link_services`
    // vs item-local `label`) would clobber the rendered items.
    const candidates = doc.body.querySelectorAll(`[data-field="${safeKey}"]`);
    if (candidates.length === 0) continue;
    const els: HTMLElement[] = [];
    candidates.forEach((c) => {
      if (!(c as HTMLElement).closest("[data-repeat]")) {
        els.push(c as HTMLElement);
      }
    });
    if (els.length === 0) continue;

    els.forEach((el) => applyFieldValue(el, field, value, key));

    // Image alt-text: explicit override under `<key>_alt` wins, sibling
    // `title` field is the fallback (catalog convention for repeater
    // items where image + title travel together). Applied after
    // applyFieldValue so the alt only lands on elements the value
    // step actually touched. Mirror of parser.ts case "image" — keep
    // both renderers in sync so composer preview = published HTML.
    if (field.type === "image") {
      const altKey = `${key}_alt`;
      const explicitAltRaw = (overrides as Record<string, unknown>)[altKey];
      const explicitAlt =
        typeof explicitAltRaw === "string" ? explicitAltRaw.trim() : "";
      let alt = explicitAlt;
      if (!alt) {
        const titleRaw = (overrides as Record<string, unknown>).title;
        if (typeof titleRaw === "string") alt = titleRaw.trim();
      }
      if (alt) {
        els.forEach((el) => {
          if (el.tagName === "IMG") el.setAttribute("alt", alt);
        });
      }
    }
  }

  // ── Pass 3: per-field style overrides (font size in px) ──
  // Mirrors parser.ts. Only text-shaped fields accept size overrides.
  // `!important` is required because template CSS often defines
  // higher-specificity font-size rules that would otherwise win.
  if (fieldStyles) {
    for (const [key, style] of Object.entries(fieldStyles)) {
      if (!style) continue;
      const field = schema[key];
      if (!field) continue;
      if (
        field.type !== "text" &&
        field.type !== "longtext" &&
        field.type !== "richtext"
      ) {
        continue;
      }
      // Apply to EVERY matching element, not just the first —
      // mirror of parser.ts Pass 3. In repeater sections the same
      // data-field key appears on every item, and a single-element
      // querySelector here would silently drift card 1 away from the
      // rest. See parser.ts for the full rationale.
      const safeKey = cssEscape(key);
      const els = doc.body.querySelectorAll(
        `[data-field="${safeKey}"]`,
      ) as NodeListOf<HTMLElement>;
      if (els.length === 0) continue;
      // Independent gates for size + width + fill — mirror of parser.ts
      // Pass 3. fill takes priority over width (the breakout rule sets
      // its own max-width: 100vw; combining is contradictory).
      const declarations: string[] = [];
      const sizePx = typeof style.size === "number" ? style.size : NaN;
      if (
        Number.isFinite(sizePx) &&
        sizePx >= FIELD_SIZE_MIN_PX_BROWSER &&
        sizePx <= FIELD_SIZE_MAX_PX_BROWSER
      ) {
        // No !important on the inline font-size: inline already wins
        // over class-level CSS by specificity (1,0,0,0 vs 0,1,1) on
        // desktop, so the user's size override still applies. Dropping
        // !important lets mobile @media rules with their own
        // !important cap the size on small screens. Without this fix
        // a 56px desktop hero title remained 56px on phones, blowing
        // through every mobile cap we tried. Peter 2026-05-20.
        declarations.push(`font-size: ${sizePx}px`);
      }
      const fillEnabled = style.fill === true;
      const widthPx = typeof style.width === "number" ? style.width : NaN;
      const widthValid =
        !fillEnabled &&
        Number.isFinite(widthPx) &&
        widthPx >= FIELD_WIDTH_MIN_PX_BROWSER &&
        widthPx <= FIELD_WIDTH_MAX_PX_BROWSER;
      if (widthValid) {
        declarations.push(`max-width: ${widthPx}px !important`);
      }
      const joined = declarations.join("; ");
      els.forEach((el) => {
        if (fillEnabled) {
          el.setAttribute("data-fill", "true");
        } else {
          el.removeAttribute("data-fill");
        }
        if (!joined) return;
        const existing = el.getAttribute("style") || "";
        const trimmed = existing.replace(/;\s*$/, "");
        const next = trimmed ? `${trimmed}; ${joined}` : joined;
        el.setAttribute("style", next);
      });
    }
  }

  // ── Pass 4: section-id override ──
  // Mirrors parser.ts. The composer exposes the section root's anchor
  // id as an editable field via the reserved key `__section_id` inside
  // content_overrides (no DB migration: the column was already JSONB).
  // Apply at render time so the iframe + the published HTML stay in
  // sync. Empty / missing override → keep the template's default id.
  const sectionIdOverride = overrides.__section_id;
  if (typeof sectionIdOverride === "string") {
    const trimmedId = sectionIdOverride.trim();
    if (trimmedId) {
      const rootEl = doc.body.firstElementChild as HTMLElement | null;
      if (rootEl) rootEl.id = trimmedId;
    }
  }

  // ── Pass 5: hidden fields ──
  // Strip out [data-field] elements the author has hidden via the
  // composer's eye-icon toggle. Done AFTER Pass 1 (repeater expansion)
  // and Pass 2 (flat field-fill) so the cloned per-item buttons are
  // already in the DOM and can be addressed by index. Pure removal —
  // no display:none, no orphan accessibility text in the published HTML.
  // Mirrors parser.ts:applyContentOverrides.
  if (hiddenFields && hiddenFields.length > 0) {
    for (const key of hiddenFields) {
      stripHiddenFieldDom(doc, key);
    }
  }

  // ── Pass 6: contact-form recipient binding ──
  // Mirror of parser.ts Pass 6. Reserved fields `form_recipient_email`
  // (text) + `form_enabled` (boolean) on a section cause the section's
  // first <form> to receive `data-sk-form-recipient="<email>"` — but
  // ONLY when the toggle resolves to "true" AND the email is non-empty.
  // contact-handler.js on the live site reads that attribute per-form.
  //
  // We don't inject the attribute when disabled or empty — the form
  // renders as a visually-complete but inert element (no listener gets
  // wired, submit does nothing).
  if (
    schema.form_recipient_email?.type === "text" &&
    schema.form_enabled?.type === "boolean"
  ) {
    const emailRaw =
      typeof overrides.form_recipient_email === "string"
        ? overrides.form_recipient_email
        : (schema.form_recipient_email.default ?? "");
    const enabledRaw =
      typeof overrides.form_enabled === "string"
        ? overrides.form_enabled
        : (schema.form_enabled.default ?? "false");
    const email = emailRaw.trim();
    const enabled = enabledRaw.trim().toLowerCase() === "true";
    if (enabled && email) {
      const form = doc.body.querySelector("form") as HTMLFormElement | null;
      if (form) form.setAttribute("data-sk-form-recipient", email);
    }
  }

  return doc.body.innerHTML;
}

/**
 * Remove the DOM node corresponding to one hidden-field key. Accepts
 * both top-level keys ("hero_cta") and composite repeater-item keys
 * ("services_items[2].service_cta"). Silently no-ops on malformed
 * keys, missing containers, or out-of-range indexes — hidden_fields
 * is best-effort: if the structure changed underneath, the toggle
 * just reverts to "shown" rather than crashing the renderer.
 *
 * Cascade-removes the immediate parent wrapper too if removing the
 * button left it structurally empty (no element children, no non-
 * whitespace text), provided the parent isn't a protected element
 * (section/article/header/nav/etc.). This catches templates that
 * wrap single buttons in named divs like `<div class="cta-row">…
 * </div>` so hiding the button doesn't leave a visible padded gap
 * in the published HTML.
 */
function stripHiddenFieldDom(doc: Document, key: string): void {
  const match = /^([^[.]+)(?:\[(\d+)\]\.(.+))?$/.exec(key);
  if (!match) return;
  const topKey = match[1];
  const indexStr = match[2];
  const subKey = match[3];

  if (indexStr === undefined || subKey === undefined) {
    // Top-level field — pick the first [data-field] that ISN'T inside
    // a repeater container (those belong to the repeater's items, not
    // the section-level button we're targeting).
    const safe = cssEscape(topKey);
    const candidates = doc.body.querySelectorAll(`[data-field="${safe}"]`);
    for (const raw of Array.from(candidates)) {
      const el = raw as HTMLElement;
      if (!el.closest("[data-repeat]")) {
        removeElementAndEmptyWrapper(el);
        return;
      }
    }
    return;
  }

  // Repeater item sub-field: find the container, navigate to the i-th
  // direct child, find the named field inside it, remove.
  const index = Number.parseInt(indexStr, 10);
  if (!Number.isFinite(index) || index < 0) return;
  const safeTopKey = cssEscape(topKey);
  const container = doc.body.querySelector(
    `[data-repeat="${safeTopKey}"]`,
  ) as HTMLElement | null;
  if (!container) return;
  const item = container.children[index] as HTMLElement | undefined;
  if (!item) return;
  const safeSubKey = cssEscape(subKey);
  const subEl = item.querySelector(
    `[data-field="${safeSubKey}"]`,
  ) as HTMLElement | null;
  if (subEl) removeElementAndEmptyWrapper(subEl);
}

/** Tags whose ancestor wrapper we NEVER cascade-remove from a hidden
 *  button. Even if such a wrapper looked structurally empty, deleting
 *  it would erase semantic structure or break anchor targets. */
const PROTECTED_WRAPPER_TAGS = new Set([
  "body",
  "html",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "nav",
  "main",
  "form",
]);

/**
 * Remove `el`, then drop its immediate parent too if the parent is now
 * structurally empty (zero element children, no non-whitespace text)
 * AND not a protected element. Capped at one level — never recurses
 * up the tree, so a hidden button can't accidentally erase its
 * grand-grandparent section. Mirrors the cheerio counterpart in
 * parser.ts so preview and publish stay in lockstep.
 */
function removeElementAndEmptyWrapper(el: HTMLElement): void {
  const parent = el.parentElement;
  el.remove();
  if (!parent) return;
  if (parent.children.length > 0) return;
  if ((parent.textContent ?? "").trim().length > 0) return;
  const tag = parent.tagName.toLowerCase();
  if (PROTECTED_WRAPPER_TAGS.has(tag)) return;
  // Keep wrappers that the renderer / composer cares about — they're
  // load-bearing even when empty after a hide. `data-field` shouldn't
  // appear here (we're walking up from a field), but guard anyway.
  if (parent.id) return;
  if (parent.hasAttribute("data-section")) return;
  if (parent.hasAttribute("data-repeat")) return;
  if (parent.hasAttribute("data-field")) return;
  parent.remove();
}

function applyFieldValue(
  el: HTMLElement,
  field: FieldSchema,
  value: FieldValue,
  /** Field key — needed for naming-convention rewrites like the phone
   *  auto-tel: prefix in the link case below. Optional for backwards
   *  compat with any internal callers we add later that operate on
   *  schema-only context (none today). */
  fieldKey?: string,
): void {
  switch (field.type) {
    case "image": {
      const v = typeof value === "string" ? value : "";
      if (!v) return;
      if (el.tagName === "IMG" || el.tagName === "IFRAME") {
        (el as HTMLImageElement | HTMLIFrameElement).src = v;
        if (el.tagName === "IMG") el.removeAttribute("srcset");
      } else {
        const style = el.getAttribute("style") ?? "";
        const replaced = style.replace(
          /background-image:\s*url\([^)]+\)/i,
          `background-image: url('${v}')`,
        );
        const next =
          replaced !== style
            ? replaced
            : `${style ? style.replace(/;?\s*$/, "; ") : ""}background-image: url('${v}')`;
        el.setAttribute("style", next);
      }
      break;
    }
    case "video": {
      // Mirror of the server-side case in parser.ts — keep the two
      // implementations in sync or the composer preview and the
      // published HTML will diverge.
      //   - <video>/<source>: set src for inline playback.
      //   - any other element: write URL into textContent so a
      //     runtime script (lightbox gallery, custom player) can read
      //     it. The element should be hidden via CSS in templates
      //     that use this pattern.
      const v = typeof value === "string" ? value : "";
      if (!v) return;
      if (el.tagName === "VIDEO" || el.tagName === "SOURCE") {
        (el as HTMLVideoElement | HTMLSourceElement).src = v;
      } else {
        el.textContent = v;
      }
      break;
    }
    case "link": {
      // Structured: { label?, href? }. Narrowing must exclude arrays
      // (also `typeof "object"`) so `.label`/`.href` reads type-check.
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        const linkObj = value as { label?: string; href?: string };
        // Skip the label-as-textContent write when the link element
        // has an SVG child — icon-only buttons (phone-call widget,
        // whatsapp widget, nav-social pills). textContent assignment
        // would destroy the SVG and replace it with the label string;
        // for phone-keyed fields that means the user sees the dial
        // digits as text instead of the phone glyph icon.
        const hasSvgChild = (el as HTMLElement).querySelector
          ? !!(el as HTMLElement).querySelector(":scope > svg")
          : false;
        if (typeof linkObj.label === "string" && !hasSvgChild) {
          el.textContent = linkObj.label;
        }
        if (typeof linkObj.href === "string") {
          // Same skip-empty-or-"#" gate as parser.ts — preserves the
          // template's meaningful default href when the saved value
          // is dead. Otherwise composer preview would show the broken
          // "#" link while the field editor (which now also falls
          // back to default_href) shows the correct anchor. Peter
          // 2026-05-15.
          const trimmedSavedHref = linkObj.href.trim();
          const skipHrefWrite =
            trimmedSavedHref === "" || trimmedSavedHref === "#";
          if (!skipHrefWrite) {
            // Mirror parser.ts: WhatsApp → wa.me URL, phone-shape →
            // tel: URI, anything else → pass through unchanged. Both
            // builders skip values that already have a recognized
            // prefix (full URLs, anchors, existing tel:/wa.me/mailto:).
            const isWhatsapp =
              fieldKey !== undefined && WHATSAPP_FIELD_KEY_RE.test(fieldKey);
            const isPhone =
              !isWhatsapp &&
              ((fieldKey !== undefined && PHONE_FIELD_KEY_RE.test(fieldKey)) ||
                looksLikePhone(linkObj.href));
            const finalHref = isWhatsapp
              ? buildWhatsappHref(linkObj.href)
              : isPhone
                ? buildPhoneHref(linkObj.href)
                : linkObj.href;
            el.setAttribute("href", finalHref);
          }
        }
      } else if (typeof value === "string") {
        el.textContent = value;
      }
      break;
    }
    case "map":
    case "text":
    case "longtext": {
      const v = typeof value === "string" ? value : "";
      // Map iframe: three accepted value formats, auto-detected at render
      // time so composer + storage stay schema-simple. Mirror of the
      // server-side handling in parser.ts applyContentOverrides.
      //   1. Full URL → used as iframe src directly (rich Google embed)
      //   2. lat,lng → wrapped in q= (pin-exact)
      //   3. address → wrapped in q= (geocoded)
      if (
        el.tagName === "IFRAME" &&
        (el.getAttribute("data-type") || "").toLowerCase() === "map"
      ) {
        const isUrl = /^https?:\/\//i.test(v.trim());
        (el as HTMLIFrameElement).src = isUrl
          ? v.trim()
          : `https://maps.google.com/maps?q=${encodeURIComponent(v)}&t=&z=15&ie=UTF8&iwloc=B&output=embed`;
      } else {
        // text + longtext store HTML since 2026-05-16 (the composer
        // routes both through the rich editor per Peter's directive).
        // innerHTML + sanitization keeps the iframe preview in step
        // with the published cheerio render (parser.ts uses the same
        // sanitizeRichText pipeline). Plain-text legacy values pass
        // through unchanged — `el.innerHTML = "plain text"` sets a
        // text node identical to `el.textContent = "plain text"`.
        //
        // Non-<div> targets (h1-h6, span, strong, em, li, a, p, etc.)
        // get TipTap's <p> wrapper stripped. See unwrapTipTapWrap.
        const sanitized = sanitizeRichText(v);
        const tagLc = el.tagName.toLowerCase();
        el.innerHTML = tagLc === "div" ? sanitized : unwrapTipTapWrap(sanitized);
      }
      break;
    }
    case "richtext": {
      const v = typeof value === "string" ? value : "";
      const sanitized = sanitizeRichText(v);
      const tagLc = el.tagName.toLowerCase();
      // Same div-gate as text/longtext above — see parser.ts for the
      // full reasoning. Richtext fields normally live on <div> so the
      // unwrap is inert; the guard future-proofs against misuse.
      el.innerHTML = tagLc === "div" ? sanitized : unwrapTipTapWrap(sanitized);
      break;
    }
    case "boolean": {
      // Config-only — the carrier element stays hidden, no DOM write.
      // The value is consumed by Pass 6 (form-recipient binding) and
      // the composition-level "active contact form?" check. Mirrors
      // parser.ts:applyContentOverrides.
      break;
    }
  }
}

function cssEscape(s: string): string {
  // Use native CSS.escape if available; fall back to a basic shim.
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  return s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

// Re-export composition types for callers
export type { CompositionSection, CompositionPage, SiteComposition };
