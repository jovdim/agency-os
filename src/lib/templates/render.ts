import { readFileSync } from "fs";
import path from "path";
import { createAdminClient } from "@/lib/supabase/admin";
import { load as loadCheerio } from "cheerio";
import { applyContentOverrides, type PlaceholderSchema, type FieldValue } from "./parser";
import { slugifyAnchorId, dedupeAnchorId } from "./slugify";
import { applyNavLogoHeight } from "./nav-logo-height";
import {
  buildGoogleFontsLinkTag,
  buildThemeStyleTag,
  type SiteTheme,
} from "./theme";
import { buildHeadMeta, mergePageSeo, type SiteSeo, type PageSeo } from "./seo";
import { resolveBrand, type SiteBrand } from "@/lib/composer/brand";
import { syncNavDropdownFromServices } from "@/lib/composer/nav-dropdown-sync";
import { withBrandContact } from "./brand-contact";
import { htmlToPlainText } from "./sanitize";
import {
  localizeComposition,
  getLocaleRenderTargets,
  type LocaleRenderTarget,
} from "@/lib/i18n/localize";
// Locale constants + types live in a node-free leaf module so client
// components can import the runtime values without bundling this
// fs-importing module. Imported here for local use + re-exported below
// for backwards-compat with existing server-side importers.
import {
  SUPPORTED_LOCALES,
  LOCALE_LABELS,
  LOCALE_SHORT,
  LOCALE_HTML_LANG,
} from "@/lib/i18n/locales";
import type {
  SiteLocale,
  SiteI18n,
  LocaleValue,
  LocaleTranslationSnapshot,
} from "@/lib/i18n/locales";

export {
  SUPPORTED_LOCALES,
  LOCALE_LABELS,
  LOCALE_SHORT,
  LOCALE_HTML_LANG,
};
export type {
  SiteLocale,
  SiteI18n,
  LocaleValue,
  LocaleTranslationSnapshot,
};

export type { SiteTheme } from "./theme";
export type { SiteSeo, PageSeo } from "./seo";
export type { SiteBrand } from "@/lib/composer/brand";
export { THEME_VAR_MAP, THEME_LABELS, buildThemeStyleTag, buildThemeCss } from "./theme";
export { buildHeadMeta } from "./seo";

// ── Composition shapes (the JSONB stored on sites.composition) ──

/**
 * Style overrides for a single field. Currently only `size` (font size
 * in CSS pixels) is supported. Kept as an object so future style knobs
 * (font weight, alignment) can be added without breaking existing data.
 *
 * Earlier design used discrete levels (XS/S/M/L/XL → em multipliers).
 * Switched to absolute pixel values on 2026-05-11 per Peter — clients
 * want to see and edit the exact px value rather than an abstract
 * level. The +/− buttons step by 2px; the number itself is click-to-
 * edit for typing a custom value.
 */
export interface FieldStyle {
  /** Font size in CSS pixels. When undefined or out-of-range, the
   *  field renders at its template-default size (no inline override).
   *  Sensible range: 8–200; UI clamps to that. */
  size?: number;
  /** max-width override in CSS pixels for prose-shaped fields
   *  (text/longtext/richtext). Controls line length / column width.
   *  Sensible range: 240–1400; UI clamps to that. Image/link/repeater/map
   *  fields ignore this override even if it ends up persisted.
   *  Ignored when `fill === true` (fill takes priority). */
  width?: number;
  /** When true, the field breaks out of its parent container and spans
   *  the full viewport edge-to-edge. Implemented via `data-fill="true"`
   *  attribute + a stylesheet rule in template-base.css (negative-margin
   *  viewport trick). Mutually exclusive with `width` at render time —
   *  fill wins. Only text/longtext/richtext honor this; others ignore. */
  fill?: boolean;
}

export interface CompositionSection {
  id: string;
  template_id: string;
  order: number;
  content_overrides: Record<string, FieldValue>;
  /**
   * Per-field style overrides (e.g. font size). Sibling to
   * content_overrides — kept separate so the existing FieldValue type
   * (string | link | repeater) stays simple, and so backwards-compat
   * for sites written before this feature existed is automatic (the
   * field is optional, missing = no styles).
   */
  field_styles?: Record<string, FieldStyle>;
  /**
   * Fields the author has chosen to HIDE from the rendered page. Both
   * the composer preview and the publish renderer remove these DOM
   * elements entirely (no `display:none` — accessibility-clean).
   *
   * Key format:
   *   · Top-level field             →  "hero_cta"
   *   · Repeater item sub-field     →  "services_items[2].service_cta"
   *
   * The data still lives in content_overrides — this flag only gates
   * rendering. Hiding then un-hiding restores the button with its
   * original label + href intact.
   *
   * Optional for backwards-compat — sites written before this layer
   * existed read as "nothing hidden" without migration.
   */
  hidden_fields?: string[];
}

export interface CompositionPage {
  path: string;
  label: string;
  sections: CompositionSection[];
  /** Per-page SEO overrides (title / description / share image / noindex).
   *  Merged over `composition.seo` at render time — see mergePageSeo.
   *  Optional: a page without it inherits the site-level SEO verbatim, so
   *  existing sites + freshly-added pages need no migration. */
  seo?: PageSeo;
  /** Anchors this subpage to ONE service item from the home page's
   *  services section (Peter 2026-05-30). Stores the item's id (the
   *  __item_id key inside the services repeater) so renames don't
   *  break the link. Used by the JSON round-trip to tell ChatGPT
   *  "this subpage is about service X" so subpage-02 + subpage-03
   *  fill stays focused on that one service.
   *
   *  Set on Add-page when tech-admin picks a service from the dropdown.
   *  null / undefined → custom subpage (no service link). Home page is
   *  always undefined. Existing pages have it undefined — no migration. */
  linked_service_id?: string | null;
}

export interface SiteComposition {
  pages: CompositionPage[];
  /** Multi-language config. Absent = single-language site (the historical
   *  default — zero migration: every existing site reads as one language
   *  with no subpaths). */
  i18n?: SiteI18n;
  shared?: {
    nav_template_id?: string;
    nav_overrides?: Record<string, FieldValue>;
    /** Fields the author hid on the shared nav template (e.g.
     *  nav_facebook, nav_instagram). Same semantics as per-section
     *  `hidden_fields` — element is removed from the rendered DOM,
     *  data preserved in nav_overrides for restore. Top-level keys
     *  only (no repeater-item composites — nav menu items use a
     *  dedicated min/max gate, not the hide toggle). */
    nav_hidden_fields?: string[];
    footer_template_id?: string;
    footer_overrides?: Record<string, FieldValue>;
    /** Footer-side counterpart to nav_hidden_fields. Footer link
     *  rows (footer_facebook, footer_instagram, etc.) use this to
     *  toggle off without losing the saved URL. */
    footer_hidden_fields?: string[];
  };
  theme?: SiteTheme;
  /** SEO metadata (title, description, social image, favicon). Site-level
   *  defaults — applied to every page. Per-page overrides come later. */
  seo?: SiteSeo;
  /** Brand identity (logo + favicon). Auto-mode generates an SVG from the
   *  company text + theme primary; custom-mode points at a user-uploaded
   *  asset. Optional for backwards-compat with sites created before this
   *  layer existed — resolveBrand() falls back to a sensible auto logo. */
  brand?: SiteBrand;
}

// ── Render options ──

export interface RenderOptions {
  pagePath?: string;
  /** When true: omit production scripts (proposal widget / contact handler / editor helper) */
  preview?: boolean;
  /**
   * Legacy field — kept for backwards-compat with callers that still
   * forward it. The renderer now derives every script-injection
   * decision from the composition itself; this value is ignored.
   * Remove the field once every caller stops passing it.
   */
  proposalStatus?: string | null;
  /**
   * Legacy field — pre-2026-05-15 the renderer pulled one site-wide
   * recipient email from `contacts.business_email` and stamped it on
   * the contact-handler script tag. That path is dead: every <form>
   * now carries its own data-sk-form-recipient attribute (set by
   * parser.ts Pass 6 from the section's `form_recipient_email` +
   * `form_enabled` carriers). Kept in the type so the publish-time
   * call site can stop threading it without a flag-day deploy.
   */
  businessEmail?: string | null;
  /** Public proposal slug for the proposal-widget script */
  proposalSlug?: string | null;
  /**
   * Opt-IN flag (Peter 2026-05-15). The payment banner script is
   * injected ONLY when this is explicitly `true`. Null / undefined /
   * false all suppress the banner. Wired from `proposals.show_banner`,
   * which is flipped to true by the BannerConfigDialog after sales
   * sets the discount + base prices.
   */
  showBanner?: boolean | null;
  /**
   * Use this composition instead of the one stored on the site row. The
   * publish flow uses this to render with `pending:`/Supabase URLs already
   * substituted to their final Cloudflare paths — without touching the DB
   * until after the deploy succeeds (atomicity).
   */
  compositionOverride?: SiteComposition;
  /**
   * Absolute URL of the live site (e.g. `https://abc.2dni.sk`). Threaded
   * down to buildHeadMeta so og:image / og:url / canonical emit as absolute
   * URLs — required by external crawlers (FB, LinkedIn, Twitter, WhatsApp)
   * for share-card image fetching. Publish computes this upfront from the
   * custom domain (or .pages.dev fallback). Preview/edit renders skip it.
   */
  siteUrl?: string;
}

// ── Render result ──

export interface RenderedPage {
  path: string;
  label: string;
  html: string;
}

export interface RenderResult {
  siteName: string;
  pages: RenderedPage[];
  /** Combined CSS (for publish bundling). HTML already has it inlined. */
  css: string;
}

// ── Cached base CSS ──
let cachedBaseCss: string | null = null;
function getBaseCss(): string {
  if (cachedBaseCss !== null) return cachedBaseCss;
  try {
    const baseCssPath = path.join(process.cwd(), "public", "template-base.css");
    cachedBaseCss = readFileSync(baseCssPath, "utf8");
  } catch {
    cachedBaseCss = "";
  }
  return cachedBaseCss;
}

// ── Public: render a single page (for preview iframe) ──

export async function renderSitePage(
  siteId: string,
  options: RenderOptions = {},
): Promise<{ html: string; pagePath: string } | { error: string }> {
  const result = await renderSite(siteId, options);
  if ("error" in result) return result;
  const targetPath = options.pagePath || "index.html";
  const page =
    result.pages.find((p) => p.path === targetPath) || result.pages[0];
  if (!page) return { error: "No pages in composition" };
  return { html: page.html, pagePath: page.path };
}

// ── Public: render every page (for publish bundling) ──

export async function renderSite(
  siteId: string,
  options: RenderOptions = {},
): Promise<RenderResult | { error: string }> {
  const admin = createAdminClient();

  const { data: site, error: siteErr } = await admin
    .from("sites")
    .select("id, name, composition, is_legacy, owner_id, proposal_id")
    .eq("id", siteId)
    .single();

  if (siteErr || !site) return { error: "Site not found" };
  if (site.is_legacy)
    return { error: "Cannot render legacy site (uses GitHub+cheerio path)" };

  // If publish.ts (or any other caller) supplied an in-memory override,
  // use it. Otherwise fall back to the DB-stored composition.
  const composition: SiteComposition | null =
    options.compositionOverride ?? (site.composition as SiteComposition | null);
  if (!composition?.pages || composition.pages.length === 0) {
    return { error: "Site has no composition" };
  }

  // Collect every template ID used across all pages + shared
  const templateIds = new Set<string>();
  for (const page of composition.pages) {
    for (const sec of page.sections) templateIds.add(sec.template_id);
  }
  if (composition.shared?.nav_template_id)
    templateIds.add(composition.shared.nav_template_id);
  if (composition.shared?.footer_template_id)
    templateIds.add(composition.shared.footer_template_id);

  if (templateIds.size === 0) return { error: "No sections in composition" };

  // Fetch all templates from DB
  const { data: templates, error: tplErr } = await admin
    .from("section_templates")
    .select("id, category, name, html_path, css_path, placeholder_schema")
    .in("id", Array.from(templateIds));

  if (tplErr || !templates) return { error: "Failed to fetch templates" };

  // Fetch all template files in parallel
  type FetchedTemplate = {
    id: string;
    category: string;
    html: string;
    css: string;
    placeholder_schema: PlaceholderSchema;
    /** The section root's `id` attribute as authored in the template
     *  HTML (e.g. "sluzby" for every services-* variant after the
     *  Slovak migration). Used by the section-id dedup pass when a
     *  section has no `__section_id` override. */
    defaultSectionId: string;
  };
  const fetched = new Map<string, FetchedTemplate>();
  await Promise.all(
    templates.map(async (tpl) => {
      const { data: htmlBlob } = await admin.storage
        .from("section-templates")
        .download(tpl.html_path);
      const html = htmlBlob ? await htmlBlob.text() : "";
      let css = "";
      if (tpl.css_path) {
        const { data: cssBlob } = await admin.storage
          .from("section-templates")
          .download(tpl.css_path);
        if (cssBlob) css = await cssBlob.text();
      }
      // Extract the section root's id. Mirrors load-bodies.ts so the
      // composer's preview and the published HTML agree on what the
      // template "wants" as its anchor id.
      let defaultSectionId = "";
      try {
        const $ = loadCheerio(html, { xmlMode: false });
        defaultSectionId =
          $("body").children().first().attr("id")?.trim() || "";
      } catch {
        defaultSectionId = "";
      }
      fetched.set(tpl.id, {
        id: tpl.id,
        category: tpl.category,
        html,
        css,
        placeholder_schema: (tpl.placeholder_schema ?? {}) as PlaceholderSchema,
        defaultSectionId,
      });
    }),
  );

  // Combine CSS from base + every used template (deduped)
  const seenCssIds = new Set<string>();
  const cssChunks: string[] = [getBaseCss()];
  for (const tpl of fetched.values()) {
    if (tpl.css && !seenCssIds.has(tpl.id)) {
      seenCssIds.add(tpl.id);
      cssChunks.push(`/* template ${tpl.category}/${tpl.id} */\n${tpl.css}`);
    }
  }
  const combinedCss = cssChunks.filter(Boolean).join("\n\n");

  // ── Contact-form publish-time validation ──
  // A contact section whose `form_enabled` resolves to true but whose
  // `form_recipient_email` is empty would ship a visually-correct form
  // that silently drops every submission (Pass 6 only stamps
  // data-sk-form-recipient when both are present, and contact-handler.js
  // treats forms without the attribute as inert). Fail the publish here
  // with a clear, page-by-section listing so the author fixes it instead
  // of shipping a dead form. Preview path stays permissive so the
  // composer iframe never blanks while the email is being typed.
  if (!options.preview) {
    const broken = collectBrokenContactForms(
      composition,
      fetched,
      composition.brand,
    );
    if (broken.length > 0) {
      const detail = broken
        .map((b) => `  • ${b.pageLabel || b.pagePath} — ${b.templateId}`)
        .join("\n");
      const plural = broken.length > 1 ? "s are" : " is";
      throw new Error(
        `Cannot publish: ${broken.length} contact form${plural} enabled but missing a recipient email:\n${detail}\n\nOpen the composer and either fill in the recipient email (form_recipient_email) or disable the form (form_enabled → off).`,
      );
    }
  }

  // ── Contact-form activation scan ──
  // Walk every section across every page and check whether ANY of them
  // is a "live" contact form: schema has the reserved `form_enabled`
  // (boolean) + `form_recipient_email` (text) pair AND the resolved
  // values (override → default fallback) say enabled + email non-empty.
  // If yes, we inject contact-handler.js. Each <form> on the live site
  // carries its own `data-sk-form-recipient` attribute (set by parser.ts
  // Pass 6), so a single script tag handles N forms across the site
  // without us threading per-form data through the script src.
  const hasActiveContactForm = options.preview
    ? false
    : doesCompositionHaveActiveContactForm(
        composition,
        fetched,
        composition.brand,
      );

  // Decide which scripts to inject. Banner is opt-IN — caller must
  // pass `showBanner: true` explicitly. Anything else (false, null,
  // undefined) suppresses the script tag. publishSite() resolves this
  // from `proposals.show_banner` and only sets true when that column
  // is explicitly true.
  const scriptTags = options.preview
    ? []
    : buildScriptTags(
        options.proposalSlug,
        hasActiveContactForm,
        options.showBanner === true,
      );

  // ── Brand resolution ──
  // The Brand panel manages composition.brand independently of per-section
  // overrides. We layer the resolved logo URL on top of nav/footer overrides
  // for the conventional `nav_logo` / `footer_logo` field keys so the same
  // logo flows through every nav/footer template uniformly. Custom user
  // overrides for these specific keys are intentionally overwritten —
  // changing the logo is a Brand-panel action, not a per-section one.
  const resolvedBrand = resolveBrand(
    composition.brand,
    composition.theme,
    site.name,
  );
  // Home page identity — locale-independent (each locale keeps the same
  // page paths, only URL-prefixed). Used for canonical URLs, hreflang,
  // JSON-LD gating, and the cross-page anchor qualifier.
  const homePath = composition.pages[0]?.path ?? "index.html";

  // ── Locale render targets ──
  // Single-language sites (no i18n, or one enabled locale) yield exactly
  // one root target — byte-for-byte the historical single-render path.
  // Multi-locale sites yield one target per enabled+translated locale:
  // the default at the root ("/"), every other locale under "/<locale>/".
  // `onlyPublishable` upholds the no-fallback rule — an enabled-but-not-
  // yet-translated locale is never emitted as a half-default page.
  const renderTargets = getLocaleRenderTargets(composition, {
    onlyPublishable: true,
  });
  const isMultiLang = renderTargets.length > 1;

  const renderedPages: RenderedPage[] = [];

  for (const target of renderTargets) {
    // Default / single-language → base composition unchanged. Other
    // locales → base deep-cloned with the locale's translation snapshot
    // overlaid (text + SEO + nav/footer). Non-text content (images,
    // phone, logos) stays shared by design.
    let localizedComp =
      target.locale && !target.isDefault
        ? localizeComposition(composition, target.locale)
        : composition;

    // Re-derive the service-linked nav dropdown labels from the
    // (localized) services section — for EVERY locale, INCLUDING the
    // default.
    //
    // The Sluzby dropdown rows are auto-synced copies of the services
    // section's titles (nav-dropdown-sync.ts). The composer DISPLAYS the
    // dropdown by running this exact sync on every render, so publish
    // must run it too or the two diverge. Relying on the edit-time sync
    // having already persisted into nav_overrides is fragile: on a fresh
    // or just-migrated site the saved composition can still hold the nav
    // template's default "Service 1..4" rows (the edit-time sync hadn't
    // flushed, or the dropdown was only ever shown via the display-time
    // sync) — those then shipped to the live site even though the
    // composer looked correct. Running it here unconditionally closes the
    // gap. For non-default locales it ALSO pulls the translated titles in
    // (the stored copies stay in the default language otherwise). The
    // per-row __auto merge preserves manual dropdown edits, and the sync
    // is a no-op when there's no services section / no linked dropdown,
    // so this is safe to run on every pass.
    localizedComp = syncNavDropdownFromServices(
      localizedComp,
      fetched as unknown as Parameters<typeof syncNavDropdownFromServices>[1],
    );

    // <html lang="…"> — the locale's html lang, or "sk" for legacy
    // single-language sites with no i18n block (preserves prior output).
    const htmlLang = target.locale ? LOCALE_HTML_LANG[target.locale] : "sk";

    // Brand logo / favicon are locale-independent, but nav/footer/seo
    // overrides now carry translated content per locale — recompute the
    // brand-merged versions from the LOCALIZED composition each pass.
    const navOverridesWithBrand = withBrandLogo(
      localizedComp.shared?.nav_overrides ?? {},
      "nav_logo",
      resolvedBrand.logoUrl,
      // Nav always shows brand — explicit "override" so the Brand panel
      // remains the only place to change the navbar logo.
      "override",
    );
    const footerOverridesWithBrand = withBrandLogo(
      localizedComp.shared?.footer_overrides ?? {},
      "footer_logo",
      resolvedBrand.logoUrl,
      // Footer falls back to brand only when no per-footer logo has been
      // uploaded — keeps footer in sync with brand by default but allows
      // a distinct footer mark.
      "fallback",
    );
    const siteSeoWithBrandFavicon: SiteSeo = {
      ...(localizedComp.seo ?? {}),
      favicon_url: localizedComp.seo?.favicon_url || resolvedBrand.faviconUrl,
    };

    // URL prefix for canonical / hreflang / anchor qualification:
    // "" for the default locale, "/de" for a sub-locale ("de/" → "/de").
    const localeUrlPrefix = target.prefix
      ? `/${target.prefix.replace(/\/$/, "")}`
      : "";

    const localePages: RenderedPage[] = [];
    for (const page of localizedComp.pages) {
      const sectionHtmls: string[] = [];

      // Per-page SEO: merge this page's overrides over the site defaults.
      const pageSeo = mergePageSeo(siteSeoWithBrandFavicon, page.seo);
      const isHomePage = page.path === homePath || page.path === "index.html";
      // Per-page canonical / og:url. Home → origin + locale prefix;
      // subpage → origin + locale prefix + clean path. Only when publish
      // supplied siteUrl.
      let pageUrl: string | undefined;
      if (options.siteUrl) {
        const origin = options.siteUrl.replace(/\/$/, "");
        const cleanPath = isHomePage
          ? ""
          : `/${page.path.replace(/\.html$/, "")}`;
        pageUrl = `${origin}${localeUrlPrefix}${cleanPath}` || origin;
      }

      if (localizedComp.shared?.nav_template_id) {
        const navHtml = renderSection(
          fetched,
          localizedComp.shared.nav_template_id,
          navOverridesWithBrand,
          undefined, // no field_styles for nav slot
          localizedComp.shared.nav_hidden_fields,
          localizedComp.brand,
        );
        if (navHtml) {
          // Post-process: stamp the navbar-logo height onto every `.logo`
          // ancestor of nav_logo when the user picked a custom size.
          const heightPx = localizedComp.brand?.logo_height_px;
          if (typeof heightPx === "number") {
            const $ = loadCheerio(navHtml, { xmlMode: false });
            applyNavLogoHeight($, heightPx);
            sectionHtmls.push($.html({ xmlMode: false }));
          } else {
            sectionHtmls.push(navHtml);
          }
        }
      }

      const sortedSections = [...page.sections].sort(
        (a, b) => a.order - b.order,
      );
      // ── Section-id dedup pass ── (same algorithm as parser.ts; see
      // slugify.ts:dedupeAnchorId). Two sections sharing a default anchor
      // id would render as duplicate ids; we suffix collisions -2, -3, …
      const usedSectionIds = new Set<string>();
      const footerTpl = localizedComp.shared?.footer_template_id
        ? fetched.get(localizedComp.shared.footer_template_id)
        : null;
      if (footerTpl?.defaultSectionId) {
        usedSectionIds.add(footerTpl.defaultSectionId);
      }
      for (const sec of sortedSections) {
        const tpl = fetched.get(sec.template_id);
        const overrideRaw = (
          sec.content_overrides as Record<string, unknown> | undefined
        )?.__section_id;
        const overrideId =
          typeof overrideRaw === "string" ? slugifyAnchorId(overrideRaw) : "";
        const intendedId = overrideId || tpl?.defaultSectionId || "";
        const finalId = dedupeAnchorId(intendedId, usedSectionIds);
        const effectiveOverrides: Record<string, FieldValue> = finalId
          ? {
              ...(sec.content_overrides ?? {}),
              __section_id: finalId as FieldValue,
            }
          : sec.content_overrides ?? {};

        const html = renderSection(
          fetched,
          sec.template_id,
          effectiveOverrides,
          sec.field_styles,
          sec.hidden_fields,
          localizedComp.brand,
        );
        if (html) sectionHtmls.push(html);
      }

      if (localizedComp.shared?.footer_template_id) {
        const html = renderSection(
          fetched,
          localizedComp.shared.footer_template_id,
          footerOverridesWithBrand,
          undefined, // no field_styles for footer slot
          localizedComp.shared.footer_hidden_fields,
          localizedComp.brand,
        );
        if (html) sectionHtmls.push(html);
      }

      // hreflang alternates — only on multi-locale sites, only at publish
      // (needs the absolute siteUrl). Points search engines at the
      // equivalent page in every locale + an x-default.
      const hreflangTags = isMultiLang
        ? buildHreflangTags(page.path, homePath, renderTargets, options.siteUrl)
        : "";

      const fullHtml = wrapPage({
        htmlLang,
        cssInline: combinedCss,
        themeStyleTag: buildThemeStyleTag(localizedComp.theme),
        headMeta: buildHeadMeta(pageSeo, {
          siteName: site.name,
          siteUrl: options.siteUrl,
          pageUrl,
          emitLocalBusiness: isHomePage,
          brand: localizedComp.brand,
          brandLogoUrl: resolvedBrand.logoUrl,
        }),
        headExtra: hreflangTags,
        fontsLinkTag: buildGoogleFontsLinkTag(localizedComp.theme),
        bodyHtml: sectionHtmls.join("\n\n"),
        scriptTags,
      });

      localePages.push({
        path: page.path,
        label: page.label,
        html: fullHtml,
      });
    }

    // ── Cross-page anchor qualification (per locale group) ──
    // Runs within THIS locale's pages so a bare `#kontakt` on a /de page
    // resolves to `/de/kontakt`, not the default-locale page.
    qualifyCrossPageAnchors(localePages, homePath, localeUrlPrefix);

    // ── Language switcher (multi-locale only) ──
    // Injected AFTER anchor qualification so its root-relative links
    // (/de/o-nas) aren't reprocessed. Adds a small SK/DE/EN chip cluster
    // to the navbar pointing at the equivalent page in each locale.
    if (isMultiLang) {
      injectLanguageSwitcher(localePages, renderTargets, target, homePath);
    }

    // Prefix the output file paths so they land under the locale folder
    // (de/index.html, de/o-nas.html). The default locale's prefix is ""
    // so its paths are unchanged.
    for (const p of localePages) {
      renderedPages.push({ ...p, path: `${target.prefix}${p.path}` });
    }
  }

  return {
    siteName: site.name,
    pages: renderedPages,
    css: combinedCss,
  };
}

// ── Internal helpers ──

/** Root-relative href prefix for a page: "/" for home (so the link is a
 *  same-document fragment on the home page = smooth scroll, and resolves
 *  to home from any subpage), "/second" for a subpage (matches the
 *  deployed clean-URL form). `localeUrlPrefix` ("" or "/de") prepends the
 *  locale folder so cross-page anchors stay within the active locale. */
export function pageAnchorPrefix(
  pagePath: string,
  homePath: string,
  localeUrlPrefix = "",
): string {
  return pagePath === homePath || pagePath === "index.html"
    ? `${localeUrlPrefix}/`
    : `${localeUrlPrefix}/` + pagePath.replace(/\.html$/, "");
}

/**
 * Build the hreflang alternate `<link>` tags for one page across every
 * locale render target. Emits one `<link rel="alternate" hreflang="…">`
 * per locale pointing at the equivalent page URL, plus an `x-default`
 * pointing at the default locale. Absolute URLs (needs `siteUrl`); returns
 * "" when siteUrl is absent (preview/edit) so nothing half-formed ships.
 */
export function buildHreflangTags(
  pagePath: string,
  homePath: string,
  targets: LocaleRenderTarget[],
  siteUrl: string | undefined,
): string {
  if (!siteUrl) return "";
  const origin = siteUrl.replace(/\/$/, "");
  const isHome = pagePath === homePath || pagePath === "index.html";
  const cleanPath = isHome ? "" : `/${pagePath.replace(/\.html$/, "")}`;
  const urlFor = (t: LocaleRenderTarget): string => {
    const prefix = t.prefix ? `/${t.prefix.replace(/\/$/, "")}` : "";
    return `${origin}${prefix}${cleanPath}` || origin;
  };
  const tags: string[] = [];
  for (const t of targets) {
    const lang = t.locale ? LOCALE_HTML_LANG[t.locale] : "sk";
    tags.push(
      `<link rel="alternate" hreflang="${lang}" href="${escapeHtml(urlFor(t))}">`,
    );
  }
  const def = targets.find((t) => t.isDefault) ?? targets[0];
  if (def) {
    tags.push(
      `<link rel="alternate" hreflang="x-default" href="${escapeHtml(urlFor(def))}">`,
    );
  }
  return tags.join("\n  ");
}

/**
 * Qualify cross-page anchor links in the published HTML.
 *
 * The shared nav + footer render identically on every page, so a bare
 * `#recenzie` link only resolves on the page that actually contains
 * `#recenzie`. On every OTHER page the live static site (no JS router)
 * just appends the hash to the current URL and goes nowhere — e.g.
 * clicking it from /first stuck the URL at /first#recenzie (Peter
 * 2026-05-28). The composer preview hides this because it has a JS
 * router that searches all pages; the deployed site doesn't.
 *
 * Fix: for each page, rewrite any bare `#x` anchor whose target id is NOT
 * on that page into a root-relative link pointing at whichever page DOES
 * contain it (`/#x` for home, `/second#x` for a subpage). Genuine
 * same-page anchors (a hero CTA scrolling to the contact section on the
 * same page) are left bare so they keep their smooth in-page scroll.
 * Already-qualified links (`/#x`, `o-nas.html#x`) start with `/` or a
 * path — not `#` — so the `a[href^="#"]` selector skips them. Only pages
 * we actually rewrite get re-serialized (single-page sites are untouched).
 */
/** Root-relative href to a page within a specific locale target.
 *  Home → "/" (default) or "/de" (sub-locale); subpage → "/o-nas" or
 *  "/de/o-nas". Used by the language switcher links. */
export function localePageHref(
  target: LocaleRenderTarget,
  pagePath: string,
  homePath: string,
): string {
  const isHome = pagePath === homePath || pagePath === "index.html";
  const prefix = target.prefix ? `/${target.prefix.replace(/\/$/, "")}` : "";
  const clean = isHome ? "" : `/${pagePath.replace(/\.html$/, "")}`;
  return `${prefix}${clean}` || "/";
}

/** One-time `<style>` for the live-site language-switcher dropdown.
 *  Injected into <head> once per page. Uses theme vars so the dropdown
 *  menu is readable on any nav (light / dark / glass); the trigger text
 *  inherits the navbar color. Built on native <details>/<summary> so the
 *  dropdown works with zero JavaScript (tap/click toggles it) — important
 *  for the static Cloudflare deploy. */
const LANG_SWITCHER_STYLE = `
.sk-lang-switcher{position:relative;display:inline-block;font-size:0.85rem}
.sk-lang-switcher>summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:6px 10px;color:inherit;font-weight:600;border:1px solid color-mix(in srgb,currentColor 30%,transparent);border-radius:8px;user-select:none;transition:border-color 0.2s ease,background 0.2s ease}
.sk-lang-switcher>summary:hover{border-color:color-mix(in srgb,currentColor 55%,transparent);background:color-mix(in srgb,currentColor 8%,transparent)}
.sk-lang-switcher>summary::-webkit-details-marker{display:none}
.sk-lang-switcher>summary::marker{content:""}
.sk-lang-switcher__flag{display:inline-flex;align-items:center;flex:none}
.sk-lang-switcher__flag svg{height:14px;width:auto;display:block;border-radius:2px;box-shadow:0 0 0 1px color-mix(in srgb,currentColor 25%,transparent)}
.sk-lang-switcher__caret{font-size:0.95em;line-height:1;opacity:0.85;transition:transform 0.2s ease}
.sk-lang-switcher[open] .sk-lang-switcher__caret{transform:rotate(180deg)}
.sk-lang-menu{position:absolute;right:0;top:calc(100% + 6px);min-width:170px;background:var(--color-bg,#fff);color:var(--color-text,#1c1917);border:1px solid var(--color-border,rgba(0,0,0,0.1));border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,0.15);padding:6px;z-index:1000;display:flex;flex-direction:column;gap:2px}
.sk-lang-menu a{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:7px;color:var(--color-text,#1c1917);text-decoration:none;font-weight:500;white-space:nowrap;font-size:0.9rem}
.sk-lang-menu a:hover{background:var(--color-bg-alt,rgba(0,0,0,0.05))}
.sk-lang-menu a[aria-current="true"]{font-weight:700;color:var(--color-primary,inherit)}
.sk-lang-flag{display:inline-flex;align-items:center;flex:none}
.sk-lang-flag svg{height:15px;width:auto;display:block;border-radius:2px;box-shadow:0 0 0 1px rgba(0,0,0,0.18)}
.sk-lang-mobile-item .sk-lang-flag{margin-right:8px;vertical-align:middle}
@media (min-width:901px){.sk-lang-mobile-item{display:none !important}}
@media (max-width:900px){.sk-lang-switcher--bar{display:none !important}}
`.trim();

/** Inline SVG flags for the language switcher — one tiny vector per locale.
 *  Real graphics (NOT emoji), so they render identically on every OS,
 *  including Windows where flag emojis fall back to bare letters
 *  (see git history / the i18n memory). Authored compact + recognizable at
 *  ~15px chip size: DE/PL/CZ are exact; the Union Jack is simplified
 *  (symmetric saltire) and SK carries a stylized double cross to set it
 *  apart from other white/blue/red tricolors. EN → UK flag by convention.
 *  Sized + bordered via the `.sk-lang-flag svg` / `__flag svg` CSS above. */
const LOCALE_FLAG_SVG: Record<SiteLocale, string> = {
  en: `<svg viewBox="0 0 60 30" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="60" height="30" fill="#012169"/><path d="M0 0 60 30M60 0 0 30" stroke="#fff" stroke-width="6"/><path d="M0 0 60 30M60 0 0 30" stroke="#C8102E" stroke-width="3.5"/><path d="M30 0V30M0 15H60" stroke="#fff" stroke-width="10"/><path d="M30 0V30M0 15H60" stroke="#C8102E" stroke-width="6"/></svg>`,
  cs: `<svg viewBox="0 0 6 4" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="6" height="2" fill="#fff"/><rect y="2" width="6" height="2" fill="#D7141A"/><path d="M0 0 3 2 0 4Z" fill="#11457E"/></svg>`,
  pl: `<svg viewBox="0 0 8 5" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="8" height="5" fill="#fff"/><rect y="2.5" width="8" height="2.5" fill="#DC143C"/></svg>`,
  de: `<svg viewBox="0 0 5 3" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="5" height="1" fill="#000"/><rect y="1" width="5" height="1" fill="#D00"/><rect y="2" width="5" height="1" fill="#FFCE00"/></svg>`,
  sk: `<svg viewBox="0 0 9 6" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="9" height="2" fill="#fff"/><rect y="2" width="9" height="2" fill="#0B4EA2"/><rect y="4" width="9" height="2" fill="#EE1C25"/><path d="M1 1.2H4V3.5Q4 4.7 2.5 5.2Q1 4.7 1 3.5Z" fill="#EE1C25" stroke="#fff" stroke-width="0.22"/><rect x="2.4" y="1.6" width="0.2" height="2.7" fill="#fff"/><rect x="2.1" y="2.15" width="0.8" height="0.22" fill="#fff"/><rect x="1.95" y="3" width="1.1" height="0.24" fill="#fff"/></svg>`,
};

/**
 * Inject a language-switcher DROPDOWN into the navbar of every page in a
 * locale group. The trigger is the CURRENT language's flag + a caret;
 * opening it reveals the available languages (flag + full name), each
 * linking to the equivalent page. The active locale is marked with
 * aria-current. Built on native <details>/<summary> so it toggles with no
 * JavaScript. Prefers the `.nav-actions` cluster, falling back to
 * `.site-nav` / `<nav>`. A one-time <style> block goes into <head>.
 *
 * Flags are INLINE SVG (Peter 2026-05-28), not emoji: flag emojis don't
 * render on Windows (they fall back to bare ISO letters), so we draw each
 * flag as a tiny vector that renders identically on every OS. See
 * LOCALE_FLAG_SVG above.
 *
 * Mobile (Peter 2026-05-28): the bordered bar switcher overflowed the tight
 * condensed/hamburger bar (≤900px in every nav template). So below 900px the
 * bar switcher is hidden (`--bar` modifier) and one `<li>` per language is
 * appended into `.nav-links` (the menu list that becomes the hamburger
 * overlay). Those items inherit the template's own mobile-menu styling, so
 * they read as native menu rows and pick up the right color/alignment on
 * each template — no hand-tuned per-template CSS. They're hidden on desktop
 * (≥901px) where the bar switcher takes over.
 */
export function injectLanguageSwitcher(
  pages: RenderedPage[],
  targets: LocaleRenderTarget[],
  currentTarget: LocaleRenderTarget,
  homePath: string,
): void {
  const currentFlag =
    LOCALE_FLAG_SVG[(currentTarget.locale ?? "sk") as SiteLocale] ?? "";

  for (const page of pages) {
    const $ = loadCheerio(page.html, { xmlMode: false });
    const nav = $(".site-nav").first().length
      ? $(".site-nav").first()
      : $("nav").first();
    if (!nav.length) continue;
    const actions = nav.find(".nav-actions").first();
    const host = actions.length ? actions : nav;

    // One-time style block in <head> (or fall back to the nav if no head).
    if (!$("#sk-lang-switcher-style").length) {
      const styleTag = `<style id="sk-lang-switcher-style">${LANG_SWITCHER_STYLE}</style>`;
      const head = $("head").first();
      if (head.length) head.append(styleTag);
      else nav.before(styleTag);
    }

    // One <a> per locale — reused for the desktop dropdown menu AND, wrapped
    // in an <li>, for the mobile in-menu list.
    const localeAnchors = targets.map((t) => {
      const href = localePageHref(t, page.path, homePath);
      const loc = (t.locale ?? "sk") as SiteLocale;
      const lang = LOCALE_HTML_LANG[loc];
      const isCurrent = t.locale === currentTarget.locale;
      const current = isCurrent ? ' aria-current="true"' : "";
      return `<a href="${escapeHtml(href)}" hreflang="${lang}"${current}><span class="sk-lang-flag">${LOCALE_FLAG_SVG[loc]}</span>${escapeHtml(LOCALE_LABELS[loc])}</a>`;
    });
    const itemsHtml = localeAnchors.join("");

    // The mobile menu list (`.nav-links`) doubles as the hamburger overlay on
    // ≤900px. When present, the bar switcher hides on mobile (`--bar`) and the
    // languages live inside the overlay as native menu rows instead.
    const navLinks = nav.find(".nav-links").first();
    const hasMobileMenu = navLinks.length > 0;

    const barClass = hasMobileMenu
      ? "sk-lang-switcher sk-lang-switcher--bar"
      : "sk-lang-switcher";
    const switcherHtml = `<details class="${barClass}"><summary aria-label="Language"><span class="sk-lang-switcher__flag">${currentFlag}</span><span class="sk-lang-switcher__caret">▾</span></summary><div class="sk-lang-menu">${itemsHtml}</div></details>`;
    // Position the bar switcher just BEFORE the phone CTA so it sits between
    // the social icons and the call button (Peter 2026-05-28). Falls back to
    // appending at the end of the actions cluster for navs that have no CTA.
    const cta = host.find(".nav-cta").first();
    if (cta.length) cta.before(switcherHtml);
    else host.append(switcherHtml);

    // Mobile: append one menu row per language into the overlay list.
    if (hasMobileMenu) {
      const mobileItemsHtml = localeAnchors
        .map((a) => `<li class="sk-lang-mobile-item">${a}</li>`)
        .join("");
      navLinks.append(mobileItemsHtml);
    }
    page.html = $.html({ xmlMode: false });
  }
}

export function qualifyCrossPageAnchors(
  pages: RenderedPage[],
  homePath: string,
  localeUrlPrefix = "",
): void {
  // Parse each page once. Record which ids live on it + the first page
  // each id appears on (page order is home-first, so a content anchor
  // maps to its hosting page rather than a shared nav/footer repeat).
  const parsed: Array<{
    page: RenderedPage;
    ids: Set<string>;
    $: ReturnType<typeof loadCheerio>;
  }> = [];
  const idToPage = new Map<string, string>();
  for (const page of pages) {
    const $ = loadCheerio(page.html, { xmlMode: false });
    const ids = new Set<string>();
    $("[id]").each((_i, el) => {
      const id = $(el).attr("id");
      if (id) {
        ids.add(id);
        if (!idToPage.has(id)) idToPage.set(id, page.path);
      }
    });
    parsed.push({ page, ids, $ });
  }

  for (const { page, ids, $ } of parsed) {
    let changed = false;
    $('a[href^="#"]').each((_i, el) => {
      const href = $(el).attr("href") || "";
      const id = href.slice(1);
      if (!id) return; // bare "#" (back-to-top / placeholder) — leave alone
      if (ids.has(id)) return; // target on THIS page — keep the in-page scroll
      const targetPage = idToPage.get(id);
      if (!targetPage) return; // unknown anchor — nothing to point at
      $(el).attr(
        "href",
        `${pageAnchorPrefix(targetPage, homePath, localeUrlPrefix)}#${id}`,
      );
      changed = true;
    });

    // ── Active-page indication ──
    // Stamp aria-current="page" on the nav/header link that points at the
    // page being rendered, so screen readers announce it and CSS can
    // highlight it (template-base.css styles [aria-current="page"] inside
    // the nav). Scoped to nav/header so footer links + CTAs that happen
    // to point at the current page don't get marked.
    $("nav a[href], header a[href], .site-nav a[href]").each((_i, el) => {
      const href = $(el).attr("href") || "";
      if (
        hrefTargetsPage(href, page.path, homePath) &&
        $(el).attr("aria-current") !== "page"
      ) {
        $(el).attr("aria-current", "page");
        changed = true;
      }
    });

    if (changed) page.html = $.html({ xmlMode: false });
  }
}

/**
 * Does `href` point at the page whose path is `pagePath`? Used to mark
 * the active nav link. Matches the ".html" form, the deployed clean-URL
 * form ("/o-nas"), and the bare stem; for the home page it also matches
 * "/", "index.html", and "index". Fragment-only ("#x"), external, and
 * scheme links never match (they're not page navigation).
 */
function hrefTargetsPage(
  href: string,
  pagePath: string,
  homePath: string,
): boolean {
  if (!href) return false;
  const base = href.split("#")[0];
  if (!base) return false; // pure "#fragment" — not a page link
  if (/^(https?:|mailto:|tel:|ftp:|sms:)/i.test(base)) return false;
  const norm = base.replace(/^\//, "").replace(/\.html$/, "");
  const isHome = pagePath === homePath || pagePath === "index.html";
  if (isHome) return norm === "" || norm === "index";
  return norm === pagePath.replace(/\.html$/, "");
}

function renderSection(
  fetched: Map<
    string,
    { id: string; html: string; placeholder_schema: PlaceholderSchema }
  >,
  templateId: string,
  overrides: Record<string, FieldValue>,
  fieldStyles?: Record<string, FieldStyle>,
  hiddenFields?: string[],
  brand?: SiteBrand | null,
): string {
  const t = fetched.get(templateId);
  if (!t) return "";
  // Brand-contact override layer — site-wide phone/email/address from
  // composition.brand stamped onto every matching field key in this
  // template's schema. Applied AFTER the caller's logo overrides so
  // any future overlap (a `phone` key on the brand template? unlikely,
  // but defensively last-write-wins) resolves the brand-contact way.
  const effectiveOverrides = withBrandContact(
    overrides as Record<string, unknown>,
    t.placeholder_schema as unknown as Parameters<typeof withBrandContact>[1],
    brand,
  ) as Record<string, FieldValue>;
  return applyContentOverrides(
    t.html,
    effectiveOverrides,
    t.placeholder_schema,
    fieldStyles,
    hiddenFields,
  );
}

function buildScriptTags(
  proposalSlug: string | null | undefined,
  /**
   * True iff at least one section in the composition is a "live"
   * contact form (form_enabled === "true" + form_recipient_email
   * non-empty). When true, contact-handler.js is injected — but
   * WITHOUT a data-email attribute, because every <form> on the page
   * carries its own data-sk-form-recipient (set by parser.ts Pass 6).
   * Replaces the older per-site `businessEmail` lookup that pulled
   * one email from contacts.business_email.
   */
  hasActiveContactForm: boolean,
  showBanner: boolean,
): string[] {
  const tags: string[] = [];

  // Payment widget — opt-IN switch model (Peter 2026-05-15):
  //
  //   - show_banner = true              → script tag IN the HTML → banner renders
  //   - show_banner = false/null/unset  → script tag OMITTED  → no banner
  //
  // The previous default-true behavior shipped the banner on the
  // first publish before any discount was configured, so live sites
  // displayed the widget with empty/default prices. Now nothing
  // appears until sales explicitly configures the banner via the
  // BannerConfigDialog (which sets discount + base prices AND flips
  // show_banner=true atomically, then auto-republishes via
  // /api/sites/[id]/publish so the deployed HTML reflects the change).
  //
  // CRITICAL: the script src must be ABSOLUTE, pointing at the
  // dashboard origin. Inside the widget, `API_URL` is computed as
  // `script.src.origin + "/api/public/proposals/..."`, so the
  // script HAS to live on a host that actually serves those API
  // routes. Cloudflare Pages doesn't — it's a static deploy.
  // Hardcoded fallback to the production URL so the widget keeps
  // working even if NEXT_PUBLIC_SITE_URL is unset on Vercel.
  const dashboardOrigin = (
    process.env.NEXT_PUBLIC_SITE_URL || "https://sharkmedia-zone.vercel.app"
  ).replace(/\/$/, "");
  if (showBanner && proposalSlug) {
    tags.push(
      `<script src="${dashboardOrigin}/proposal-widget.js?slug=${encodeURIComponent(proposalSlug)}" defer></script>`,
    );
  }

  // Contact handler — same absolute-URL rule as the payment widget.
  // The script needs to live on the dashboard so its POST to
  // /api/public/contact actually hits a route, not a 404 on the
  // static Cloudflare deploy. No data-email attribute now: each <form>
  // on the rendered HTML carries its own data-sk-form-recipient (set
  // by parser.ts Pass 6) and contact-handler.js scans them all on load.
  if (hasActiveContactForm) {
    tags.push(
      `<script src="${dashboardOrigin}/contact-handler.js" defer></script>`,
    );
  }

  // (editor-helper.js removed from live deployments 2026-05-10. It
  //  was a 25-line SCROLL_TO_SECTION listener used by the legacy
  //  inline-editor flow. The new composer renders its own iframe
  //  internally and the proxy-preview route injects its own inline
  //  copy of the same handler — the deployed-site copy was dead
  //  weight. The script still ships in public/ for any leftover
  //  flows that might reach for it during a transition window.)

  // Scroll-reveal — adds .visible to .fade-up / .fade-left / .fade-right
  // elements as they enter the viewport. Required for any template that uses
  // these classes (hero, about, sections, etc.) to ever appear.
  tags.push(
    `<script>(function(){var els=document.querySelectorAll('.fade-up, .fade-left, .fade-right');if(!els.length)return;if(!('IntersectionObserver' in window)){els.forEach(function(el){el.classList.add('visible');});return;}var io=new IntersectionObserver(function(entries){entries.forEach(function(e){if(e.isIntersecting){e.target.classList.add('visible');io.unobserve(e.target);}});},{rootMargin:'0px 0px -10% 0px',threshold:0.05});els.forEach(function(el){io.observe(el);});})();</script>`,
  );

  return tags;
}

/**
 * Type for the fetched-templates map renderSite builds upstream. Re-
 * declared here as a structural minimum so the helper below can be
 * called without dragging the whole FetchedTemplate shape.
 */
type TemplateLookup = Map<
  string,
  { placeholder_schema: PlaceholderSchema }
>;

/**
 * Decide whether the rendered composition contains ANY "active" contact
 * form, i.e. a section whose schema declares both
 * `form_recipient_email` (text) and `form_enabled` (boolean), AND whose
 * resolved values (override → default fallback) are `enabled === true`
 * + `email non-empty`. Used to gate contact-handler.js injection: no
 * point shipping the script if no form on the site is wired up.
 *
 * We also include shared nav/footer in the scan even though no nav/
 * footer template currently has a form — keeps the gate future-proof
 * if a footer ever sprouts a mini "Get in touch" widget.
 */
/**
 * Sibling of doesCompositionHaveActiveContactForm. Returns every section
 * that LOOKS like an enabled contact form (schema declares the reserved
 * `form_recipient_email` + `form_enabled` pair, and `form_enabled`
 * resolves to "true") but has NO recipient email — the exact silent-
 * failure shape that ships a dead form. publishSite/renderSite calls
 * this on the publish path to throw before deployment instead of
 * letting the contact-handler.js no-op fire on the live site.
 *
 * Shared nav/footer are intentionally NOT scanned: no nav/footer
 * template currently has a form, and a shared-slot recipient would
 * have no per-page page label to surface in the error.
 */
function collectBrokenContactForms(
  composition: SiteComposition,
  fetched: TemplateLookup,
  brand: SiteBrand | null | undefined,
): Array<{ pagePath: string; pageLabel: string; templateId: string }> {
  const issues: Array<{
    pagePath: string;
    pageLabel: string;
    templateId: string;
  }> = [];
  for (const page of composition.pages) {
    for (const sec of page.sections) {
      const tpl = fetched.get(sec.template_id);
      if (!tpl) continue;
      const schema = tpl.placeholder_schema;
      if (
        schema.form_recipient_email?.type !== "text" ||
        schema.form_enabled?.type !== "boolean"
      ) {
        continue;
      }
      // Apply the SAME brand-contact fallback the renderer applies, so
      // the validator's view of the resolved value matches what ships.
      // Without this, sections that rely on brand.email auto-filling
      // form_recipient_email (a key matching the email regex) fail
      // validation here even though the live render would work fine.
      const rawOverrides = (sec.content_overrides ?? {}) as Record<
        string,
        unknown
      >;
      const overrides = withBrandContact(
        rawOverrides,
        schema as unknown as Parameters<typeof withBrandContact>[1],
        brand,
      );
      const emailRaw =
        typeof overrides.form_recipient_email === "string"
          ? overrides.form_recipient_email
          : (schema.form_recipient_email.default ?? "");
      const enabledRaw =
        typeof overrides.form_enabled === "string"
          ? (overrides.form_enabled as string)
          : (schema.form_enabled.default ?? "false");
      const enabled = enabledRaw.trim().toLowerCase() === "true";
      // Strip TipTap wrap + autolink. A saved `<p><a href="mailto:…">x</a></p>`
      // would pass a naive `.trim()` non-empty check, but Pass 6's
      // sibling htmlToPlainText collapses it to `x` — keep both views
      // in lockstep so the validator matches what gets stamped.
      const email = htmlToPlainText(emailRaw);
      if (enabled && !email) {
        issues.push({
          pagePath: page.path,
          pageLabel: page.label,
          templateId: sec.template_id,
        });
      }
    }
  }
  return issues;
}

function doesCompositionHaveActiveContactForm(
  composition: SiteComposition,
  fetched: TemplateLookup,
  brand: SiteBrand | null | undefined,
): boolean {
  const sectionsToCheck: Array<{
    template_id: string;
    content_overrides?: Record<string, unknown>;
  }> = [];
  for (const page of composition.pages) {
    for (const sec of page.sections) {
      sectionsToCheck.push({
        template_id: sec.template_id,
        content_overrides: sec.content_overrides as
          | Record<string, unknown>
          | undefined,
      });
    }
  }
  if (composition.shared?.nav_template_id) {
    sectionsToCheck.push({
      template_id: composition.shared.nav_template_id,
      content_overrides: composition.shared.nav_overrides,
    });
  }
  if (composition.shared?.footer_template_id) {
    sectionsToCheck.push({
      template_id: composition.shared.footer_template_id,
      content_overrides: composition.shared.footer_overrides,
    });
  }
  for (const sec of sectionsToCheck) {
    const tpl = fetched.get(sec.template_id);
    if (!tpl) continue;
    const schema = tpl.placeholder_schema;
    if (
      schema.form_recipient_email?.type !== "text" ||
      schema.form_enabled?.type !== "boolean"
    ) {
      continue;
    }
    // Same brand-contact + HTML-strip resolution as collectBrokenContactForms.
    // Keeps the "should I inject contact-handler.js?" decision in step
    // with the actual rendered output.
    const rawOverrides = sec.content_overrides ?? {};
    const overrides = withBrandContact(
      rawOverrides,
      schema as unknown as Parameters<typeof withBrandContact>[1],
      brand,
    );
    const emailRaw =
      typeof overrides.form_recipient_email === "string"
        ? overrides.form_recipient_email
        : (schema.form_recipient_email.default ?? "");
    const enabledRaw =
      typeof overrides.form_enabled === "string"
        ? (overrides.form_enabled as string)
        : (schema.form_enabled.default ?? "false");
    if (
      enabledRaw.trim().toLowerCase() === "true" &&
      htmlToPlainText(emailRaw) !== ""
    ) {
      return true;
    }
  }
  return false;
}

function wrapPage(args: {
  cssInline: string;
  themeStyleTag: string;
  /** SEO + social-share <meta> tags including <title>. Built by buildHeadMeta. */
  headMeta: string;
  /** `<link>` tags for Google Fonts derived from the site's theme.
   *  Empty string falls back to the default Space Grotesk + DM Sans
   *  load below — keeps existing sites looking identical when no font
   *  pair is explicitly chosen. */
  fontsLinkTag: string;
  bodyHtml: string;
  scriptTags: string[];
  /** `<html lang="…">` value. Defaults to "sk" so single-language sites
   *  with no i18n block render exactly as before. */
  htmlLang?: string;
  /** Extra raw `<head>` markup (currently hreflang alternate links for
   *  multi-locale sites). Empty string for single-language sites. */
  headExtra?: string;
}): string {
  // Default fonts only load when the theme hasn't chosen custom ones —
  // saves a request when the user picked something else.
  const defaultFonts = args.fontsLinkTag
    ? ""
    : `<link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">`;
  const lang = args.htmlLang || "sk";
  const headExtra = args.headExtra ? `\n  ${args.headExtra}` : "";
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${args.headMeta}${headExtra}
  ${args.fontsLinkTag}
  ${defaultFonts}
  <style>${args.cssInline}</style>
  ${args.themeStyleTag}
</head>
<body>
${args.bodyHtml}
${args.scriptTags.join("\n")}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Layer the brand logo onto an overrides map for a specific field key.
 *
 * Two modes:
 *   - "override" (default, used by nav): the brand logo always wins.
 *     Any pre-existing override at fieldKey gets discarded so the Brand
 *     panel stays the single source of truth for the navbar logo.
 *   - "fallback" (used by footer since 2026-05-15): the brand logo is
 *     applied ONLY when the section override is missing or empty.
 *     A non-empty override (e.g. tech uploaded a different file
 *     specifically for the footer) is preserved as-is.
 *
 * The footer mode-switch enables Peter's request: same brand logo in
 * nav + footer by default, but the footer can carry its own logo
 * upload when the navbar mark and the footer plate need to look
 * different (small mono mark in the navbar, larger wordmark in the
 * footer is the common case).
 *
 * If the template doesn't have the field, the override is harmless
 * (parser silently ignores unknown keys).
 */
function withBrandLogo(
  overrides: Record<string, FieldValue>,
  fieldKey: string,
  logoUrl: string,
  mode: "override" | "fallback" = "override",
): Record<string, FieldValue> {
  if (mode === "fallback") {
    const existing = overrides[fieldKey];
    const isEmpty =
      existing === undefined ||
      existing === null ||
      (typeof existing === "string" && existing.trim().length === 0);
    if (!isEmpty) return overrides;
  }
  return { ...overrides, [fieldKey]: logoUrl };
}
