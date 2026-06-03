/**
 * Site-level SEO metadata.
 *
 * Stored on `composition.seo` and emitted as <head> meta tags during
 * render. Designed for the common case (single-page site, simple title +
 * description + share image + favicon). When multi-page sites land,
 * we'll add per-page overrides under `composition.pages[i].seo`.
 *
 * Pure module — no server deps — so both the server renderer (render.ts)
 * and the in-browser preview renderer (render-browser.ts) can import it.
 */

import { buildLocalBusinessJsonLd } from "./local-business";

export interface SiteSeo {
  /** <title> + og:title fallback */
  title?: string;
  /** <meta name="description"> + og:description fallback */
  description?: string;
  /** Image shown when site is shared on Facebook / LinkedIn / WhatsApp. ~1200×630. */
  og_image_url?: string;
  /** Width in pixels of og_image_url, captured at upload time. Emitted as
   *  og:image:width so platforms render the share card at correct
   *  proportions instead of guessing/cropping (which is what causes the
   *  "blurry / low quality" preview). */
  og_image_width?: number;
  /** Height in pixels of og_image_url. Pairs with og_image_width. */
  og_image_height?: number;
  /** Browser tab icon. */
  favicon_url?: string;
  /** When true, emit <meta name="robots" content="noindex,nofollow">. Use for staging. */
  no_index?: boolean;
  /** Google Analytics 4 measurement id (`G-XXXXXXXXXX`). When set AND
   *  the page is being rendered for publish (siteUrl provided), the
   *  standard gtag.js snippet is injected into <head>. Composer
   *  preview never fires analytics (no siteUrl) so editing doesn't
   *  pollute the client's data. Stored as a free-form string; the
   *  emitter validates the format strictly before injecting (only
   *  G-XXXX… ids pass) so a typo or paste-error can't introduce
   *  arbitrary script content. */
  ga4_measurement_id?: string;
  /** Google Search Console verification token (the value Google gives
   *  when you click "Verify ownership via HTML tag" in Search Console).
   *  Format is opaque alphanumeric + hyphens/underscores, ~43 chars
   *  typical. When set, emits `<meta name="google-site-verification"
   *  content="...">` so the tech-admin / client can complete the GSC
   *  ownership check without manually editing the site's HTML. Strict
   *  character-class validation before injection keeps the value safe
   *  for an attribute context. */
  google_site_verification?: string;
}

/**
 * Per-page SEO overrides. Stored on `composition.pages[i].seo`. Only the
 * fields that legitimately differ page-to-page live here — title,
 * description, share image, and per-page noindex. Site-wide concerns
 * (favicon, GA4, Search Console token, LocalBusiness/brand) stay on
 * `composition.seo` and are NOT repeated per page: they're emitted from
 * the site level (and the LocalBusiness JSON-LD only on the home page).
 *
 * Every field optional — a page with no `seo` (or an empty one) inherits
 * the site-level defaults verbatim, so existing single-page sites and
 * freshly-added pages keep working with zero migration.
 */
export interface PageSeo {
  /** Per-page <title> + og:title. Falls back to the site title. */
  title?: string;
  /** Per-page meta description + og:description. Falls back to site. */
  description?: string;
  /** Per-page share image. Falls back to the site og:image. */
  og_image_url?: string;
  og_image_width?: number;
  og_image_height?: number;
  /** Hide just THIS page from search (noindex meta + excluded from the
   *  sitemap) while the rest of the site stays indexable. */
  no_index?: boolean;
}

/**
 * Merge a page's SEO overrides over the site-level defaults. Only fields
 * the page actually sets (non-empty for strings) win; everything else —
 * including site-only fields like favicon, GA4, GSC token — falls through
 * from the site level untouched. Returns a fresh SiteSeo ready to hand to
 * `buildHeadMeta`.
 *
 * Kept pure + here (not in render.ts) so both renderers and the composer
 * preview compute identical effective SEO per page.
 */
export function mergePageSeo(
  site: SiteSeo | undefined | null,
  page: PageSeo | undefined | null,
): SiteSeo {
  const merged: SiteSeo = { ...(site ?? {}) };
  if (!page) return merged;
  if (typeof page.title === "string" && page.title.trim() !== "")
    merged.title = page.title;
  if (typeof page.description === "string" && page.description.trim() !== "")
    merged.description = page.description;
  if (typeof page.og_image_url === "string" && page.og_image_url.trim() !== "") {
    merged.og_image_url = page.og_image_url;
    // Take the page's dimensions with its image (even if undefined) so we
    // never pair a page image with the site image's width/height.
    merged.og_image_width = page.og_image_width;
    merged.og_image_height = page.og_image_height;
  }
  // no_index is a boolean — an explicit `false` on the page is a real
  // "index this page even though…" signal, so honor any defined value.
  if (typeof page.no_index === "boolean") merged.no_index = page.no_index;
  return merged;
}

export interface BuildHeadMetaOptions {
  /** Used as the title fallback when seo.title is empty + og:site_name. */
  siteName: string;
  /** Absolute URL of the live site (e.g. `https://abc.2dni.sk`). When
   *  provided:
   *    - Relative og:image URLs (`/_uploads/xyz.png`) get resolved to
   *      absolute. External crawlers (FB / WhatsApp / LinkedIn / Twitter /
   *      Slack / Discord) require absolute URLs — a relative path either
   *      fails or falls back to a tiny inline image, producing the blurry
   *      thumbnails users complain about.
   *    - <link rel="canonical"> + og:url are emitted.
   *    - LocalBusiness JSON-LD is emitted (needs an absolute url).
   *    - GA4 + GSC verification tags emit (gated to publish only).
   *  Optional — preview/edit renders that don't have a deployment URL pass
   *  nothing and the absolute-resolution + canonical tags are skipped. */
  siteUrl?: string;
  /** Absolute URL of THIS specific page (e.g. `https://abc.2dni.sk/o-nas`).
   *  Used for `<link rel="canonical">` + `og:url` so each subpage points
   *  at itself instead of all pages canonical-ing to the home URL (which
   *  would get the subpages deindexed as duplicates). Falls back to
   *  `siteUrl` when not provided (single-page / legacy callers). The
   *  origin-level `siteUrl` is still used for resolving relative
   *  og:image paths + gating GA4 / JSON-LD. */
  pageUrl?: string;
  /** Whether to emit the LocalBusiness JSON-LD block on this page.
   *  Defaults to true (backward-compat). The multi-page renderer sets
   *  this true ONLY for the home page so the structured-data block isn't
   *  duplicated across every subpage (Google flags repeated LocalBusiness
   *  schema). */
  emitLocalBusiness?: boolean;
  /** Locale for og:locale. Defaults to "sk_SK" (Slovak). */
  locale?: string;
  /** Brand record from `composition.brand`. Optional, but when present
   *  AND the brand has at least a name + one contact channel, a
   *  LocalBusiness JSON-LD block is appended to <head>. Tells crawlers
   *  directly that this is a local business with name / phone / email
   *  / address — much higher local-search visibility than the prose
   *  Google would otherwise have to infer business info from. */
  brand?: import("@/lib/composer/brand").SiteBrand | null;
  /** Resolved brand logo URL (auto-mode SVG data: URL or custom upload).
   *  Optional; when provided AND a LocalBusiness block is being emitted,
   *  it's included as the schema's `logo` field. Pass the URL produced
   *  by `resolveBrand()` so auto and custom modes both work. */
  brandLogoUrl?: string;
}

/**
 * Build the <head> meta-tag block for SEO + social sharing.
 * Returns a string of HTML to inject after <meta viewport> in the page head.
 *
 * Emits, in order:
 *   - <title> (always — has fallback to siteName)
 *   - description, canonical, favicon, robots noindex (when set)
 *   - Open Graph: type, locale, site_name, title, description, url, image
 *     (with secure_url, type, width, height, alt when known)
 *   - Twitter: card, title, description, image, image:alt
 *
 * Sensible fallbacks so a site never has broken SEO:
 *   - title falls back to the site's name
 *   - description, og_image, favicon: omitted when empty (better than misleading text)
 *   - canonical / og:url: omitted when no siteUrl provided (e.g. preview mode)
 *   - og:image:width/height: omitted when not yet probed (older sites)
 */
export function buildHeadMeta(
  seo: SiteSeo | undefined | null,
  options: BuildHeadMetaOptions,
): string {
  const siteUrl = (options.siteUrl ?? "").trim().replace(/\/$/, "");
  // Per-page canonical/og:url. Falls back to the origin when a single
  // page URL wasn't supplied (legacy/single-page callers).
  const canonicalUrl = ((options.pageUrl ?? options.siteUrl) ?? "")
    .trim()
    .replace(/\/$/, "");
  const title = (seo?.title ?? "").trim() || options.siteName;
  const description = (seo?.description ?? "").trim();
  const ogImageRaw = (seo?.og_image_url ?? "").trim();
  const favicon = (seo?.favicon_url ?? "").trim();
  const noIndex = !!seo?.no_index;
  const locale = options.locale || "sk_SK";

  // Resolve og:image to an absolute URL. This is the core of the fix —
  // crawlers fetch the og:image URL from outside our domain, so a
  // `/_uploads/...` relative path fails and they fall back to auto-detecting
  // a tiny inline image (= the blurry thumbnail users see).
  const ogImage = resolveAbsolute(ogImageRaw, siteUrl);
  // Defensive: never emit a `pending:` marker into HTML (would only happen
  // if SEO panel was edited but never published — preview mode).
  const ogImageEmittable = ogImage && !ogImage.startsWith("pending:");
  const ogImageMime = ogImageEmittable ? mimeFromExt(ogImage) : "";
  const ogImageWidth = seo?.og_image_width;
  const ogImageHeight = seo?.og_image_height;

  const parts: string[] = [];

  // Title is always emitted (we always have a fallback).
  parts.push(`<title>${escapeHtml(title)}</title>`);

  if (description) {
    parts.push(
      `<meta name="description" content="${escapeAttr(description)}">`,
    );
  }

  // Canonical = THIS page's URL (per-page on multi-page sites). Only emit
  // when we know it (publish path passes it; in-composer preview doesn't).
  if (canonicalUrl) {
    parts.push(`<link rel="canonical" href="${escapeAttr(canonicalUrl)}">`);
  }

  if (favicon) {
    parts.push(`<link rel="icon" href="${escapeAttr(favicon)}">`);
  }

  if (noIndex) {
    parts.push(`<meta name="robots" content="noindex,nofollow">`);
  }

  // ── Open Graph (Facebook, LinkedIn, WhatsApp, Discord, Slack, etc.) ──
  parts.push(`<meta property="og:type" content="website">`);
  parts.push(`<meta property="og:locale" content="${escapeAttr(locale)}">`);
  parts.push(
    `<meta property="og:site_name" content="${escapeAttr(options.siteName)}">`,
  );
  parts.push(`<meta property="og:title" content="${escapeAttr(title)}">`);
  if (description) {
    parts.push(
      `<meta property="og:description" content="${escapeAttr(description)}">`,
    );
  }
  if (canonicalUrl) {
    parts.push(`<meta property="og:url" content="${escapeAttr(canonicalUrl)}">`);
  }
  if (ogImageEmittable) {
    parts.push(`<meta property="og:image" content="${escapeAttr(ogImage)}">`);
    // og:image:secure_url — historically required by some crawlers when
    // scheme is https. Cheap to emit, costs nothing.
    if (ogImage.startsWith("https://")) {
      parts.push(
        `<meta property="og:image:secure_url" content="${escapeAttr(ogImage)}">`,
      );
    }
    if (ogImageMime) {
      parts.push(
        `<meta property="og:image:type" content="${escapeAttr(ogImageMime)}">`,
      );
    }
    // Width + height let platforms reserve the right slot in the share
    // card and render at full resolution. Without these, FB/LinkedIn
    // sometimes downscale or use a smaller crop.
    if (ogImageWidth && ogImageHeight) {
      parts.push(
        `<meta property="og:image:width" content="${ogImageWidth}">`,
      );
      parts.push(
        `<meta property="og:image:height" content="${ogImageHeight}">`,
      );
    }
    parts.push(
      `<meta property="og:image:alt" content="${escapeAttr(title)}">`,
    );
  }

  // ── Twitter cards ──
  // Most platforms now read OG tags as fallback, but Twitter/X still
  // prefers explicit twitter:* tags and ignores some OG ones.
  parts.push(
    `<meta name="twitter:card" content="${ogImageEmittable ? "summary_large_image" : "summary"}">`,
  );
  parts.push(`<meta name="twitter:title" content="${escapeAttr(title)}">`);
  if (description) {
    parts.push(
      `<meta name="twitter:description" content="${escapeAttr(description)}">`,
    );
  }
  if (ogImageEmittable) {
    parts.push(
      `<meta name="twitter:image" content="${escapeAttr(ogImage)}">`,
    );
    parts.push(
      `<meta name="twitter:image:alt" content="${escapeAttr(title)}">`,
    );
  }

  // ── Google Search Console verification ──
  // Strict validation against an opaque-token character class — Google's
  // verification token is alphanumeric + `-` + `_`, ~43 chars. We allow
  // any length 16-128 to stay future-proof but reject anything outside
  // that character class so the value can't break out of the attribute
  // context. Emitted in BOTH publish + preview because the verification
  // tag is just a static meta and doesn't fire any tracking — same
  // behavior as the favicon link. (Some clients verify on staging.)
  const gscToken = (seo?.google_site_verification ?? "").trim();
  if (isValidGscToken(gscToken)) {
    parts.push(
      `<meta name="google-site-verification" content="${escapeAttr(gscToken)}">`,
    );
  }

  // ── Google Analytics 4 (gtag.js) ──
  // Only emitted on publish (siteUrl gates this — same as canonical
  // and og:url). In composer preview (no siteUrl), analytics stays
  // silent so editing the site doesn't pollute the client's data.
  // The id is strict-validated to "G-XXXX…" before injection — any
  // value that doesn't match is silently skipped, preventing a
  // mistyped or pasted-with-quotes value from breaking out of the
  // attribute / script context. The script is the official Google
  // snippet from analytics.google.com — async load + dataLayer + a
  // single config call. We don't add custom event hooks here; if
  // clients want enhanced tracking they should switch to GTM.
  const ga4Id = (seo?.ga4_measurement_id ?? "").trim();
  if (siteUrl && isValidGa4Id(ga4Id)) {
    // ga4Id has already passed the strict regex; safe to interpolate
    // both into the URL query string and the JS string literal.
    parts.push(
      `<script async src="https://www.googletagmanager.com/gtag/js?id=${ga4Id}"></script>`,
      `<script>window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', '${ga4Id}');</script>`,
    );
  }

  // ── LocalBusiness JSON-LD ──
  // Only emitted on publish (siteUrl required — the schema's `url`
  // field points at the canonical site URL, and a JSON-LD without a
  // url is borderline-rejected by Google's structured-data tester).
  // The builder itself gates on having brand.company_text + at least
  // one of phone/email/address; nothing emits when brand is empty so
  // a site without a populated Brand panel just falls back to "Google
  // guesses what you are" behavior with no broken/sparse schema.
  if (siteUrl && options.brand && options.emitLocalBusiness !== false) {
    // Filter the brand logo URL: Google's structured-data validator
    // expects fetchable URLs for schema.org `logo` and `image`. The
    // brand resolver returns a `data:` URL for auto-mode SVGs (fine
    // for inline `<img src>`, NOT fine for crawlers — flagged as
    // invalid in Google's tester). It can also return a `pending:`
    // marker mid-upload (transient state, never reaches publish but
    // defensive). Both get stripped here so the emitted JSON-LD
    // points at real crawlable URLs only — better to omit logo than
    // ship a broken one.
    const rawLogo = options.brandLogoUrl ?? "";
    const logoIsCrawlable =
      rawLogo.length > 0 &&
      !rawLogo.startsWith("pending:") &&
      !rawLogo.startsWith("data:") &&
      !rawLogo.startsWith("blob:");

    const jsonLd = buildLocalBusinessJsonLd({
      brand: options.brand,
      siteUrl,
      // ogImage was already resolved to absolute earlier in this fn.
      // Reuse it as the LocalBusiness image so the social-share photo
      // and the structured-data photo stay in sync (one upload covers
      // both surfaces).
      ogImageUrl: ogImageEmittable ? ogImage : undefined,
      logoUrl: logoIsCrawlable ? rawLogo : undefined,
    });
    if (jsonLd) parts.push(jsonLd);
  }

  return parts.join("\n  ");
}

/**
 * Strict format check for a GA4 measurement id. Google's format is
 * `G-` followed by 6–12 alphanumeric characters (typically 10). We
 * reject anything that doesn't fit this exact shape — keeps the
 * injected script content tightly bounded and prevents a copy-paste
 * accident from introducing arbitrary HTML/JS into the rendered head.
 */
function isValidGa4Id(id: string): boolean {
  return /^G-[A-Z0-9]{6,12}$/i.test(id);
}

/**
 * Strict format check for a Google Search Console verification token.
 * Google's tokens are alphanumeric + `-` + `_`, typically ~43 chars.
 * We allow 16–128 to be tolerant of format changes Google might roll
 * out. Reject anything outside the character class so the value is
 * always safe to drop into the meta `content` attribute even though
 * we additionally HTML-escape on emit.
 */
function isValidGscToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(token);
}

/**
 * Resolve a possibly-relative URL against an absolute base. Used so OG
 * meta tags emit absolute URLs that external crawlers can fetch.
 *
 *   - Already absolute (http://, https://, data:, blob:) → unchanged
 *   - `pending:xxx` marker → unchanged (caller handles the skip)
 *   - Empty string → empty string
 *   - Starts with "/" + base provided → "{base}/path"
 *   - Anything else + base provided → "{base}/path" (treated as root-relative)
 *   - No base → returned unchanged (preview mode without a deployment URL)
 */
function resolveAbsolute(url: string, baseUrl: string): string {
  if (!url) return "";
  // Has a scheme (http:, https:, data:, blob:, pending:) — leave it alone.
  if (/^[a-z]+:/i.test(url)) return url;
  if (!baseUrl) return url;
  if (url.startsWith("/")) return `${baseUrl}${url}`;
  return `${baseUrl}/${url}`;
}

/** Map common image file extensions to the MIME types crawlers expect. */
function mimeFromExt(url: string): string {
  // Strip query string + fragment before reading extension.
  const clean = url.split("?")[0].split("#")[0];
  const ext = clean.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "avif":
      return "image/avif";
    case "svg":
      return "image/svg+xml";
    default:
      return "";
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}
