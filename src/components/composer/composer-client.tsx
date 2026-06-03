"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileJson,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { SectionsRail } from "./sections-rail";
import { SectionCard } from "./section-card";
import { PublishMenu } from "./publish-menu";
import { type SectionTemplate } from "./variant-picker";
import { PreviewPane } from "./preview-pane";
import { PagesTabs } from "./pages-tabs";
import { EmptyStateCard } from "./empty-state-card";
import { pickScaffoldPrimary } from "@/lib/composer/scaffold-palette";
import { type FieldSchema, type FieldValue } from "./placeholder-field";
import { FieldsList } from "./fields-list";
import { ThemePanel } from "./theme-panel";
import { BrandSection } from "./brand-section";
import { FooterLogoCard } from "./footer-logo-card";
import { AiGenerateModal, type AiOverrides } from "./ai-generate-modal";
import { JsonRoundtripModal } from "./json-roundtrip-modal";
import {
  SEO_VIRTUAL_SECTION_ID,
  NAV_VIRTUAL_SECTION_ID,
  FOOTER_VIRTUAL_SECTION_ID,
  buildHomeReferenceMarkdown,
  type JsonRoundtripTemplate,
  type JsonRoundtripPageContext,
  type RoundtripSnapshot,
} from "@/lib/composer/json-roundtrip";
import { SeoPanel } from "./seo-panel";
import { LanguagesPanel } from "./languages-panel";
import {
  LOCALE_LABELS,
  LOCALE_SHORT,
  type SiteLocale,
  type SiteI18n,
} from "@/lib/i18n/locales";
import { localizeComposition } from "@/lib/i18n/localize";
import {
  renderInBrowser,
  renderMultiPagePreview,
  type TemplateBody,
} from "@/lib/templates/render-browser";
import type {
  SiteComposition,
  CompositionSection,
  CompositionPage,
} from "@/lib/templates/render";
import { syncNavDropdownFromServices } from "@/lib/composer/nav-dropdown-sync";
import {
  buildGoogleFontsUrl,
  buildThemeCss,
  type SiteTheme,
} from "@/lib/templates/theme";
import type { SiteSeo, PageSeo } from "@/lib/templates/seo";
import { slugifyAnchorId, dedupeAnchorId } from "@/lib/templates/slugify";
import { htmlToPlainText } from "@/lib/templates/sanitize";
import { makeDefaultBrand, resolveBrand, type SiteBrand } from "@/lib/composer/brand";
import {
  collectPendingKeys,
  getPendingFile,
  deletePendingImage,
  prefetchPendingBlobUrls,
  getCachedBlobUrl,
  isPendingUrl,
  SiteUrlContext,
} from "@/lib/composer/image-store";
import {
  UploadTrackerContext,
  useCreateUploadTracker,
} from "@/lib/composer/upload-tracker";
import { migrateLegacyNavOverrides } from "@/lib/composer/legacy-nav-overrides";
import {
  collectPageAnchors,
  collectPageEntries,
  computeRenderedSectionIds,
  clearLinksToPage,
  type AnchorEntry,
  type AnchorSchemaEntry,
} from "@/lib/composer/page-anchors";
import { AnchorsProvider } from "./anchors-context";

const HOME_PATH = "index.html";
const HOME_LABEL = "Home";

/**
 * Map an app role to the team label shown in the stale-data banner.
 */
/**
 * "tech" = full IT-side composer (default). Has the section rail, empty-
 * state generator, regenerate button, section remove + variant-swap, the
 * subdomain editor, and the publish-history/revert list.
 *
 * "client" = locked-down client-side composer. Same engine, same field
 * editors, same publish path — but structural changes are gated. Clients
 * can edit content (text, images, links, theme, SEO) and publish their
 * edits live, but cannot add/remove sections, swap templates, change the
 * subdomain, or revert to old versions. Tech admin still owns the
 * structure of a client site.
 */
export type ComposerMode = "tech" | "client";

interface Props {
  siteId: string;
  siteName: string;
  initialComposition: SiteComposition;
  templates: SectionTemplate[];
  /** Pre-loaded HTML/CSS bodies for every published template, keyed by id */
  templateBodies: Record<string, TemplateBody>;
  /** Base CSS shared by every template (preview + published) */
  baseCss: string;
  /** When opened from the proposal-driven path */
  proposalId?: string;
  /** Where to send the user after publishing */
  backHref?: string;
  /** Site's published URL (e.g. https://abc.pages.dev). Used by the iframe
   *  + sidebar thumbnails to resolve relative `/_uploads/` paths from prior
   *  publishes. Null until the site has been published at least once. */
  siteUrl?: string | null;
  /** Cloudflare Pages `.pages.dev` URL for this site (e.g.
   *  https://{project}.pages.dev). Preferred over `siteUrl` for the
   *  iframe `<base href>` because it's fronted directly by Cloudflare
   *  with no DNS step — works the instant a deployment exists.
   *
   *  `siteUrl` carries the friendly URL (custom domain or *.pages.dev
   *  subdomain) which can be unreachable for minutes/hours after any
   *  hostname change while DNS+SSL propagates. Using the pages.dev URL
   *  for asset resolution sidesteps that whole window — first publish,
   *  republish, subdomain rename, custom-domain attach. */
  pagesUrl?: string | null;
  /** Which audience is using the composer right now. Defaults to "tech"
   *  so the existing tech-admin path is unchanged when the prop is omitted. */
  mode?: ComposerMode;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function ComposerClient({
  siteId,
  siteName,
  initialComposition,
  templates,
  templateBodies,
  baseCss,
  backHref = "/tech/proposals",
  siteUrl = null,
  pagesUrl = null,
  mode = "tech",
}: Props) {
  const router = useRouter();
  // Stable boolean for the conditional renders below. Cuts down on
  // `mode === "client"` repetition and makes the gates self-documenting
  // ("if not client mode, render…") at the call sites.
  const isClientMode = mode === "client";

  // Track whether the initial composition needed a legacy-nav rewrite.
  // Set inside the useState initializer below; persisted on mount via
  // scheduleSave so the new override shape lands in DB on the very
  // first autosave (otherwise a user who never edits the nav would
  // keep loading the legacy shape on every open).
  const navMigrationNeedsPersistRef = useRef(false);

  // Multi-page composition hydrator (2026-05-23). Used to force the
  // composition down to a single page as a defensive measure before
  // subpages shipped; the force was REMOVED once PagesTabs landed —
  // it was silently wiping every non-home page on reload.
  //
  // We still normalize the home page in case the DB row is missing
  // it (legacy / fresh-init scenarios): index.html must always
  // exist as the first page, and its label falls back to HOME_LABEL
  // if absent. Subpages from the DB pass through untouched.
  const [composition, setComposition] = useState<SiteComposition>(() => {
    const rawPages = initialComposition.pages ?? [];
    const firstPage =
      rawPages[0] ?? { path: HOME_PATH, label: HOME_LABEL, sections: [] };
    // Auto-init brand for legacy/fresh sites that have no `brand` field
    // yet. Use the site name as the company text fallback so the
    // generated SVG is at least recognizably theirs from the first
    // render. Idempotent: existing brand records are preserved as-is.
    const brand: SiteBrand =
      initialComposition.brand ?? makeDefaultBrand(siteName);
    const normalizedFirst = {
      path: firstPage.path || HOME_PATH,
      label: firstPage.label || HOME_LABEL,
      sections: firstPage.sections ?? [],
    };
    const base: SiteComposition = {
      ...initialComposition,
      brand,
      pages: [normalizedFirst, ...rawPages.slice(1)],
    };
    // One-time legacy-nav rewrite. Existing sites stored their menu in
    // four separate keys (nav_links_before/_link_services/_services_
    // dropdown/_links_after); the new schema collapses them into a
    // single `nav_links` repeater with optional nested `dropdown_items`.
    // The shim is idempotent + schema-gated, so passing already-new
    // data through is a guaranteed no-op.
    const tplLookup = new Map<string, { placeholder_schema: unknown }>();
    for (const t of templates) tplLookup.set(t.id, { placeholder_schema: t.placeholder_schema });
    const migrated = migrateLegacyNavOverrides(
      base,
      tplLookup as Parameters<typeof migrateLegacyNavOverrides>[1],
    );
    if (migrated !== base) navMigrationNeedsPersistRef.current = true;
    return migrated;
  });

  // Persist the auto-init the first time it happens so future opens skip
  // it. Only fires when initialComposition.brand was missing — existing
  // sites with a brand record never trigger this.
  const brandInitNeedsPersistRef = useRef(!initialComposition.brand);
  useEffect(() => {
    if (!brandInitNeedsPersistRef.current && !navMigrationNeedsPersistRef.current) {
      return;
    }
    brandInitNeedsPersistRef.current = false;
    navMigrationNeedsPersistRef.current = false;
    // Use scheduleSave so it coalesces with any other early edits.
    scheduleSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Brand-contact pre-fill from proposal contact ──
  // On first composer open, if `composition.brand.phone` / `.email` are
  // empty and the linked proposal's contact has values, copy them in
  // automatically. Same one-shot pattern as the brand-init effect
  // above — autosave persists, future opens see the populated brand
  // and skip the fetch.
  //
  // Why client-side vs server-side: 4 different page entry points feed
  // ComposerClient (tech proposals, sales proposals, tech sites, client
  // sites) — centralizing the fill here avoids duplicating the proposal
  // join in every page. Cost: one /api/composer/ai-inputs fetch per
  // mount on sites missing brand contact (one-time per site lifetime).
  // Tech-admin's manual edits in the Brand panel are NEVER overwritten
  // — the empty-check gates the patch.
  useEffect(() => {
    const brand = composition.brand;
    if (brand?.phone && brand?.email) return; // both already set, nothing to fill
    let cancelled = false;
    fetch(`/api/composer/ai-inputs?site_id=${encodeURIComponent(siteId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { inputs?: { contactPhone?: string; contactEmail?: string } } | null) => {
        if (cancelled || !data?.inputs) return;
        const phone = data.inputs.contactPhone?.trim() ?? "";
        const email = data.inputs.contactEmail?.trim() ?? "";
        // Only patch fields that are still empty — never overwrite a
        // value the tech-admin already typed by hand between mount and
        // the fetch resolving.
        const patch: Partial<SiteBrand> = {};
        const currentBrand = compositionRef.current.brand;
        if (phone && !currentBrand?.phone) patch.phone = phone;
        if (email && !currentBrand?.email) patch.email = email;
        if (Object.keys(patch).length > 0) updateBrand(patch);
      })
      .catch(() => {
        // Pre-fill is a best-effort nicety — silently skip on failure.
        // The Brand panel inputs still work; the tech-admin can type
        // values by hand.
      });
    return () => {
      cancelled = true;
    };
    // Mount-only: one shot per composer session. Re-fetching on every
    // brand edit would create infinite loops via updateBrand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [publishing, setPublishing] = useState(false);
  // AI Generate modal — opens from the top-bar ✨ button. The endpoint
  // returns a flat overrides map, which `applyAiOverrides` below routes
  // through the existing updateSectionContent path so SK_PATCH_FIELD
  // updates the iframe live + autosave persists. No special render
  // path; AI output is functionally identical to a user typing each
  // field by hand.
  const [aiModalOpen, setAiModalOpen] = useState(false);
  // Manual AI Fill via JSON round-trip. Same role gate + same apply
  // path as `aiModalOpen` — different surface (export to ChatGPT,
  // import back) instead of paid API call.
  const [jsonModalOpen, setJsonModalOpen] = useState(false);
  // Bumps on each successful publish to force the previewHtml memo to
  // recompute. Image URL substitutions don't change the structural key
  // (it only tracks add/remove of sections), but we DO need a fresh render
  // so the iframe replaces `pending:` URLs with the new `/_uploads/` ones.
  const [publishVersion, setPublishVersion] = useState(0);
  // Tracks every in-flight image upload kicked off by PlaceholderField
  // / BrandSection. Publish awaits this before posting so a user who
  // clicks Publish mid-upload doesn't deploy without the new image.
  // See lib/composer/upload-tracker.ts for the rationale + contract.
  const uploadTracker = useCreateUploadTracker();
  // Stores the live URL we get back from the publish API so the iframe
  // can resolve newly-substituted `/_uploads/...` paths IMMEDIATELY
  // against the just-published deployment — without waiting for
  // router.refresh() to update the server-side `siteUrl` prop.
  //
  // The race we're fixing: publish replaces Supabase staging URLs in
  // the composition with relative `/_uploads/...` paths AND deletes the
  // staging files. The iframe re-renders with the new relative paths;
  // if the <base href> is still stale (or empty on a first publish),
  // the browser hits localhost or the old domain, gets a 404, and shows
  // the broken-image alt. Using `data.friendlyUrl` from the publish
  // response fixes this without breaking the existing prop flow.
  //
  // Cleared on the next prop-driven siteUrl change (which happens after
  // router.refresh()) so subsequent edits read straight from the prop.
  const [freshlyPublishedUrl, setFreshlyPublishedUrl] = useState<string | null>(
    null,
  );
  // Effective URL used by the iframe's <base href>. Priority order:
  //   1. freshlyPublishedUrl — set synchronously after a successful
  //      publish, points at the brand-new deploy's pages.dev URL
  //      before router.refresh() finishes propagating the new siteUrl
  //      prop.
  //   2. pagesUrl — the always-working pages.dev URL fronted directly
  //      by Cloudflare. Sidesteps DNS+SSL propagation windows on
  //      first publish / subdomain rename / custom-domain attach,
  //      which is what made `Propagating…` placeholders stick around
  //      forever before this fix.
  //   3. siteUrl — friendly URL (custom domain or *.pages.dev). Last
  //      resort for legacy rows where pagesUrl couldn't be computed.
  const effectiveSiteUrl =
    freshlyPublishedUrl ?? pagesUrl ?? siteUrl ?? null;
  // Once the server-side prop reflects the just-published URL, drop the
  // local override so the prop is the single source of truth going forward.
  // We compare against BOTH props: freshlyPublishedUrl is set to the
  // publish response's pages.dev URL, so under the new world it matches
  // the `pagesUrl` prop once router.refresh() catches up. We also keep
  // the legacy siteUrl comparison for the case where pagesUrl is null
  // (no version row exists yet) and freshlyPublishedUrl fell back to
  // friendlyUrl.
  useEffect(() => {
    if (
      freshlyPublishedUrl &&
      (pagesUrl === freshlyPublishedUrl || siteUrl === freshlyPublishedUrl)
    ) {
      setFreshlyPublishedUrl(null);
    }
  }, [siteUrl, pagesUrl, freshlyPublishedUrl]);
  // Debounced full-rebuild trigger. Used for structural repeater changes
  // (add/remove/reorder items) — those rebuild the section's HTML so the
  // in-place SK_PATCH_REPEATER_ITEM path can't represent them. Field-level
  // edits go through sendIframePatch and never touch this. 300ms idle so
  // a burst of structural changes (e.g. dragging items) coalesces into a
  // single rebuild.
  const bumpPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedulePreviewBump = useCallback(() => {
    if (bumpPreviewTimer.current) clearTimeout(bumpPreviewTimer.current);
    bumpPreviewTimer.current = setTimeout(() => {
      bumpPreviewTimer.current = null;
      setPublishVersion((v) => v + 1);
    }, 300);
  }, []);

  // Section selected via click in the preview iframe (or null)
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(
    null,
  );

  // Right-panel tabs — Composition (sections, theme, nav, footer) | SEO |
  // Languages (multi-language setup). All share the same iframe preview.
  const [rightTab, setRightTab] = useState<
    "composition" | "seo" | "languages"
  >("composition");

  // When set, the translate-mode JSON round-trip modal is open for this
  // locale. Distinct from the fill-mode modal (jsonModalOpen) so the two
  // flows never collide.
  const [translateLocale, setTranslateLocale] = useState<SiteLocale | null>(
    null,
  );

  // Which locale the LEFT preview shows. null = the default/base language.
  // A non-default locale localizes the composition before rendering so the
  // operator can eyeball the translated version without publishing.
  const [previewLocale, setPreviewLocale] = useState<SiteLocale | null>(null);

  // Iframe ref so we can postMessage selection updates into the preview
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Listen for clicks coming back from the preview iframe
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const data = e.data as { type?: string; id?: string } | null;
      if (data?.type === "SK_SELECT_SECTION" && typeof data.id === "string") {
        setSelectedSectionId(data.id);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // Whenever the selected id changes, mirror it into the iframe so the matching
  // section gets the persistent selection outline.
  const selectedSectionIdRef = useRef<string | null>(selectedSectionId);
  selectedSectionIdRef.current = selectedSectionId;
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "SK_SET_SELECTED", id: selectedSectionId },
      "*",
    );
  }, [selectedSectionId]);

  // Re-send the current selection whenever the iframe (re)loads — covers the
  // race where the iframe is mid-reload (after a structural change) and a
  // click's postMessage arrives before the script is ready.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    function onLoad() {
      iframe?.contentWindow?.postMessage(
        { type: "SK_SET_SELECTED", id: selectedSectionIdRef.current },
        "*",
      );
    }
    iframe.addEventListener("load", onLoad);
    return () => iframe.removeEventListener("load", onLoad);
  }, []);

  // ── Field highlight — outlines the iframe element that maps to the
  // input the user just focused in the right panel. Fires on every
  // input focus; pass null sectionId+fieldKey to clear. Iframe-side
  // (skHighlightField) clears any previous outline before applying so
  // exactly one element is ever highlighted at a time.
  const handleFieldFocus = useCallback(
    (sectionId: string | null, fieldKey: string | null) => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "SK_HIGHLIGHT_FIELD", sectionId, fieldKey },
        "*",
      );
    },
    [],
  );

  // ── Optimistic image preview ──
  // Painting an image to the iframe WITHOUT touching composition state.
  // Image upload uses this to show the new file instantly via a local
  // blob: URL while the actual Supabase upload runs in the background.
  // We deliberately do NOT call patchPage / scheduleSave here — a blob:
  // URL is meaningful only inside this browser tab, so persisting one
  // would make the field look broken on every other device + role.
  // When the upload completes, the normal onChange flow fires with the
  // Supabase URL and the iframe transitions blob → real URL invisibly.
  const previewSectionImage = useCallback(
    (sectionId: string, fieldKey: string, url: string) => {
      iframeRef.current?.contentWindow?.postMessage(
        {
          type: "SK_PATCH_FIELD",
          sectionId,
          fieldKey,
          fieldType: "image",
          value: url,
        },
        "*",
      );
    },
    [],
  );

  // Same idea but for the brand mark — uses SK_PATCH_BRAND because the
  // nav/footer logo lives in conventional `nav_logo` / `footer_logo`
  // slots, not a regular content_overrides field. We patch both logo
  // and favicon at once since the file picker doesn't separate them.
  const previewBrandLogo = useCallback((logoUrl: string) => {
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "SK_PATCH_BRAND",
        logoUrl,
        faviconUrl: logoUrl,
      },
      "*",
    );
  }, []);

  // ── Lookups ──
  const templateMap = useMemo(() => {
    const m = new Map<string, SectionTemplate>();
    for (const t of templates) m.set(t.id, t);
    return m;
  }, [templates]);

  const templateBodyMap = useMemo(() => {
    const m = new Map<string, TemplateBody>();
    for (const id in templateBodies) m.set(id, templateBodies[id]);
    return m;
  }, [templateBodies]);

  // Services available on the home page — used by the PagesTabs Add
  // dialog to let tech-admin link a new subpage to one specific service
  // (Peter 2026-05-30).
  //
  // Item sourcing — composer writes the WHOLE services repeater array to
  // content_overrides.services whenever any item is touched. When the
  // tech-admin hasn't edited services yet, that array is undefined and
  // the renderer falls back to the template's default_items (from the
  // template's parsed HTML). The picker mirrors that fallback so a
  // fresh-but-services-laden home page still surfaces its items.
  //
  // Item identity — the renderer derives each item's id from the
  // configured `item_id_source` field (typically `title`) via
  // slugifyAnchorId at render time. `__item_id` is only stored on items
  // that have an explicit pinned-id override. We mirror the runtime
  // derivation here so `linked_service_id` matches what actually ends
  // up on the live element when subpages are eventually wired to nav.
  //
  // First services section wins (rare to have more than one on home).
  const homeServiceItems = useMemo<
    Array<{ id: string; title: string }>
  >(() => {
    const homePage = composition.pages[0];
    if (!homePage) return [];
    for (const section of homePage.sections) {
      const tpl = templateMap.get(section.template_id);
      if (!tpl || tpl.category !== "services") continue;
      const overrides = (section.content_overrides ?? {}) as Record<
        string,
        unknown
      >;
      const overrideRepeater = Array.isArray(overrides.services)
        ? (overrides.services as Array<Record<string, unknown>>)
        : null;
      // Pull default items off the parsed schema. The schema's loose
      // SectionTemplate type strips runtime fields like default_items,
      // so cast to the parser's richer shape to read them.
      const schema = tpl.placeholder_schema as unknown as Record<
        string,
        { type?: string; default_items?: Array<Record<string, unknown>> }
      >;
      const servicesField = schema?.services;
      const defaultItems =
        servicesField?.type === "repeater" &&
        Array.isArray(servicesField.default_items)
          ? servicesField.default_items
          : [];
      const items = overrideRepeater ?? defaultItems;
      if (items.length === 0) return [];
      const out: Array<{ id: string; title: string }> = [];
      const seenIds = new Set<string>();
      for (const raw of items) {
        if (!raw || typeof raw !== "object") continue;
        const item = raw as Record<string, unknown>;
        // Title strip: the title field is `data-type="richtext"` so the
        // stored value can include HTML tags (e.g. "<strong>Rope tree
        // pruning</strong>"). htmlToPlainText drops the tags so
        // the picker shows clean text + the derived slug doesn't trip
        // over angle brackets. Matches the same strip the renderer's
        // slugifyAnchorId already runs internally.
        const rawTitle =
          typeof item.title === "string" ? item.title : "";
        const title = htmlToPlainText(rawTitle).trim();
        if (!title) continue;
        // Explicit pinned id wins over derived. Derived must match the
        // renderer's anchor-id rule exactly so the saved
        // linked_service_id matches the live element later.
        const explicitId =
          typeof item.__item_id === "string" && item.__item_id.trim().length > 0
            ? item.__item_id.trim()
            : null;
        const id = explicitId ?? slugifyAnchorId(title);
        if (!id) continue;
        // Two services with the same title would collide on derived id.
        // We just skip duplicates here — the picker only needs to surface
        // distinct services. The renderer's own collision suffixing
        // (-2, -3) handles the on-page rendering.
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        out.push({ id, title });
      }
      return out;
    }
    return [];
  }, [composition.pages, templateMap]);

  // Service ids that already have a subpage linked to them. The Add-page
  // dialog renders these as disabled options ("(already assigned)" suffix)
  // so the tech-admin can't link two subpages to the same service by
  // accident. We mark-disabled rather than hide so the operator can
  // still see the full service catalog (less surprising than items
  // silently disappearing) — same UX rule we use for reserved page names.
  const linkedServiceIdsInUse = useMemo<Set<string>>(() => {
    const used = new Set<string>();
    for (const p of composition.pages) {
      const id = p.linked_service_id;
      if (typeof id === "string" && id.length > 0) used.add(id);
    }
    return used;
  }, [composition.pages]);

  // Narrowed template map for the JSON round-trip walker. The walker
  // only needs id + placeholder_schema; this avoids passing the full
  // SectionTemplate shape (with preview_image, name, etc.) through
  // the modal's prop boundary.
  const jsonRoundtripTemplateMap = useMemo(() => {
    const m = new Map<string, JsonRoundtripTemplate>();
    for (const t of templates) {
      m.set(t.id, {
        id: t.id,
        // Cast: SectionTemplate stores placeholder_schema loosely typed
        // as Record<string, { type: string; ... }>, but the runtime
        // shape IS the richer FieldSchema (parser writes it that way).
        // The walker only reads .type, .default, .item_schema, .default_items,
        // all of which are present at runtime.
        placeholder_schema: t.placeholder_schema as JsonRoundtripTemplate["placeholder_schema"],
      });
    }
    return m;
  }, [templates]);

  // ── Active page tracking ─────────────────────────────────────────────
  // Composer started single-page (always pages[0]) and grew multi-page
  // support 2026-05-23. Active page = the one currently shown in the
  // preview iframe + the sidebar lists for editing.
  //
  // Default: the first page in the composition (always exists per
  // publish.ts validation). Operator switches via the PagesTabs strip
  // at the top of the composer.
  //
  // We mirror activePagePath into a ref so handlers / patchers can read
  // the latest path without re-subscribing — same pattern as
  // compositionRef.
  const [activePagePath, setActivePagePath] = useState(
    () => composition.pages[0]?.path ?? "index.html",
  );
  const activePagePathRef = useRef(activePagePath);
  activePagePathRef.current = activePagePath;

  const activePage =
    composition.pages.find((p) => p.path === activePagePath) ??
    composition.pages[0]!;

  // Page context for the JSON round-trip modal. Resolves which page
  // the operator is editing + the matching service title (if any) +
  // a human-readable Slovak dump of the home page's filled content as
  // brand-voice reference (Peter 2026-05-30). The modal feeds this to
  // buildInstructionsBlock so subpage prompts lead with "this is the X
  // subpage about service Y" instead of generic home-style instructions.
  //
  // Returns null only for empty compositions (which shouldn't happen —
  // publish.ts guarantees pages.length >= 1). Home pages get a minimal
  // { kind: "home" } so the modal heading + prompt stay in the existing
  // (no-context) shape. Subpages get full context including the home
  // reference markdown.
  const jsonPageContext = useMemo<JsonRoundtripPageContext | null>(() => {
    const homePath = composition.pages[0]?.path ?? "index.html";
    if (!activePage) return null;
    if (activePage.path === homePath) {
      return {
        kind: "home",
        pageLabel: activePage.label,
        pagePath: activePage.path,
      };
    }
    const linkedId = activePage.linked_service_id ?? null;
    const linked = linkedId
      ? homeServiceItems.find((s) => s.id === linkedId)
      : null;
    const homeReference = buildHomeReferenceMarkdown({
      composition,
      templates: jsonRoundtripTemplateMap,
    });
    if (linked) {
      return {
        kind: "service_subpage",
        pageLabel: activePage.label,
        pagePath: activePage.path,
        linkedServiceTitle: linked.title,
        homeReferenceMarkdown: homeReference,
      };
    }
    return {
      kind: "custom_subpage",
      pageLabel: activePage.label,
      pagePath: activePage.path,
      homeReferenceMarkdown: homeReference,
    };
  }, [
    activePage,
    composition,
    homeServiceItems,
    jsonRoundtripTemplateMap,
  ]);

  // Keep a ref that always points at the latest composition so memos/patches
  // can read fresh values without subscribing.
  const compositionRef = useRef(composition);
  compositionRef.current = composition;

  /**
   * Find the active page's index in compositionRef.current. Used by
   * patchers that need to read fresh state from the ref (instead of
   * the closed-over composition value). Returns 0 if the path is
   * stale — defensive against a page being deleted mid-operation.
   */
  function findActivePageIndex(comp: SiteComposition): number {
    const path = activePagePathRef.current;
    const idx = comp.pages.findIndex((p) => p.path === path);
    return idx === -1 ? 0 : idx;
  }

  // ── Structural key: only changes when sections/templates change shape ──
  // Content edits (text, image, link, theme color) don't touch this key, so
  // the preview HTML memo doesn't recompute and the iframe doesn't reload.
  //
  // IMPORTANT (2026-05-23 multi-page): this key MUST cover every page's
  // sections, not just the active page. A `useEffect` below treats every
  // structuralKey change as "structural change worth saving immediately."
  // If we keyed off only the active page, switching tabs would change the
  // key (different sections per page) and fire a phantom network save on
  // every tab click. The previewHtml useMemo has activePagePath in its
  // own dep list so the iframe still re-renders on switch without flowing
  // through this key.
  const structuralKey = useMemo(() => {
    const pagesPart = composition.pages
      .map((page) => {
        const sectionPart = page.sections
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((s) => `${s.id}:${s.template_id}`)
          .join("|");
        return `${page.path}=${sectionPart}`;
      })
      .join("//");
    const sharedPart = `${composition.shared?.nav_template_id ?? "-"}|${
      composition.shared?.footer_template_id ?? "-"
    }`;
    return `${pagesPart}~${sharedPart}`;
  }, [
    composition.pages,
    composition.shared?.nav_template_id,
    composition.shared?.footer_template_id,
  ]);

  // ── Pending image bookkeeping ──
  // Composer needs to translate `pending:{uuid}` URLs to short-lived blob:
  // URLs before the iframe sees them. The blob cache is populated by
  // putPendingImage SYNCHRONOUSLY on upload, so the SK_PATCH_FIELD path in
  // updateSectionContent already ships a working blob: URL to the iframe
  // and patches the image in place — no rebuild needed.
  //
  // The only reason to bump `pendingBlobsReady` (which forces a full iframe
  // rebuild via the previewHtml memo) is when we had to async-fetch a key
  // from IndexedDB on mount — e.g. revisiting a composer with pending
  // images uploaded in a previous session. In the upload-now case the
  // cache is already warm, so we skip the bump and avoid the blink.
  const [pendingBlobsReady, setPendingBlobsReady] = useState(0);
  const warmedPendingKeysRef = useRef<string>("");
  useEffect(() => {
    const keys = collectPendingKeys(composition);
    const sig = keys.slice().sort().join("|");
    if (sig === warmedPendingKeysRef.current) return;
    warmedPendingKeysRef.current = sig;
    if (keys.length === 0) return;
    // Common case: the upload path populated the cache synchronously, so
    // every key is already a memory hit. Nothing to async-warm → no bump
    // → no rebuild → no blink. The in-place SK_PATCH_FIELD already showed
    // the new image to the user.
    const allCached = keys.every(
      (k) => getCachedBlobUrl(`pending:${k}`) !== null,
    );
    if (allCached) return;
    let cancelled = false;
    prefetchPendingBlobUrls(keys).then(() => {
      // Only after a real IDB roundtrip do we need a rebuild — the
      // iframe's existing srcDoc still references the (unresolvable)
      // pending: URL, so a re-render with translatePendingUrls is the
      // only way to put the blob: URL into the live preview.
      if (!cancelled) setPendingBlobsReady((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [composition]);

  // Substitute `pending:` URLs in a value with the cached blob URL. Used
  // before passing values to renderInBrowser / iframe postMessage.
  const translatePendingUrls = useCallback(
    (composition: SiteComposition): SiteComposition => {
      // Cheap deep-walk: only allocates a copy when we actually substitute.
      let mutated = false;
      const walk = (n: unknown): unknown => {
        if (typeof n === "string") {
          if (!isPendingUrl(n)) return n;
          const blob = getCachedBlobUrl(n);
          if (!blob) return n; // cache miss — leave as-is, will retry on next prefetch
          mutated = true;
          return blob;
        }
        if (!n || typeof n !== "object") return n;
        if (Array.isArray(n)) {
          const next = n.map(walk);
          return next;
        }
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(n)) out[k] = walk(v);
        return out;
      };
      const next = walk(composition) as SiteComposition;
      return mutated ? next : composition;
    },
    [],
  );

  // ── Live preview HTML — recomputed only on structural changes ──
  // Reads compositionRef so the freshest content+theme is baked into each rebuild.
  // Also re-runs when `pendingBlobsReady` changes so blob URLs warmed by the
  // prefetch effect above are reflected in the iframe.
  const previewHtml = useMemo(() => {
    let composition = translatePendingUrls(compositionRef.current);
    // Locale preview: when the operator picks a non-default language in the
    // preview switcher, overlay that locale's translation onto the
    // composition before rendering. localizeComposition is pure (node-free)
    // so it's safe here; it returns the base untouched for the default
    // locale or a missing translation.
    if (
      previewLocale &&
      composition.i18n &&
      previewLocale !== composition.i18n.default_locale
    ) {
      composition = localizeComposition(composition, previewLocale);
      // The Sluzby nav dropdown rows are auto-synced copies of the services
      // section titles (nav-dropdown-sync.ts). The i18n overlay translates
      // the services section but leaves those stored dropdown copies in the
      // default language — re-derive them from the now-translated services so
      // the preview dropdown matches the rest of the page (mirrors the server
      // renderer's per-locale re-sync).
      composition = syncNavDropdownFromServices(composition, templateMap);
    }
    return renderInBrowser(composition, templateBodyMap, {
      baseCss,
      // Multi-page (2026-05-23): preview follows the active page tab.
      // Falls back to HOME_PATH if the path resolves to nothing, which
      // matches the renderer's own default and matches what the
      // operator expects (deleting the active page snaps back home).
      pagePath: activePagePath,
      // Prefer the just-published URL (set synchronously on publish
      // success) over the prop value. Otherwise the iframe re-renders
      // with new /_uploads/ paths but a stale <base href> while
      // router.refresh() is still in flight, and images break.
      deploymentBaseUrl: effectiveSiteUrl ?? undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structuralKey, templateBodyMap, baseCss, pendingBlobsReady, effectiveSiteUrl, publishVersion, activePagePath, previewLocale]);

  // Helper: send a patch message to the iframe (no reload).
  const sendIframePatch = useCallback((msg: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(msg, "*");
  }, []);

  /**
   * Read the currently-rendered font-size (in CSS pixels) of a specific
   * [data-field] element inside the preview iframe. Returns null if the
   * iframe isn't loaded yet, the element isn't found, or the computed
   * style isn't parseable.
   *
   * The size-controls UI uses this so the FIRST +/− click starts from
   * what the user actually sees rendered — instead of jumping to a hard-
   * coded 18px and visually shrinking a 48px hero headline. Without this,
   * clicking + on the hero would make text smaller, which is unintuitive.
   *
   * Iframe sandbox is `allow-same-origin allow-scripts` (see preview-pane)
   * so contentDocument is directly readable from the parent — no
   * postMessage round-trip needed.
   */
  const measureIframeFieldSize = useCallback(
    (sectionId: string, fieldKey: string): number | null => {
      const doc = iframeRef.current?.contentDocument;
      const win = iframeRef.current?.contentWindow;
      if (!doc || !win) return null;
      // CSS.escape might not exist on very old browsers — fall back to a
      // safe regex-strip if so. Section/field IDs are usually alphanumeric
      // + underscores anyway, but be defensive.
      // Type cast: lib.dom.d.ts doesn't expose Window.CSS in this project's
      // TS config; we check at runtime so the cast is safe.
      const cssNs = (win as unknown as { CSS?: { escape?: (s: string) => string } }).CSS;
      const escape =
        cssNs && typeof cssNs.escape === "function"
          ? cssNs.escape.bind(cssNs)
          : (s: string) => String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
      const section = doc.querySelector(
        `[data-sk-section="${escape(sectionId)}"]`,
      );
      if (!section) return null;
      const el = section.querySelector(
        `[data-field="${escape(fieldKey)}"]`,
      ) as HTMLElement | null;
      if (!el) return null;
      const cs = win.getComputedStyle(el);
      if (!cs) return null;
      const px = parseFloat(cs.fontSize);
      return Number.isFinite(px) ? Math.round(px) : null;
    },
    [],
  );

  /**
   * Mirror of measureIframeFieldSize but for the field's current rendered
   * WIDTH in CSS pixels. Read from getBoundingClientRect — that gives us
   * the actual painted box, including any max-width / parent constraints,
   * rather than the computed declared style (which is often "auto" for
   * paragraph elements). The +/− cluster on WidthControls uses this so the
   * first click starts from what the user actually sees.
   */
  const measureIframeFieldWidth = useCallback(
    (sectionId: string, fieldKey: string): number | null => {
      const doc = iframeRef.current?.contentDocument;
      const win = iframeRef.current?.contentWindow;
      if (!doc || !win) return null;
      const cssNs = (win as unknown as { CSS?: { escape?: (s: string) => string } }).CSS;
      const escape =
        cssNs && typeof cssNs.escape === "function"
          ? cssNs.escape.bind(cssNs)
          : (s: string) => String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
      const section = doc.querySelector(
        `[data-sk-section="${escape(sectionId)}"]`,
      );
      if (!section) return null;
      const el = section.querySelector(
        `[data-field="${escape(fieldKey)}"]`,
      ) as HTMLElement | null;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 ? Math.round(rect.width) : null;
    },
    [],
  );

  // For the iframe's SK_PATCH_FIELD path: if the value is a `pending:` URL
  // (image field), swap to its cached blob URL so the iframe can actually
  // render it. Pass through everything else (link objects, normal strings).
  function translateValueForIframe(value: FieldValue): FieldValue {
    if (typeof value === "string" && isPendingUrl(value)) {
      return getCachedBlobUrl(value) ?? value;
    }
    return value;
  }

  // ── Background save ──
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveNow = useCallback(async () => {
    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/sites/${siteId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ composition: compositionRef.current }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to save");
        setSaveStatus("error");
        return;
      }
      setSaveStatus("saved");
      setTimeout(() => {
        setSaveStatus((s) => (s === "saved" ? "idle" : s));
      }, 1500);
    } catch {
      setSaveStatus("error");
      toast.error("Network error");
    }
  }, [siteId]);

  function scheduleSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveNow();
    }, 250);
  }

  // Async-await variant of "force the pending save now." Used by handlers
  // that are about to do something disruptive (publish, full-page reload
  // after subdomain change) and need the latest composition durably saved
  // before they proceed. Without this, anything in the 250ms debounce
  // window — typically a fresh image upload — gets dropped on reload.
  const flushPendingComposition = useCallback(async () => {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    await saveNow();
  }, [saveNow]);

  // Synchronous-ish flush for tab-close / navigation. Uses keepalive so the
  // request completes even after the page is unloading.
  const flushPendingSave = useCallback(() => {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    try {
      fetch(`/api/sites/${siteId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ composition: compositionRef.current }),
        keepalive: true,
      });
    } catch {
      // Best-effort on unload; nothing more we can do.
    }
  }, [siteId]);

  // Flush on tab close / navigation away. Also warns the user before
  // unload when there are pending image uploads that haven't been
  // published yet (Phase B) — those Files only live in this device's
  // IndexedDB until they're flushed during a publish.
  useEffect(() => {
    function onUnload(e: BeforeUnloadEvent) {
      flushPendingSave();
      const pendingCount = collectPendingKeys(compositionRef.current).length;
      if (pendingCount > 0) {
        // Standard beforeunload contract: cancel + return string. Modern
        // browsers ignore the actual string and show their own message,
        // but the "should we warn" decision still depends on this being set.
        e.preventDefault();
        e.returnValue = `You have ${pendingCount} unpublished image(s). They live on this device only — publish to make them live everywhere.`;
        return e.returnValue;
      }
    }
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") flushPendingSave();
    }
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", flushPendingSave);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", flushPendingSave);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [flushPendingSave]);

  // ── Edit-lock heartbeat ──
  // Initial lock acquisition happened server-side (page.tsx) — if we got
  // here with the composer mounted, we hold the lock. From now on we
  // need to keep refreshing it every 30s so the lock doesn't expire
  // while the user is mid-edit. We also release it on clean unload so
  // the next opener doesn't have to wait the full 90s TTL.
  //
  // Heartbeat interval (30s) << TTL (90s) gives ~3 missed-heartbeat
  // grace before another user can take over — handles a tab that gets
  // throttled/backgrounded for a few seconds without losing the lock.
  useEffect(() => {
    // 30s heartbeat paired with the 90s TTL in site-lock.ts gives
    // ~3 missed heartbeats of slack before the lock auto-expires —
    // enough to survive a brief network blip without losing the lock,
    // short enough that a crashed tab releases the site in <2 minutes.
    const HEARTBEAT_MS = 30_000;
    let cancelled = false;
    function heartbeat() {
      if (cancelled) return;
      // Fire-and-forget: any failure (network blip, transient 5xx) is
      // recoverable — the next tick will catch up. If the lock has been
      // taken over by someone else (only possible after enough missed
      // heartbeats to exceed the TTL), the next save fails loudly.
      void fetch(`/api/sites/${siteId}/lock`, {
        method: "POST",
        cache: "no-store",
      });
    }
    const id = setInterval(heartbeat, HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [siteId]);

  // Clean release on tab close OR SPA navigation. Both cases need the
  // lock released so the next opener doesn't have to wait the 90s TTL.
  //   - `pagehide` covers tab close + full refresh + browser back to
  //     a different origin. `keepalive: true` lets the request complete
  //     even after the page starts unloading.
  //   - The cleanup function runs when ComposerClient unmounts, which
  //     happens on Next.js client-side navigation (clicking a link,
  //     router.push to another route). Without releasing here, leaving
  //     the editor via the in-app back button leaves the lock held for
  //     the full TTL, blocking the next opener for 90s.
  // Both paths are idempotent at the server (release is "do nothing if
  // I'm not the holder"), so a double-release on a real page navigation
  // away is harmless.
  useEffect(() => {
    function releaseLock() {
      try {
        fetch(`/api/sites/${siteId}/lock`, {
          method: "DELETE",
          keepalive: true,
        });
      } catch {
        // Best-effort — a missed release just falls back to the TTL.
      }
    }
    window.addEventListener("pagehide", releaseLock);
    return () => {
      window.removeEventListener("pagehide", releaseLock);
      releaseLock();
    };
  }, [siteId]);

  // Force an immediate save whenever the *structure* changes (sections
  // added/removed/reordered, shared template swapped). These are deliberate,
  // infrequent actions worth persisting right away — debouncing them risks
  // losing them if the user closes the tab quickly.
  const lastSavedStructuralKey = useRef(structuralKey);
  useEffect(() => {
    if (lastSavedStructuralKey.current === structuralKey) return;
    lastSavedStructuralKey.current = structuralKey;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    saveNow();
  }, [structuralKey, saveNow]);

  function patchComposition(updater: (prev: SiteComposition) => SiteComposition) {
    setComposition((prev) => updater(prev));
    scheduleSave();
  }

  // One-shot reconciliation on mount: if the existing composition has a
  // services section + a nav with a linked dropdown, bring the dropdown
  // into sync with the services list. Handles sites that were built
  // before the auto-sync feature shipped — their nav.dropdown_items
  // still carries stale "Service 1..4" placeholders even though the
  // services section was renamed/edited. Subsequent mutations are kept
  // in sync via updateSectionContent (structural changes) +
  // updateSectionItemField (live title edits).
  //
  // Gated on `templateMap.size > 0` because the templates load
  // asynchronously — running before they're available would no-op every
  // time and miss the sync window. The ran-once flag prevents re-running
  // when templateMap stabilizes after subsequent template fetches
  // (template variants, AI-added templates, etc.).
  const navDropdownSyncRan = useRef(false);
  useEffect(() => {
    if (navDropdownSyncRan.current) return;
    if (templateMap.size === 0) return;
    navDropdownSyncRan.current = true;
    setComposition((prev) => syncNavDropdownFromServices(prev, templateMap));
    // Repaint the iframe so the navbar dropdown shows the synced
    // service titles. The mount sync above rewrites
    // nav_overrides.nav_links (dropdown labels + hrefs), but
    // structuralKey doesn't track nav_overrides content — so the
    // previewHtml memo won't recompute on its own and the rendered
    // dropdown would keep the template's "Service 1..4" placeholders
    // even though the field panel shows the real titles (Peter
    // 2026-05-28). schedulePreviewBump bumps publishVersion (a
    // previewHtml dep), forcing one rebuild with the synced data.
    // Debounced + fires once on mount, so the cost is invisible.
    schedulePreviewBump();
  }, [templateMap, schedulePreviewBump]);

  function patchPage(
    updater: (page: SiteComposition["pages"][number]) => SiteComposition["pages"][number],
  ) {
    patchComposition((prev) => {
      const path = activePagePathRef.current;
      return {
        ...prev,
        pages: prev.pages.map((p) => (p.path === path ? updater(p) : p)),
      };
    });
  }

  // ── Multi-page handlers (PagesTabs) ──────────────────────────────────
  // The shared nav + footer auto-render around every page (see
  // composition.shared in render.ts), so a new page just needs body
  // sections — visitors see the same nav + footer as the home page.
  //
  // New pages get a default 5-section subpage scaffold (Peter 2026-05-30,
  // replaced the "start empty" rule from 2026-05-23). The default stack
  // is the same regardless of the page's name — tech-admin customizes
  // from there. Order is intentional (10 before 09):
  //   subpage-01 → subpage-02 → subpage-03 → subpage-10 → subpage-09
  // subpage-03's topical_blocks repeater ships with 8 default items
  // (the template HTML itself was updated; see public/sample-templates/
  // subpage-03.html), so the JSON round-trip exports 8 fillable slots
  // out of the box. Nav linking is INTENTIONALLY NOT auto-managed:
  // operators point to subpages manually via the existing link editor.
  const DEFAULT_SUBPAGE_TEMPLATE_NAMES = [
    "subpage-01",
    "subpage-02",
    "subpage-03",
    "subpage-10",
    "subpage-09",
  ] as const;

  function handlePageAdd(newPage: SiteComposition["pages"][number]) {
    // Resolve template names → template IDs from the loaded templates
    // map. Silently drop any that aren't in the catalog (e.g. brand-
    // new DB that hasn't seeded the subpage category) — the page still
    // gets created with whatever templates DID resolve, instead of
    // erroring out. Tech-admin can add the missing ones via the rail.
    const nameToId = new Map<string, string>();
    for (const t of templates) nameToId.set(t.name, t.id);

    const scaffoldSections: CompositionSection[] = [];
    let nextOrder = 0;
    for (const tplName of DEFAULT_SUBPAGE_TEMPLATE_NAMES) {
      const tplId = nameToId.get(tplName);
      if (!tplId) continue;
      scaffoldSections.push({
        id: `sec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        template_id: tplId,
        order: nextOrder++,
        content_overrides: {},
      });
    }

    const pageWithScaffold: SiteComposition["pages"][number] = {
      ...newPage,
      // If the caller passed pre-built sections (future use), keep
      // them and skip the scaffold — only inject defaults for the
      // PagesTabs "Add page" empty-array case.
      sections:
        newPage.sections.length > 0 ? newPage.sections : scaffoldSections,
      // Persist the service link the picker assigned. Spread above
      // already carries it through, but spelling it out explicitly
      // keeps the contract obvious + tolerates legacy callers that
      // don't pass the field (it falls through as undefined → fine).
      linked_service_id: newPage.linked_service_id ?? null,
    };

    patchComposition((prev) => ({
      ...prev,
      pages: [...prev.pages, pageWithScaffold],
    }));
    setActivePagePath(pageWithScaffold.path);
    toast.success(`Page added: ${pageWithScaffold.label}`);
  }

  function handlePageRemove(path: string) {
    // Defensive: never remove the home page even if someone bypasses
    // the UI guard (PagesTabs hides the × on the home tab).
    if (path === "index.html") {
      toast.error("Cannot remove the home page.");
      return;
    }
    // If the removed page is currently active, fall back to the home
    // page so the editor doesn't show a stale active path that
    // resolves to pages[0] anyway via findActivePageIndex's fallback.
    if (activePagePathRef.current === path) {
      setActivePagePath("index.html");
    }
    patchComposition((prev) => {
      const withoutPage: SiteComposition = {
        ...prev,
        pages: prev.pages.filter((p) => p.path !== path),
      };
      // Neutralize any nav/footer/CTA link that pointed at the deleted
      // page so it doesn't 404 on the live site. Keeps the labels + menu
      // structure; just blanks the dead hrefs (operator can repoint).
      return clearLinksToPage(withoutPage, path);
    });
  }

  function handlePageSwitch(path: string) {
    setActivePagePath(path);
  }

  // ── Section actions ──
  // Returns the new section's id so the caller can select it (auto-scrolls
  // both the composition rail and the preview iframe to the new section).
  function addSection(templateId: string): string {
    const newId = `sec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    // ── Anchor-id stability ──
    // If this section's template default id ALREADY exists on the page
    // (e.g. adding a 2nd services section, both ship `id="sluzby"`), pin
    // the deduped id (`sluzby-2`) as an explicit __section_id override NOW,
    // at creation, instead of letting the renderer derive it by position
    // every publish. Freezing it means later reorders/deletes can't shift
    // the suffix and break links that point at `#sluzby-2`. Reuses the
    // EXACT slugify + dedupe the renderers use, so the pinned value equals
    // what would have rendered. Only pins on a real collision — the first
    // (canonical) section keeps its clean default, which is already stable.
    const stableId = computeStableNewSectionId(templateId);
    const newSection: CompositionSection = {
      id: newId,
      template_id: templateId,
      order:
        activePage.sections.length > 0
          ? Math.max(...activePage.sections.map((s) => s.order)) + 1
          : 0,
      content_overrides: stableId ? { __section_id: stableId } : {},
    };
    patchPage((p) => ({ ...p, sections: [...p.sections, newSection] }));
    return newId;
  }

  /**
   * Compute a collision-free, position-independent anchor id for a section
   * about to be added to the active page — or undefined when no pin is
   * needed (template has no default id, or the default is still free).
   * Mirrors the per-page dedup pass in render.ts exactly (footer default
   * pre-seeded, sections walked in order, override-or-default deduped).
   */
  function computeStableNewSectionId(templateId: string): string | undefined {
    const def = templateBodyMap.get(templateId)?.defaultSectionId ?? "";
    if (!def) return undefined; // id-less template (widget, etc.) — nothing to pin
    const used = new Set<string>();
    const footerTplId = compositionRef.current.shared?.footer_template_id;
    if (footerTplId) {
      const fdef = templateBodyMap.get(footerTplId)?.defaultSectionId;
      if (fdef) used.add(fdef);
    }
    const sorted = [...activePage.sections].sort((a, b) => a.order - b.order);
    for (const s of sorted) {
      const ovRaw = (s.content_overrides as Record<string, unknown>)
        ?.__section_id;
      const overrideId =
        typeof ovRaw === "string" ? slugifyAnchorId(ovRaw) : "";
      const intended =
        overrideId || (templateBodyMap.get(s.template_id)?.defaultSectionId ?? "");
      if (intended) dedupeAnchorId(intended, used); // records into `used`
    }
    const finalId = dedupeAnchorId(def, used);
    // Pin only when the default actually collided (got a -N suffix). A
    // free canonical id needs no override — it's already stable.
    return finalId !== def ? finalId : undefined;
  }

  function changeVariant(sectionId: string, newTemplateId: string) {
    patchPage((p) => ({
      ...p,
      sections: p.sections.map((s) => {
        if (s.id !== sectionId) return s;
        const newTpl = templateMap.get(newTemplateId);
        const newSchemaKeys = newTpl
          ? new Set(Object.keys(newTpl.placeholder_schema ?? {}))
          : new Set<string>();
        const filteredOverrides: Record<string, FieldValue> = {};
        for (const [k, v] of Object.entries(
          s.content_overrides as Record<string, FieldValue> ?? {},
        )) {
          if (newSchemaKeys.has(k)) filteredOverrides[k] = v;
        }
        return {
          ...s,
          template_id: newTemplateId,
          content_overrides: filteredOverrides,
        };
      }),
    }));
  }

  // Drag-and-drop reorder. Reassigns order sequentially after the move so we
  // never end up with collisions or holes.
  function reorderSections(activeId: string, overId: string) {
    if (activeId === overId) return;
    patchPage((p) => {
      const sorted = [...p.sections].sort((a, b) => a.order - b.order);
      const fromIdx = sorted.findIndex((s) => s.id === activeId);
      const toIdx = sorted.findIndex((s) => s.id === overId);
      if (fromIdx === -1 || toIdx === -1) return p;
      const moved = arrayMove(sorted, fromIdx, toIdx);
      return { ...p, sections: moved.map((s, i) => ({ ...s, order: i })) };
    });
  }

  function removeSection(sectionId: string) {
    patchPage((p) => ({
      ...p,
      sections: p.sections.filter((s) => s.id !== sectionId),
    }));
  }

  function updateSectionContent(
    sectionId: string,
    key: string,
    value: FieldValue,
  ) {
    // Look up the field type from the section's template schema so the
    // iframe-side patcher knows how to apply the value.
    const activeIdx = findActivePageIndex(compositionRef.current);
    const section = compositionRef.current.pages[activeIdx]?.sections.find(
      (s) => s.id === sectionId,
    );
    const tpl = section ? templateMap.get(section.template_id) : undefined;
    const fieldType = (tpl?.placeholder_schema as
      | Record<string, { type: string }>
      | undefined)?.[key]?.type;

    // We update the page inline AND run the nav-dropdown sync in the
    // SAME composition update so both land in one React tick. patchPage
    // alone would commit the section change first, then a separate
    // patchComposition call below would read a stale ref. Folding both
    // into one updater avoids that ordering risk.
    //
    // The sync is conditional on `tpl?.category === "services"` so a
    // hero/about/contact repeater change skips the work entirely —
    // running the function defensively was tempting but it'd touch
    // the composition reference on every repeater edit, breaking the
    // no-op short-circuit React relies on.
    const tplCategory = tpl?.category;
    const targetPath = activePagePathRef.current;
    patchComposition((prev) => {
      const updatedPages = prev.pages.map((p) =>
        p.path === targetPath
          ? {
              ...p,
              sections: p.sections.map((s) =>
                s.id === sectionId
                  ? {
                      ...s,
                      content_overrides: {
                        ...(s.content_overrides ?? {}),
                        [key]: value,
                      },
                    }
                  : s,
              ),
            }
          : p,
      );
      const next: SiteComposition = { ...prev, pages: updatedPages };
      if (fieldType === "repeater" && tplCategory === "services") {
        return syncNavDropdownFromServices(next, templateMap);
      }
      return next;
    });

    if (fieldType === "repeater") {
      // Structural repeater change (add/remove/reorder) — bump preview so
      // the renderer re-clones items. Debounced to coalesce bursts.
      schedulePreviewBump();
    } else if (fieldType) {
      sendIframePatch({
        type: "SK_PATCH_FIELD",
        sectionId,
        fieldKey: key,
        fieldType,
        // Translate pending: → blob URL before the iframe sees it.
        value: translateValueForIframe(value),
      });
    }
  }

  /**
   * Update the font-size override for a single field on a section.
   * Writes to section.field_styles AND sends a surgical
   * SK_PATCH_FIELD_STYLE message to the iframe so the size change is
   * visible immediately without rebuilding the whole iframe.
   *
   * Why NOT schedulePreviewBump: that rebuilds the iframe srcDoc,
   * which causes a visible blink on every +/− click. SK_PATCH_FIELD_STYLE
   * mirrors the surgical-update pattern that text edits already use —
   * touches one element's inline style, leaves the rest of the iframe
   * undisturbed.
   *
   * `sizePx` is the px value; null/undefined means "reset to template
   * default" — the iframe handler then strips any prior inline
   * font-size from the matching element.
   */
  function updateSectionFieldStyle(
    sectionId: string,
    key: string,
    sizePx: number | null,
  ) {
    // Snapshot the OTHER knobs (width, fill) BEFORE patchPage commits —
    // patchPage schedules an update, it doesn't mutate compositionRef.current
    // in place, so reading "the latest state" after patchPage returns the
    // pre-patch state. The size we just received as a parameter IS the
    // new value, so we send it through directly.
    const currentSection = compositionRef.current.pages
      .flatMap((p) => p.sections)
      .find((s) => s.id === sectionId);
    const currentWidth = currentSection?.field_styles?.[key]?.width;
    const currentFill = currentSection?.field_styles?.[key]?.fill;

    patchPage((p) => ({
      ...p,
      sections: p.sections.map((s) => {
        if (s.id !== sectionId) return s;
        // Build the next field_styles map. null means "template
        // default, no override" — we DELETE the size key from the
        // entry. If width is also unset, drop the whole entry so
        // storage stays clean and the renderer's "missing entry ===
        // no inline style" path runs.
        const next = { ...(s.field_styles ?? {}) };
        const prev = next[key] ?? {};
        if (sizePx === null || !Number.isFinite(sizePx)) {
          const { size: _drop, ...rest } = prev;
          if (Object.keys(rest).length === 0) {
            delete next[key];
          } else {
            next[key] = rest;
          }
        } else {
          next[key] = { ...prev, size: sizePx };
        }
        return { ...s, field_styles: next };
      }),
    }));
    // Surgical iframe update — same pattern as SK_PATCH_FIELD for
    // text edits. The handler is wired in render-browser.ts and looks
    // for [data-sk-section="<id>"] [data-field="<key>"], stripping any
    // prior inline font-size and applying the new one. We send BOTH
    // size + width so the handler can re-emit a coherent declaration
    // block (it strips and reapplies both in one pass).
    sendIframePatch({
      type: "SK_PATCH_FIELD_STYLE",
      sectionId,
      fieldKey: key,
      sizePx,
      widthPx: typeof currentWidth === "number" ? currentWidth : null,
      fill: currentFill === true,
    });
  }

  /**
   * Mirror of updateSectionFieldStyle for the max-width override.
   * Writes section.field_styles[key].width and dispatches the same
   * SK_PATCH_FIELD_STYLE message — the iframe handler accepts both
   * sizePx and widthPx in the same payload, so we always send both
   * (whatever the current state says) to keep the iframe consistent.
   *
   * `widthPx === null` clears the width override; if size is also
   * unset, the whole entry is dropped from field_styles.
   */
  function updateSectionFieldWidth(
    sectionId: string,
    key: string,
    widthPx: number | null,
  ) {
    // Snapshot the OTHER knobs (size, fill) BEFORE patchPage commits — same
    // staleness concern as updateSectionFieldStyle. widthPx is the new
    // value, send it directly.
    const currentSection = compositionRef.current.pages
      .flatMap((p) => p.sections)
      .find((s) => s.id === sectionId);
    const currentSize = currentSection?.field_styles?.[key]?.size;
    const currentFill = currentSection?.field_styles?.[key]?.fill;

    patchPage((p) => ({
      ...p,
      sections: p.sections.map((s) => {
        if (s.id !== sectionId) return s;
        const next = { ...(s.field_styles ?? {}) };
        const prev = next[key] ?? {};
        if (widthPx === null || !Number.isFinite(widthPx)) {
          const { width: _drop, ...rest } = prev;
          if (Object.keys(rest).length === 0) {
            delete next[key];
          } else {
            next[key] = rest;
          }
        } else {
          next[key] = { ...prev, width: widthPx };
        }
        return { ...s, field_styles: next };
      }),
    }));
    sendIframePatch({
      type: "SK_PATCH_FIELD_STYLE",
      sectionId,
      fieldKey: key,
      sizePx: typeof currentSize === "number" ? currentSize : null,
      widthPx,
      fill: currentFill === true,
    });
  }

  /**
   * Toggle the per-field "fill section" override (full viewport
   * edge-to-edge breakout). Same field_styles shape — adds/removes
   * `fill: true` on section.field_styles[key]. When fill flips off and
   * no other knobs are set, the whole entry is dropped (clean storage).
   * fill takes priority over width at render time; the UI disables the
   * width slider while fill is ON so the user isn't fiddling with a
   * value that doesn't apply.
   */
  function updateSectionFieldFill(
    sectionId: string,
    key: string,
    fillEnabled: boolean,
  ) {
    const currentSection = compositionRef.current.pages
      .flatMap((p) => p.sections)
      .find((s) => s.id === sectionId);
    const currentSize = currentSection?.field_styles?.[key]?.size;
    const currentWidth = currentSection?.field_styles?.[key]?.width;

    patchPage((p) => ({
      ...p,
      sections: p.sections.map((s) => {
        if (s.id !== sectionId) return s;
        const next = { ...(s.field_styles ?? {}) };
        const prev = next[key] ?? {};
        if (!fillEnabled) {
          const { fill: _drop, ...rest } = prev;
          if (Object.keys(rest).length === 0) {
            delete next[key];
          } else {
            next[key] = rest;
          }
        } else {
          next[key] = { ...prev, fill: true };
        }
        return { ...s, field_styles: next };
      }),
    }));
    sendIframePatch({
      type: "SK_PATCH_FIELD_STYLE",
      sectionId,
      fieldKey: key,
      sizePx: typeof currentSize === "number" ? currentSize : null,
      widthPx: typeof currentWidth === "number" ? currentWidth : null,
      fill: fillEnabled,
    });
  }

  /**
   * Toggle visibility for a single field on a section. When hidden=true,
   * the field's key is added to section.hidden_fields; when false, it
   * gets removed. Both the composer preview and the publish renderer
   * read this list and delete the corresponding DOM nodes outright (no
   * display:none — clean HTML for the published site).
   *
   * `fieldKey` accepts both shapes:
   *   · "hero_cta"                      — top-level field
   *   · "services_items[0].service_cta" — repeater item sub-field
   *
   * Composer state change schedules a preview bump (iframe rebuild)
   * so the visual matches immediately. No targeted SK_PATCH_* message
   * because the DOM topology changes (element removed vs reinserted)
   * and a full rebuild is the safest way to keep the iframe consistent.
   */
  /**
   * Toggle a hide flag on a SHARED slot's field (nav or footer).
   * Mirrors updateSectionFieldHidden but writes to
   * `composition.shared.{nav,footer}_hidden_fields` instead of a
   * specific section's array. Used by the social-icon toggle in the
   * nav/footer cards (`nav_facebook`, `footer_instagram`, etc.).
   */
  function updateSharedFieldHidden(
    slot: "nav" | "footer",
    fieldKey: string,
    hidden: boolean,
  ) {
    setComposition((prev) => {
      const shared = prev.shared ?? {};
      const key = slot === "nav" ? "nav_hidden_fields" : "footer_hidden_fields";
      const current = (shared as Record<string, unknown>)[key] as string[] | undefined ?? [];
      const hasIt = current.includes(fieldKey);
      if (hidden && hasIt) return prev;
      if (!hidden && !hasIt) return prev;
      const next = hidden
        ? [...current, fieldKey]
        : current.filter((k) => k !== fieldKey);
      // Empty array → drop the key entirely so JSONB stays slim.
      const nextShared = { ...shared } as Record<string, unknown>;
      if (next.length === 0) {
        delete nextShared[key];
      } else {
        nextShared[key] = next;
      }
      return { ...prev, shared: nextShared as typeof shared };
    });
    schedulePreviewBump();
  }

  function updateSectionFieldHidden(
    sectionId: string,
    fieldKey: string,
    hidden: boolean,
  ) {
    patchPage((p) => ({
      ...p,
      sections: p.sections.map((s) => {
        if (s.id !== sectionId) return s;
        const current = s.hidden_fields ?? [];
        const hasIt = current.includes(fieldKey);
        // No-op cases: already hidden + hide, or not hidden + show.
        if (hidden && hasIt) return s;
        if (!hidden && !hasIt) return s;
        const next = hidden
          ? [...current, fieldKey]
          : current.filter((k) => k !== fieldKey);
        // Empty array → drop the property entirely so JSONB stays slim
        // and old-shape comparisons (e.g. autosave dedup) keep firing.
        if (next.length === 0) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { hidden_fields: _drop, ...rest } = s;
          return rest;
        }
        return { ...s, hidden_fields: next };
      }),
    }));
    // Rebuild the iframe srcDoc so the removed/restored DOM node lands.
    // schedulePreviewBump debounces, so rapid toggles coalesce.
    schedulePreviewBump();
  }

  /**
   * Apply a batch of AI-generated overrides to the composition.
   *
   * The endpoint returns:
   *   { sectionId: { fieldKey: value, ... }, ... }
   *
   * For text/longtext/richtext/repeater fields we route straight
   * through `updateSectionContent` — same path the user takes when
   * typing, so all the SK_PATCH_FIELD / schedulePreviewBump logic
   * applies and the iframe updates without a full rebuild.
   *
   * Link fields are special: AI returns `{ label }` only, but
   * composition stores `{ label, href }`. We merge with the existing
   * href (from current overrides or the template default) so we
   * don't overwrite a working anchor with `undefined`.
   *
   * Sections referenced in overrides but not present in composition
   * are silently skipped — defensive against an out-of-date AI
   * response if the user removed a section mid-flight.
   */
  function applyAiOverrides(overrides: AiOverrides) {
    const activeIdx = findActivePageIndex(compositionRef.current);
    const sections =
      compositionRef.current.pages[activeIdx]?.sections ?? [];
    for (const [sectionId, fields] of Object.entries(overrides)) {
      const section = sections.find((s) => s.id === sectionId);
      if (!section) continue;
      const tpl = templateMap.get(section.template_id);
      if (!tpl) continue;
      const schema =
        (tpl.placeholder_schema as Record<string, FieldSchema> | undefined) ??
        {};

      for (const [fieldKey, rawValue] of Object.entries(fields)) {
        const fieldSchema = schema[fieldKey];
        if (!fieldSchema) continue;

        let value: FieldValue;
        if (fieldSchema.type === "link") {
          // AI returns { label }; merge with existing/default href.
          const labelOnly = rawValue as { label?: unknown } | unknown;
          const newLabel =
            typeof labelOnly === "object" &&
            labelOnly !== null &&
            "label" in labelOnly &&
            typeof (labelOnly as { label: unknown }).label === "string"
              ? (labelOnly as { label: string }).label
              : null;
          if (newLabel === null) continue;
          const existing = section.content_overrides?.[fieldKey];
          const existingHref =
            typeof existing === "object" &&
            existing !== null &&
            !Array.isArray(existing) &&
            typeof (existing as { href?: unknown }).href === "string"
              ? (existing as { href: string }).href
              : undefined;
          // Link schema stores the default href on `default_href`,
          // NOT on `default` (which holds the label string). Reading
          // `default.href` always returned undefined → fallback "#"
          // got written into every AI-generated CTA, and publish
          // faithfully rendered `href="#"` on the live site. Peter
          // 2026-05-16 noticed live CTAs pointing to "#" instead of
          // `#sluzby` / `#kontakt`.
          const defaultHref =
            typeof fieldSchema.default_href === "string" &&
            fieldSchema.default_href
              ? fieldSchema.default_href
              : "#";
          value = { label: newLabel, href: existingHref ?? defaultHref };
        } else {
          // text / longtext / richtext / repeater — pass through.
          value = rawValue as FieldValue;
        }
        updateSectionContent(section.id, fieldKey, value);
      }
    }
  }

  /**
   * Apply a JSON-workflow import to the composition.
   *
   * Same input shape as applyAiOverrides — but routes repeater changes
   * through `updateSectionItemField` per item-field instead of replacing
   * the whole array via `updateSectionContent`. That difference matters
   * because updateSectionItemField triggers the live nav-dropdown
   * linkage at composer-client.tsx:1299 — when a service's title
   * changes, any nav dropdown row pointing at the OLD anchor gets its
   * label + href rewritten to match. Replacing the array wholesale
   * bypasses that linkage, leaving the nav stale.
   *
   * Link fields are merged with the existing href (same as
   * applyAiOverrides) — the JSON export only carries `{ label }`, the
   * href stays whatever the composition already had or the template
   * default.
   *
   * Sections / fields / items not present in the live composition are
   * silently skipped — defensive against an out-of-date paste, though
   * the validator already catches this case earlier.
   */
  function applyJsonImport(overrides: AiOverrides) {
    const activeIdx = findActivePageIndex(compositionRef.current);
    const sections =
      compositionRef.current.pages[activeIdx]?.sections ?? [];

    for (const [sectionId, fields] of Object.entries(overrides)) {
      // ── Site-level SEO (virtual section) ──
      // The __seo block has no template — its keys map directly to
      // SiteSeo fields. Route through updateSeo (the same partial-
      // patch helper the SEO panel uses), then skip the rest of the
      // per-template loop. Only `title` + `description` are accepted;
      // anything else was already rejected by the validator (export
      // and validator both whitelist via SEO_FILLABLE_KEYS).
      if (sectionId === SEO_VIRTUAL_SECTION_ID) {
        const seoPatch: Partial<SiteSeo> = {};
        for (const [key, raw] of Object.entries(fields)) {
          if (typeof raw !== "string") continue;
          if (key === "title" || key === "description") {
            seoPatch[key] = raw;
          }
        }
        if (Object.keys(seoPatch).length > 0) updateSeo(seoPatch);
        continue;
      }

      // ── Shared nav / footer (virtual sections) ──
      // The __nav and __footer blocks correspond to the shared slots
      // in `composition.shared.{nav,footer}_overrides`. We route via
      // the same helpers the regular field editor uses
      // (updateSharedContent / updateSharedItemField) so iframe live
      // patches + autosave work identically. The slot's template
      // schema is needed to drive repeater walks + link-href merging
      // exactly like the page-section path below.
      if (
        sectionId === NAV_VIRTUAL_SECTION_ID ||
        sectionId === FOOTER_VIRTUAL_SECTION_ID
      ) {
        const slot: "nav" | "footer" =
          sectionId === NAV_VIRTUAL_SECTION_ID ? "nav" : "footer";
        const sharedTplId =
          slot === "nav"
            ? compositionRef.current.shared?.nav_template_id
            : compositionRef.current.shared?.footer_template_id;
        const sharedTpl = sharedTplId
          ? templateMap.get(sharedTplId)
          : undefined;
        if (!sharedTpl) continue;
        const sharedSchema =
          (sharedTpl.placeholder_schema as
            | Record<string, FieldSchema>
            | undefined) ?? {};
        const sharedOverrides =
          (slot === "nav"
            ? compositionRef.current.shared?.nav_overrides
            : compositionRef.current.shared?.footer_overrides) ?? {};
        applySharedSlotImport(slot, fields, sharedSchema, sharedOverrides);
        continue;
      }

      const section = sections.find((s) => s.id === sectionId);
      if (!section) continue;
      const tpl = templateMap.get(section.template_id);
      if (!tpl) continue;
      const schema =
        (tpl.placeholder_schema as Record<string, FieldSchema> | undefined) ??
        {};

      for (const [fieldKey, rawValue] of Object.entries(fields)) {
        const fieldSchema = schema[fieldKey];
        // ── Alt-text companion key (e.g. `image_alt`, `nav_logo_alt`) ──
        // These aren't declared in the template schema — they're
        // derived keys the composer + renderer both read under the
        // convention `<imageKey>_alt`. The JSON export emits them
        // alongside the image schema entries; the import needs to
        // accept them here and write to content_overrides.
        // "Preserve user-typed" rule (Peter 2026-05-22): if the user
        // already has a non-empty alt stored, ignore the AI's value
        // for THIS field — only auto-generation fills the empties.
        if (!fieldSchema && fieldKey.endsWith("_alt")) {
          const baseKey = fieldKey.slice(0, -"_alt".length);
          const baseSchema = schema[baseKey];
          if (baseSchema?.type !== "image") continue;
          if (typeof rawValue !== "string") continue;
          const existingAlt = section.content_overrides?.[fieldKey];
          if (typeof existingAlt === "string" && existingAlt.trim().length > 0) {
            // User has explicit alt — leave alone.
            continue;
          }
          // Empty incoming value also means "no override needed";
          // the renderer's auto-fallback (sibling title) keeps
          // working at render time.
          if (rawValue.trim().length === 0) continue;
          updateSectionContent(section.id, fieldKey, rawValue);
          continue;
        }
        if (!fieldSchema) continue;

        // ── Repeater: walk per-item, per-sub-field ──
        if (fieldSchema.type === "repeater") {
          if (!Array.isArray(rawValue)) continue;
          const itemSchema = (fieldSchema.item_schema ?? {}) as Record<
            string,
            FieldSchema
          >;
          // Capture the CURRENT items so we can merge link hrefs from
          // the right per-item source (each row keeps its own anchor).
          const currentItems =
            (section.content_overrides?.[fieldKey] as
              | Array<Record<string, FieldValue>>
              | undefined) ??
            (fieldSchema.default_items as
              | Array<Record<string, FieldValue>>
              | undefined) ??
            [];

          for (let i = 0; i < rawValue.length; i++) {
            const incomingItem = rawValue[i] as Record<string, unknown>;
            const currentItem = currentItems[i] ?? {};

            for (const [subKey, subRaw] of Object.entries(incomingItem)) {
              const subSchema = itemSchema[subKey];
              // Per-item alt-text companion key (e.g. `image_alt` on
              // a gallery / services item). Same convention as the
              // top-level path above: not in itemSchema, but written
              // to the item's overrides under `<imageKey>_alt`.
              // "Preserve user-typed" applies per-item — if THIS item
              // already has an explicit alt, leave it alone.
              if (!subSchema && subKey.endsWith("_alt")) {
                const baseSubKey = subKey.slice(0, -"_alt".length);
                const baseSubSchema = itemSchema[baseSubKey];
                if (baseSubSchema?.type !== "image") continue;
                if (typeof subRaw !== "string") continue;
                const existingItemAlt = currentItem[subKey];
                if (
                  typeof existingItemAlt === "string" &&
                  existingItemAlt.trim().length > 0
                ) {
                  continue;
                }
                if (subRaw.trim().length === 0) continue;
                updateSectionItemField(
                  section.id,
                  fieldKey,
                  i,
                  subKey,
                  subRaw,
                );
                continue;
              }
              if (!subSchema) continue;
              if (subSchema.type === "repeater") continue; // no nested repeaters

              let subValue: FieldValue;
              if (subSchema.type === "link") {
                const newLabel =
                  typeof subRaw === "object" &&
                  subRaw !== null &&
                  !Array.isArray(subRaw) &&
                  typeof (subRaw as { label?: unknown }).label === "string"
                    ? (subRaw as { label: string }).label
                    : null;
                if (newLabel === null) continue;
                const existing = currentItem[subKey];
                const existingHref =
                  typeof existing === "object" &&
                  existing !== null &&
                  !Array.isArray(existing) &&
                  typeof (existing as { href?: unknown }).href === "string"
                    ? (existing as { href: string }).href
                    : undefined;
                // Link schema stores the default href on
                // `default_href`, not on `default` (which is the
                // label). See the matching fix above the JSON-import
                // path — Peter 2026-05-16.
                const defaultHref =
                  typeof subSchema.default_href === "string" &&
                  subSchema.default_href
                    ? subSchema.default_href
                    : "#";
                subValue = { label: newLabel, href: existingHref ?? defaultHref };
              } else {
                // text / longtext / richtext — pass through.
                subValue = subRaw as FieldValue;
              }

              // CRITICAL: this is what triggers the live nav-dropdown
              // linkage when the item's id-source field (typically the
              // service title) changes. Replacing the whole array via
              // updateSectionContent would bypass that linkage.
              updateSectionItemField(section.id, fieldKey, i, subKey, subValue);
            }
          }
          continue;
        }

        // ── Non-repeater: same merge/passthrough as applyAiOverrides ──
        let value: FieldValue;
        if (fieldSchema.type === "link") {
          const newLabel =
            typeof rawValue === "object" &&
            rawValue !== null &&
            "label" in rawValue &&
            typeof (rawValue as { label: unknown }).label === "string"
              ? (rawValue as { label: string }).label
              : null;
          if (newLabel === null) continue;
          const existing = section.content_overrides?.[fieldKey];
          const existingHref =
            typeof existing === "object" &&
            existing !== null &&
            !Array.isArray(existing) &&
            typeof (existing as { href?: unknown }).href === "string"
              ? (existing as { href: string }).href
              : undefined;
          // Same defaultHref fix as applyAiOverrides (Peter
          // 2026-05-16): schema's default_href carries the href,
          // `default` carries only the label.
          const defaultHref =
            typeof fieldSchema.default_href === "string" &&
            fieldSchema.default_href
              ? fieldSchema.default_href
              : "#";
          value = { label: newLabel, href: existingHref ?? defaultHref };
        } else {
          value = rawValue as FieldValue;
        }
        updateSectionContent(section.id, fieldKey, value);
      }
    }
  }

  /**
   * Apply a JSON-workflow import slice to one shared slot (nav or
   * footer). Mirrors `applyJsonImport`'s per-section logic but routes
   * through the slot-specific update helpers so iframe live patches +
   * autosave behave the same as direct user edits in the slot's field
   * editor.
   *
   * Repeater items go through `updateSharedItemField` (one call per
   * sub-field per item) so the live nav-dropdown linkage at
   * `updateSectionItemField` ↔ `updateSharedItemField` parity fires
   * for nav menu link edits. Replacing arrays wholesale would bypass
   * that and leave dropdowns out of sync.
   *
   * Link fields preserve the existing href the same way the page-
   * section path does — JSON only carries `{ label }`, the href stays
   * whatever the user / template default already had.
   */
  function applySharedSlotImport(
    slot: "nav" | "footer",
    fields: Record<string, unknown>,
    schema: Record<string, FieldSchema>,
    currentOverrides: Record<string, FieldValue>,
  ) {
    for (const [fieldKey, rawValue] of Object.entries(fields)) {
      const fieldSchema = schema[fieldKey];
      // Alt-text companion (e.g. `nav_logo_alt`, `footer_logo_alt`).
      // Same convention as page-section images: stored under the
      // derived key in the slot's overrides; preserve user-typed
      // values; ignore empty incoming values so the renderer's
      // auto-fallback keeps working.
      if (!fieldSchema && fieldKey.endsWith("_alt")) {
        const baseKey = fieldKey.slice(0, -"_alt".length);
        const baseSchema = schema[baseKey];
        if (baseSchema?.type !== "image") continue;
        if (typeof rawValue !== "string") continue;
        const existingAlt = currentOverrides[fieldKey];
        if (typeof existingAlt === "string" && existingAlt.trim().length > 0) {
          continue;
        }
        if (rawValue.trim().length === 0) continue;
        updateSharedContent(slot, fieldKey, rawValue);
        continue;
      }
      if (!fieldSchema) continue;

      // ── Repeater: per-item, per-sub-field ──
      if (fieldSchema.type === "repeater") {
        if (!Array.isArray(rawValue)) continue;
        const itemSchema = (fieldSchema.item_schema ?? {}) as Record<
          string,
          FieldSchema
        >;
        const currentItems =
          (currentOverrides[fieldKey] as
            | Array<Record<string, FieldValue>>
            | undefined) ??
          (fieldSchema.default_items as
            | Array<Record<string, FieldValue>>
            | undefined) ??
          [];

        for (let i = 0; i < rawValue.length; i++) {
          const incomingItem = rawValue[i] as Record<string, unknown>;
          const currentItem = currentItems[i] ?? {};

          for (const [subKey, subRaw] of Object.entries(incomingItem)) {
            const subSchema = itemSchema[subKey];
            // Per-item alt-text companion key. Same logic as the
            // page-section path. Shared nav slots rarely carry repeater
            // images today, but mirroring keeps the two paths in sync
            // so any future template (e.g. a footer "team members"
            // repeater) gets alt support for free.
            if (!subSchema && subKey.endsWith("_alt")) {
              const baseSubKey = subKey.slice(0, -"_alt".length);
              const baseSubSchema = itemSchema[baseSubKey];
              if (baseSubSchema?.type !== "image") continue;
              if (typeof subRaw !== "string") continue;
              const existingItemAlt = currentItem[subKey];
              if (
                typeof existingItemAlt === "string" &&
                existingItemAlt.trim().length > 0
              ) {
                continue;
              }
              if (subRaw.trim().length === 0) continue;
              updateSharedItemField(slot, fieldKey, i, subKey, subRaw);
              continue;
            }
            if (!subSchema) continue;
            if (subSchema.type === "repeater") continue; // no nested

            let subValue: FieldValue;
            if (subSchema.type === "link") {
              const newLabel =
                typeof subRaw === "object" &&
                subRaw !== null &&
                !Array.isArray(subRaw) &&
                typeof (subRaw as { label?: unknown }).label === "string"
                  ? (subRaw as { label: string }).label
                  : null;
              if (newLabel === null) continue;
              const existing = currentItem[subKey];
              const existingHref =
                typeof existing === "object" &&
                existing !== null &&
                !Array.isArray(existing) &&
                typeof (existing as { href?: unknown }).href === "string"
                  ? (existing as { href: string }).href
                  : undefined;
              // Same defaultHref fix (Peter 2026-05-16): subSchema's
              // default_href has the href; default has only the label.
              const defaultHref =
                typeof subSchema.default_href === "string" &&
                subSchema.default_href
                  ? subSchema.default_href
                  : "#";
              subValue = {
                label: newLabel,
                href: existingHref ?? defaultHref,
              };
            } else {
              subValue = subRaw as FieldValue;
            }

            updateSharedItemField(slot, fieldKey, i, subKey, subValue);
          }
        }
        continue;
      }

      // ── Non-repeater: same merge/passthrough as applyJsonImport ──
      let value: FieldValue;
      if (fieldSchema.type === "link") {
        const newLabel =
          typeof rawValue === "object" &&
          rawValue !== null &&
          "label" in rawValue &&
          typeof (rawValue as { label: unknown }).label === "string"
            ? (rawValue as { label: string }).label
            : null;
        if (newLabel === null) continue;
        const existing = currentOverrides[fieldKey];
        const existingHref =
          typeof existing === "object" &&
          existing !== null &&
          !Array.isArray(existing) &&
          typeof (existing as { href?: unknown }).href === "string"
            ? (existing as { href: string }).href
            : undefined;
        // Same defaultHref fix as the section paths (Peter
        // 2026-05-16): default_href carries the href; default holds
        // only the label string.
        const defaultHref =
          typeof fieldSchema.default_href === "string" &&
          fieldSchema.default_href
            ? fieldSchema.default_href
            : "#";
        value = { label: newLabel, href: existingHref ?? defaultHref };
      } else {
        value = rawValue as FieldValue;
      }
      updateSharedContent(slot, fieldKey, value);
    }
  }

  /** Section-level repeater item-field edit — single field within a single
   *  item changed (e.g. typed into a service title). State sync + targeted
   *  in-place patch so the iframe doesn't flicker per keystroke. */
  function updateSectionItemField(
    sectionId: string,
    repeaterKey: string,
    itemIndex: number,
    itemFieldKey: string,
    value: FieldValue,
  ) {
    // Resolve the schema FIRST so we can use default_items as the
    // fallback when composition has no override yet. Without this,
    // editing item 0 of a gallery that's still showing schema defaults
    // would silently drop items 1..N — the override is materialized
    // from `[]`, get newItems[0] = {…}, save → only one item.
    const sectionForSchema = compositionRef.current.pages[
      findActivePageIndex(compositionRef.current)
    ]?.sections.find((s) => s.id === sectionId);
    const tpl = sectionForSchema
      ? templateMap.get(sectionForSchema.template_id)
      : undefined;
    const repeaterSchema = (tpl?.placeholder_schema as
      | Record<string, FieldSchema>
      | undefined)?.[repeaterKey];
    const itemFieldType =
      repeaterSchema?.item_schema?.[itemFieldKey]?.type;
    const defaultItems =
      (repeaterSchema?.default_items as
        | Array<Record<string, FieldValue>>
        | undefined) ?? [];

    patchPage((p) => ({
      ...p,
      sections: p.sections.map((s) => {
        if (s.id !== sectionId) return s;
        const oldOverrides = s.content_overrides ?? {};
        // Materialize the working list from override → schema defaults
        // → empty. Hits the schema default branch on the FIRST edit
        // after a section is added (or after a fresh page load with no
        // override yet) which is exactly when the bug used to fire.
        const oldRepeater =
          (oldOverrides[repeaterKey] as
            | Array<Record<string, FieldValue>>
            | undefined) ??
          defaultItems;
        const newItems = oldRepeater.slice();
        const oldItem = newItems[itemIndex] ?? {};
        newItems[itemIndex] = { ...oldItem, [itemFieldKey]: value };
        return {
          ...s,
          content_overrides: { ...oldOverrides, [repeaterKey]: newItems },
        };
      }),
    }));

    // ── Per-item anchor id refresh ──
    // The change affects the item's rendered anchor id when it's either
    // (a) the source field that drives the auto-derived id, or (b) the
    // `__item_id` reserved key that overrides it. In both cases we
    // recompute the effective id for EVERY item in the repeater (one
    // change can shift collision suffixes elsewhere — e.g. renaming
    // service "Excavation work" to match an earlier item promotes the
    // earlier one to `-2`) and send a targeted patch per item. Cheap:
    // single-pass over the items array, postMessage per item.
    //
    // CRITICAL: compute the updated items inline rather than re-reading
    // compositionRef.current. patchPage above schedules a React state
    // update but the ref isn't refreshed until the next render — so the
    // ref still holds the PRE-change value at this point. Using it
    // would compute identical ids to what's already in the iframe and
    // send a no-op patch.
    const idSourceKey = repeaterSchema?.item_id_source;
    if (idSourceKey && (itemFieldKey === idSourceKey || itemFieldKey === "__item_id")) {
      const currentSec = compositionRef.current.pages[
        findActivePageIndex(compositionRef.current)
      ]?.sections.find((s) => s.id === sectionId);
      const oldRepeater =
        ((currentSec?.content_overrides?.[repeaterKey] as
          | Array<Record<string, FieldValue>>
          | undefined) ?? defaultItems);

      // Compute BOTH the pre-edit and post-edit effective ids so we
      // can (a) emit fresh per-item id patches and (b) find any nav
      // dropdown items linked to the OLD anchor and rewrite them to
      // the NEW one. Slug + collision logic mirrors parser.ts /
      // render-browser.ts so the iframe stays in sync with publish.
      function computeIds(list: Array<Record<string, FieldValue>>): string[] {
        const used = new Set<string>();
        return list.map((it, i) => {
          const explicit =
            typeof it?.__item_id === "string"
              ? (it.__item_id as string).trim()
              : "";
          let id: string;
          if (explicit) {
            id = slugifyAnchorId(explicit);
          } else {
            const raw = idSourceKey ? it?.[idSourceKey] : undefined;
            const sourceText =
              typeof raw === "string"
                ? raw
                : raw &&
                    typeof raw === "object" &&
                    !Array.isArray(raw) &&
                    typeof (raw as { label?: unknown }).label === "string"
                  ? ((raw as { label: string }).label)
                  : "";
            // text + longtext now store HTML (per 2026-05-16 unification),
            // so the title used as the anchor source can carry <p>/
            // <strong>/etc. wrappers. Strip to plain text before slugify
            // — otherwise "Excavation work" inside a <p> would slug as
            // "p-excavation-work-p" and the published anchor wouldn't
            // match the dropdown's href.
            id = slugifyAnchorId(htmlToPlainText(sourceText));
          }
          if (!id) id = `item-${i + 1}`;
          let final = id;
          let n = 2;
          while (used.has(final)) {
            final = `${id}-${n}`;
            n++;
          }
          used.add(final);
          return final;
        });
      }
      const oldIds = computeIds(oldRepeater);

      const updatedItems = oldRepeater.slice();
      const oldItem = updatedItems[itemIndex] ?? {};
      updatedItems[itemIndex] = { ...oldItem, [itemFieldKey]: value };
      const newIds = computeIds(updatedItems);

      // Emit per-item id patches for every item (cheap; the iframe
      // handler is no-op when the value matches the existing id).
      newIds.forEach((newId, i) => {
        sendIframePatch({
          type: "SK_PATCH_ITEM_ID",
          sectionId,
          repeaterKey,
          itemIndex: i,
          newId,
        });
      });

      // ── Live nav dropdown linkage ──
      // For the CHANGED item, find any nav dropdown rows whose href
      // is the OLD anchor and update both label + href. The new
      // label is the changed item's source-field value (typically
      // its title); auto always wins, so a manual edit of the
      // dropdown row label gets overwritten on the next source-field
      // edit. Both the composition state and the iframe DOM get
      // patched — the iframe via SK_PATCH_AUTO_SYNCED_DROPDOWN so
      // the visible dropdown rebuilds without a full srcDoc swap.
      const oldId = oldIds[itemIndex];
      const newId = newIds[itemIndex];
      if (oldId) {
        const changedItem = updatedItems[itemIndex];
        const sourceRaw = idSourceKey
          ? changedItem[idSourceKey]
          : undefined;
        const newLabelRaw =
          typeof sourceRaw === "string"
            ? sourceRaw
            : sourceRaw &&
                typeof sourceRaw === "object" &&
                !Array.isArray(sourceRaw) &&
                typeof (sourceRaw as { label?: unknown }).label === "string"
              ? ((sourceRaw as { label: string }).label)
              : "";
        // Strip HTML — the dropdown label sits inside an <a> tag, and
        // block-level inline HTML like `<p>` would produce invalid markup
        // (<a><p>…</p></a>). htmlToPlainText also matches what the
        // anchor-id slug uses, so label + href derive from the same
        // plain-text source.
        const newLabel = htmlToPlainText(newLabelRaw);
        const navOverridesCurrent = compositionRef.current.shared
          ?.nav_overrides as Record<string, FieldValue> | undefined;
        const navLinksCurrent =
          (navOverridesCurrent?.nav_links as
            | Array<Record<string, FieldValue>>
            | undefined) ?? [];
        const newNavLinks: Array<Record<string, FieldValue>> = [];
        const touchedMenuIndices: number[] = [];
        for (let mi = 0; mi < navLinksCurrent.length; mi++) {
          const menuItem = navLinksCurrent[mi];
          const dropItems = menuItem.dropdown_items as
            | Array<Record<string, FieldValue>>
            | undefined;
          if (!Array.isArray(dropItems) || dropItems.length === 0) {
            newNavLinks.push(menuItem);
            continue;
          }
          let touched = false;
          const newDropItems = dropItems.map((di) => {
            const link = di.label as
              | { label?: string; href?: string }
              | undefined;
            if (!link || typeof link !== "object" || Array.isArray(link)) {
              return di;
            }
            if (link.href === `#${oldId}`) {
              touched = true;
              return {
                ...di,
                label: {
                  label: newLabel,
                  href: `#${newId}`,
                } as unknown as FieldValue,
              };
            }
            return di;
          });
          if (touched) {
            touchedMenuIndices.push(mi);
            newNavLinks.push({
              ...menuItem,
              dropdown_items: newDropItems as unknown as FieldValue,
            });
          } else {
            newNavLinks.push(menuItem);
          }
        }
        if (touchedMenuIndices.length > 0) {
          // Persist the linked dropdown changes in composition state
          // so autosave + the next publish carry the new label + href.
          patchComposition((prev) => ({
            ...prev,
            shared: {
              ...(prev.shared ?? {}),
              nav_overrides: {
                ...((prev.shared?.nav_overrides ?? {}) as Record<
                  string,
                  FieldValue
                >),
                nav_links: newNavLinks as unknown as FieldValue,
              },
            },
          }));
          // Live-patch each affected nav menu item's dropdown
          // wholesale (no full iframe rebuild). The iframe handler
          // rewrites the .dropdown <ul>'s innerHTML from the items
          // payload, preserving structure.
          for (const mi of touchedMenuIndices) {
            const menuItem = newNavLinks[mi];
            const dropItems =
              (menuItem.dropdown_items as Array<Record<string, FieldValue>>) ??
              [];
            const flat = dropItems.map((di) => {
              const link = di.label as { label?: string; href?: string };
              return {
                label: link?.label ?? "",
                href: link?.href ?? "",
              };
            });
            sendIframePatch({
              type: "SK_PATCH_AUTO_SYNCED_DROPDOWN",
              sectionId: "shared:nav",
              repeaterKey: "nav_links",
              navMenuItemIndex: mi,
              items: flat,
            });
          }
        }
      }
    }

    // ── Reserved-key fallback: full iframe rebuild ──
    // Reserved item-local keys (prefixed with `__`) don't have a leaf
    // schema entry, so they can't ride SK_PATCH_REPEATER_ITEM (which
    // dispatches by fieldType). They also change rendering globally
    // rather than at one element — e.g. `__auto_sync_from` flips a
    // whole nested dropdown into derived mode; `__item_id` was
    // already handled above. For the auto-sync toggle in particular
    // there's no targeted patch we can send (the iframe would need to
    // rebuild a whole sub-list), so we bump publishVersion to force
    // the iframe srcDoc memo to re-render. Toggle clicks are rare,
    // the perf cost is invisible. Skip for `__item_id` since it
    // already dispatched its own targeted patches above.
    if (itemFieldKey.startsWith("__") && itemFieldKey !== "__item_id") {
      setPublishVersion((v) => v + 1);
      return;
    }

    if (!itemFieldType) return;

    sendIframePatch({
      type: "SK_PATCH_REPEATER_ITEM",
      sectionId,
      repeaterKey,
      itemIndex,
      fieldKey: itemFieldKey,
      fieldType: itemFieldType,
      value: translateValueForIframe(value),
    });
  }

  // ── Shared (nav/footer) ──
  function setSharedTemplate(slot: "nav" | "footer", templateId: string) {
    const newTpl = templateMap.get(templateId);
    const allowedKeys = newTpl
      ? new Set(Object.keys(newTpl.placeholder_schema ?? {}))
      : new Set<string>();
    patchComposition((prev) => {
      const shared = prev.shared ?? {};
      const oldOverrides =
        slot === "nav" ? shared.nav_overrides : shared.footer_overrides;
      const filteredOverrides: Record<string, FieldValue> = {};
      for (const [k, v] of Object.entries(
        oldOverrides as Record<string, FieldValue> ?? {},
      )) {
        if (allowedKeys.has(k)) filteredOverrides[k] = v;
      }
      return {
        ...prev,
        shared: {
          ...shared,
          ...(slot === "nav"
            ? { nav_template_id: templateId, nav_overrides: filteredOverrides }
            : {
                footer_template_id: templateId,
                footer_overrides: filteredOverrides,
              }),
        },
      };
    });
  }

  // ── One-click site scaffold (Basic / Premium) ──
  // Picks one random template per category and assembles a complete
  // composition in a single state update. Defaults from each
  // template's placeholder_schema flow through automatically — nothing
  // else to fill in.
  //
  // Two variants (Peter 2026-05-15):
  //   • "basic"   — leaner site for cheaper packages. Skips
  //                 how-it-works, faq, and cta sections.
  //   • "premium" — every category in the catalog.
  //
  // Performance note: ONE setComposition call (vs. one per "Add
  // section"), ONE iframe rebuild, ONE autosave PUT. Strictly faster
  // than the manual flow on every dimension.
  function scaffoldFullSite(variant: "basic" | "premium" = "premium") {
    // Canonical site flow. `how-it-works` sits right after the hero per
    // Peter's spec — intro pitch, then "here's how we work", then the
    // rest of the page tells the story. Nav + footer are shared slots;
    // the rest are body sections in this order.
    const ORDERED_CATEGORIES = [
      "nav",
      "hero",
      "how-it-works",
      "about",
      "services",
      "gallery",
      "reviews",
      "faq",
      "cta",
      "contact",
      "map",
      "footer",
    ] as const;
    const SHARED_CATEGORIES = new Set(["nav", "footer"]);
    // Categories the Basic preset omits — cheaper-package sites stay
    // focused on intro + services + proof + contact, no process
    // explainer / faq / extra cta block.
    const BASIC_EXCLUDED = new Set(["how-it-works", "faq", "cta"]);

    // Group available templates by category once. Random pick is
    // O(1) per category from the resulting array.
    const byCategory = new Map<string, SectionTemplate[]>();
    for (const t of templates) {
      const list = byCategory.get(t.category);
      if (list) list.push(t);
      else byCategory.set(t.category, [t]);
    }

    patchComposition((prev) => {
      const newSections: CompositionSection[] = [];
      const sharedPatch: NonNullable<SiteComposition["shared"]> = {};
      let order = 0;
      // Use a single timestamp base so ids stay sortable in author intent
      // (sec_<ts>_a, sec_<ts>_b, ...) while still being unique.
      const tsBase = Date.now();

      for (const cat of ORDERED_CATEGORIES) {
        // Basic preset skips the explainer / faq / extra-cta blocks.
        // Premium hits every category.
        if (variant === "basic" && BASIC_EXCLUDED.has(cat)) continue;
        const choices = byCategory.get(cat);
        if (!choices || choices.length === 0) continue;
        const picked = choices[Math.floor(Math.random() * choices.length)]!;
        if (SHARED_CATEGORIES.has(cat)) {
          if (cat === "nav") {
            sharedPatch.nav_template_id = picked.id;
            sharedPatch.nav_overrides = {};
          } else {
            sharedPatch.footer_template_id = picked.id;
            sharedPatch.footer_overrides = {};
          }
        } else {
          newSections.push({
            id: `sec_${tsBase}_${order.toString(36)}${Math.random().toString(36).slice(2, 5)}`,
            template_id: picked.id,
            order: order++,
            content_overrides: {},
          });
        }
      }

      return {
        ...prev,
        // Replace the home page's sections wholesale. The "Regenerate
        // site" button confirms before calling this when the site
        // already has content; the empty-state card is the other entry
        // point and is gated on emptiness.
        pages: prev.pages.map((p, i) =>
          i === 0 ? { ...p, sections: newSections } : p,
        ),
        shared: {
          ...(prev.shared ?? {}),
          ...sharedPatch,
        },
        // Random primary color from the curated palette; background
        // stays white (per Peter's spec — we only cycle the accent).
        // Set explicitly so a re-roll always picks fresh, regardless
        // of what the previous theme had.
        theme: {
          ...(prev.theme ?? {}),
          primary: pickScaffoldPrimary(),
          bg: "#ffffff",
        },
      };
    });
  }

  // Confirms before scaffolding when the site already has content. Wraps
  // the same scaffoldFullSite() function used by the empty-state card.
  // Variant ("basic" | "premium") is forwarded so the regenerate flow
  // can pick which preset to re-roll into.
  function regenerateSite(variant: "basic" | "premium") {
    const label = variant === "basic" ? "Basic" : "Premium";
    const ok = window.confirm(
      `Replace the current site with a new ${label} scaffold?\n\n` +
        "All sections, the nav/footer choice, and the primary color will be re-rolled. " +
        "Your text edits and uploaded images will be lost. SEO settings are preserved.",
    );
    if (!ok) return;
    scaffoldFullSite(variant);
  }

  function removeShared(slot: "nav" | "footer") {
    patchComposition((prev) => {
      const shared = { ...(prev.shared ?? {}) };
      if (slot === "nav") {
        delete shared.nav_template_id;
        delete shared.nav_overrides;
      } else {
        delete shared.footer_template_id;
        delete shared.footer_overrides;
      }
      return { ...prev, shared };
    });
  }

  function updateSharedContent(
    slot: "nav" | "footer",
    key: string,
    value: FieldValue,
  ) {
    const tplId =
      slot === "nav"
        ? compositionRef.current.shared?.nav_template_id
        : compositionRef.current.shared?.footer_template_id;
    const tpl = tplId ? templateMap.get(tplId) : undefined;
    const fieldType = (tpl?.placeholder_schema as
      | Record<string, { type: string }>
      | undefined)?.[key]?.type;

    patchComposition((prev) => {
      const shared = prev.shared ?? {};
      const overridesKey = slot === "nav" ? "nav_overrides" : "footer_overrides";
      const oldOverrides = shared[overridesKey] ?? {};
      return {
        ...prev,
        shared: {
          ...shared,
          [overridesKey]: { ...oldOverrides, [key]: value },
        },
      };
    });

    if (fieldType === "repeater") {
      // Structural repeater change (add/remove/reorder) — bump preview
      // so the renderer re-clones items. Debounced to coalesce bursts.
      schedulePreviewBump();
    } else if (fieldType) {
      // Brand-fallback resolution for footer_logo before it ships to
      // the iframe. Reset-to-Brand sends value="" through this path;
      // without the resolution the surgical SK_PATCH_FIELD handler
      // strips the <img src> attribute and the iframe shows alt text
      // ("Logo") instead of the brand mark. The full-rebuild path in
      // render-browser.ts already does this fallback; this mirrors it
      // for the keystroke path so both update routes agree.
      // Bug Peter caught 2026-05-15: clicking "Reset to Brand" on a
      // footer that had its own upload left a broken <img> until the
      // next structural rebuild forced a full re-render.
      let patchValue = value;
      if (
        slot === "footer" &&
        key === "footer_logo" &&
        (value === undefined ||
          value === null ||
          (typeof value === "string" && value.trim().length === 0))
      ) {
        const resolved = resolveBrand(
          compositionRef.current.brand,
          compositionRef.current.theme,
          siteName,
        );
        patchValue = resolved.logoUrl as FieldValue;
      }
      sendIframePatch({
        type: "SK_PATCH_FIELD",
        sectionId: `shared:${slot}`,
        fieldKey: key,
        fieldType,
        value: translateValueForIframe(patchValue),
      });
    }
  }

  /**
   * Shared-slot repeater item-field edit — single field within a single
   * item changed (e.g. typed a character into a nav-link label). Updates
   * composition state AND sends a targeted in-place patch so the iframe
   * doesn't flicker. Handles only this one path; add/remove/reorder go
   * through `updateSharedContent` above.
   */
  function updateSharedItemField(
    slot: "nav" | "footer",
    repeaterKey: string,
    itemIndex: number,
    itemFieldKey: string,
    value: FieldValue,
  ) {
    // Resolve the schema first so we can fall back to default_items
    // when there's no override yet — same fix as updateSectionItemField.
    // Without this, editing nav-link 0 of a brand-new nav (still showing
    // schema defaults) would silently drop links 1..N.
    const sharedTplId =
      slot === "nav"
        ? compositionRef.current.shared?.nav_template_id
        : compositionRef.current.shared?.footer_template_id;
    const tplForDefaults = sharedTplId ? templateMap.get(sharedTplId) : undefined;
    const repeaterSchemaForDefaults = (tplForDefaults?.placeholder_schema as
      | Record<string, FieldSchema>
      | undefined)?.[repeaterKey];
    const sharedDefaultItems =
      (repeaterSchemaForDefaults?.default_items as
        | Array<Record<string, FieldValue>>
        | undefined) ?? [];

    // 1. State sync — replace just the one field in the one item.
    patchComposition((prev) => {
      const shared = prev.shared ?? {};
      const overridesKey = slot === "nav" ? "nav_overrides" : "footer_overrides";
      const oldOverrides = shared[overridesKey] ?? {};
      const oldRepeater =
        (oldOverrides[repeaterKey] as
          | Array<Record<string, FieldValue>>
          | undefined) ??
        sharedDefaultItems;
      const newItems = oldRepeater.slice();
      const oldItem = newItems[itemIndex] ?? {};
      newItems[itemIndex] = { ...oldItem, [itemFieldKey]: value };
      return {
        ...prev,
        shared: {
          ...shared,
          [overridesKey]: { ...oldOverrides, [repeaterKey]: newItems },
        },
      };
    });

    // 2. Resolve the per-item field type so the iframe handler knows
    //    how to apply the value (text vs image vs link).
    const tplId =
      slot === "nav"
        ? compositionRef.current.shared?.nav_template_id
        : compositionRef.current.shared?.footer_template_id;
    const tpl = tplId ? templateMap.get(tplId) : undefined;
    const repeaterSchema = (tpl?.placeholder_schema as
      | Record<string, FieldSchema>
      | undefined)?.[repeaterKey];
    const itemFieldType =
      repeaterSchema?.item_schema?.[itemFieldKey]?.type;
    if (!itemFieldType) return;

    // 3. In-place patch — no publishVersion bump, no iframe re-render.
    sendIframePatch({
      type: "SK_PATCH_REPEATER_ITEM",
      sectionId: `shared:${slot}`,
      repeaterKey,
      itemIndex,
      fieldKey: itemFieldKey,
      fieldType: itemFieldType,
      value: translateValueForIframe(value),
    });
  }

  // ── Theme ──
  //
  // Native <input type="color"> fires `onChange` continuously while the user
  // drags through the picker (Chrome especially — dozens of events per
  // second). Each one was triggering a full composer re-render which made
  // the picker feel laggy.
  //
  // Decoupled now:
  //  - sendIframePatch is fired IMMEDIATELY on every change so the preview
  //    paints in real-time (cheap CSS-variable update inside the iframe).
  //  - patchComposition (the heavy React state update that re-renders the
  //    whole composer tree) is rAF-throttled — at most one re-render per
  //    animation frame regardless of how many color events fire.
  //  - The save itself is still debounced 250ms by scheduleSave, so the
  //    network call only fires once after the user lets go of the picker.
  const themeRafRef = useRef<number | null>(null);
  const pendingThemeRef = useRef<SiteTheme | null>(null);

  function updateTheme(key: keyof SiteTheme, value: string) {
    // Compose the new theme on top of any pending updates so we never lose
    // changes while waiting for the next frame.
    const base =
      pendingThemeRef.current ?? compositionRef.current.theme ?? {};
    const newTheme = { ...base, [key]: value };
    pendingThemeRef.current = newTheme;

    // Immediate visual feedback — iframe just patches its <style> tag.
    sendIframePatch({
      type: "SK_PATCH_THEME",
      css: buildThemeCss(newTheme),
    });

    // Font change ALSO needs a fresh Google Fonts <link> to actually
    // load the new typeface in the iframe — the CSS variable update
    // above re-binds the family-name, but if that family isn't loaded
    // yet the browser falls back to a system font. Sending the URL
    // here makes the iframe download + apply the new font in the
    // background. Skip when the URL hasn't changed (e.g. user picked
    // the same font they already had).
    if (key === "heading_font" || key === "body_font") {
      const href = buildGoogleFontsUrl(newTheme);
      if (href) {
        sendIframePatch({
          type: "SK_PATCH_FONTS",
          href,
        });
      }
    }

    // Auto-mode brand follows the primary color: the icon block fill IS
    // theme.primary. When the user drags the color picker or rolls the
    // dice, we resolve a fresh brand against the new theme and patch the
    // iframe so the navbar/footer logo recolors live alongside every
    // other primary-themed surface (buttons, links, etc). Custom-mode
    // uploads are intentionally untouched — the user's file stays put.
    if (key === "primary") {
      const brand = compositionRef.current.brand;
      const isAuto = !brand || brand.mode !== "custom" || !brand.custom_logo_url;
      if (isAuto) {
        const resolved = resolveBrand(brand, newTheme, siteName);
        sendIframePatch({
          type: "SK_PATCH_BRAND",
          logoUrl: resolved.logoUrl,
          faviconUrl: resolved.faviconUrl,
        });
      }
    }

    // Defer the React state update to the next frame.
    if (themeRafRef.current !== null) return;
    themeRafRef.current = requestAnimationFrame(() => {
      themeRafRef.current = null;
      const finalTheme = pendingThemeRef.current;
      pendingThemeRef.current = null;
      if (!finalTheme) return;
      patchComposition((prev) => ({ ...prev, theme: finalTheme }));
    });
  }

  // ── Brand ──
  // Brand panel updates: company text edits, mode toggles (auto ↔ custom),
  // custom logo URL set after image upload. Single helper takes a partial
  // patch so the panel can update multiple fields atomically (e.g. set
  // mode=custom + custom_logo_url in one shot).
  //
  // Why an SK_PATCH_BRAND postMessage instead of a publishVersion bump:
  // typing into the company text input fires onChange per keystroke. A
  // full iframe rebuild per character would make the preview blink
  // visibly. Instead we compute the new resolvedBrand in the parent
  // (cheap — pure SVG string concat) and tell the iframe to swap the
  // nav/footer logo `<img>` src + favicon link href in place — no
  // reload, no flicker. Same approach the theme color picker uses
  // (SK_PATCH_THEME).
  function updateBrand(patch: Partial<SiteBrand>) {
    patchComposition((prev) => {
      const current = prev.brand ?? makeDefaultBrand(siteName);
      const next = { ...current, ...patch };
      // Resolve against the just-updated brand + the current theme so
      // mode toggles (auto ↔ custom) reflect immediately too — not just
      // company_text edits.
      const resolved = resolveBrand(next, prev.theme, siteName);
      // Logo height is sent as part of every brand patch so the iframe
      // keeps a coherent view of the brand. The handler treats:
      //   number → set inline height on `.logo` (live grow/shrink)
      //   null   → strip the inline override (back to template default)
      // Sending the just-computed `next.logo_height_px` (rather than
      // reading from `prev` after `patchComposition` schedules) avoids
      // the stale-state trap the size/width updaters guard against.
      const navHeight =
        typeof next.logo_height_px === "number"
          ? next.logo_height_px
          : null;
      sendIframePatch({
        type: "SK_PATCH_BRAND",
        // Translate `pending:` URLs to blob: URLs the iframe can render.
        // Custom-mode uploads come in as pending markers initially —
        // without this the iframe sees an unloadable src and the logo
        // disappears until the next publish.
        logoUrl: translateValueForIframe(resolved.logoUrl) as string,
        faviconUrl: translateValueForIframe(resolved.faviconUrl) as string,
        logoHeightPx: navHeight,
      });
      return { ...prev, brand: next };
    });
  }

  // ── SEO ──
  // SEO updates happen during iframe rebuild (the meta tags only show in
  // the rendered HTML head, so a postMessage patch wouldn't help). The
  // structuralKey memo doesn't need to include `seo` because <head> meta
  // doesn't visually affect the preview body. We just persist it.
  //
  // Takes a partial patch (vs. single key/value) so multi-field updates
  // land atomically — image upload sets og_image_url + og_image_width +
  // og_image_height in one shot so the published <head> always has matched
  // dimensions for any image it references.
  function updateSeo(patch: Partial<SiteSeo>) {
    patchComposition((prev) => {
      const seo: Record<string, unknown> = { ...(prev.seo ?? {}) };
      for (const [key, value] of Object.entries(patch)) {
        // Treat empty string + null + undefined as "clear this field" so
        // we don't bloat composition.seo with empties. `false` is kept as-
        // is (no_index=false is meaningful = explicitly opt-in to indexing).
        if (value === undefined || value === null || value === "") {
          delete seo[key];
        } else {
          seo[key] = value;
        }
      }
      return { ...prev, seo: seo as SiteSeo };
    });
  }

  // Per-page SEO override patch — writes to composition.pages[path].seo
  // (title / description / share image / noindex for a single subpage).
  // Same empty-cleanup rule as updateSeo; when a page's seo ends up empty
  // the whole `seo` key is dropped so "no overrides" reads as absent and
  // the composition stays lean.
  function updatePageSeo(pagePath: string, patch: Partial<PageSeo>) {
    patchComposition((prev) => {
      const pages = prev.pages.map((p) => {
        if (p.path !== pagePath) return p;
        const seo: Record<string, unknown> = { ...(p.seo ?? {}) };
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined || value === null || value === "") {
            delete seo[key];
          } else {
            seo[key] = value;
          }
        }
        const next: CompositionPage = { ...p };
        if (Object.keys(seo).length > 0) next.seo = seo as PageSeo;
        else delete next.seo;
        return next;
      });
      return { ...prev, pages };
    });
  }

  // ── Multi-language (i18n) handlers ──
  // The base composition is the DEFAULT-language content; per-locale
  // translation snapshots live on composition.i18n.translations. All four
  // helpers keep the default locale first in enabled_locales (display order
  // + the renderer's root assumption) and prune empty structures so a
  // single-language site reads as "no i18n" with no leftover scaffolding.
  function setDefaultLocale(locale: SiteLocale) {
    patchComposition((prev) => {
      const cur = prev.i18n;
      const set = new Set(cur?.enabled_locales ?? []);
      set.add(locale);
      const ordered = [locale, ...[...set].filter((l) => l !== locale)];
      const next: SiteI18n = {
        default_locale: locale,
        enabled_locales: ordered,
      };
      if (cur?.translations && Object.keys(cur.translations).length > 0) {
        // A locale that just became the default no longer needs a stored
        // translation (its content IS the base now); drop it if present.
        const translations = { ...cur.translations };
        delete translations[locale];
        if (Object.keys(translations).length > 0) next.translations = translations;
      }
      return { ...prev, i18n: next };
    });
  }

  function toggleLocale(locale: SiteLocale, on: boolean) {
    patchComposition((prev) => {
      const cur: SiteI18n = prev.i18n ?? {
        default_locale: "sk",
        enabled_locales: ["sk"],
      };
      if (locale === cur.default_locale) return prev; // can't toggle the default off
      const set = new Set(cur.enabled_locales);
      const translations = { ...(cur.translations ?? {}) };
      if (on) {
        set.add(locale);
      } else {
        set.delete(locale);
        delete translations[locale]; // dropping a language drops its translation
      }
      const ordered = [
        cur.default_locale,
        ...[...set].filter((l) => l !== cur.default_locale),
      ];
      const next: SiteI18n = {
        default_locale: cur.default_locale,
        enabled_locales: ordered,
      };
      if (Object.keys(translations).length > 0) next.translations = translations;
      return { ...prev, i18n: next };
    });
  }

  function applyTranslationImport(
    locale: SiteLocale,
    snapshot: RoundtripSnapshot,
  ) {
    patchComposition((prev) => {
      const cur: SiteI18n = prev.i18n ?? {
        default_locale: "sk",
        enabled_locales: ["sk"],
      };
      const set = new Set(cur.enabled_locales);
      set.add(locale);
      const ordered = [
        cur.default_locale,
        ...[...set].filter((l) => l !== cur.default_locale),
      ];
      return {
        ...prev,
        i18n: {
          default_locale: cur.default_locale,
          enabled_locales: ordered,
          translations: { ...(cur.translations ?? {}), [locale]: snapshot },
        },
      };
    });
  }

  function clearTranslation(locale: SiteLocale) {
    patchComposition((prev) => {
      const cur = prev.i18n;
      if (!cur?.translations) return prev;
      const translations = { ...cur.translations };
      delete translations[locale];
      const next: SiteI18n = {
        default_locale: cur.default_locale,
        enabled_locales: cur.enabled_locales,
      };
      if (Object.keys(translations).length > 0) next.translations = translations;
      return { ...prev, i18n: next };
    });
  }

  // Single click handler from the rail — dispatches by category. After
  // adding, we mark the new section as selected so:
  //   1. The composition rail (right panel) auto-scrolls to it via the
  //      SectionCard / SharedSlot's selection-driven scrollIntoView effect.
  //   2. The preview iframe scrolls to it via the SK_SET_SELECTED postMessage.
  // → User instantly sees where the new section landed in both panels.
  function handleRailPick(category: string, templateId: string) {
    if (category === "nav") {
      setSharedTemplate("nav", templateId);
      setSelectedSectionId("shared:nav");
      return;
    }
    if (category === "footer") {
      setSharedTemplate("footer", templateId);
      setSelectedSectionId("shared:footer");
      return;
    }
    const newId = addSection(templateId);
    setSelectedSectionId(newId);
  }

  // Templates resolved for shared slots (for the SharedSlot card)
  const navTemplate = composition.shared?.nav_template_id
    ? templateMap.get(composition.shared.nav_template_id)
    : undefined;
  const footerTemplate = composition.shared?.footer_template_id
    ? templateMap.get(composition.shared.footer_template_id)
    : undefined;

  // ── Drag-and-drop sensors ──
  // PointerSensor with a 4px activation distance — small drag required before
  // a reorder starts, so plain clicks on cards still work for selection.
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const sortedSections = useMemo(
    () => activePage.sections.slice().sort((a, b) => a.order - b.order),
    [activePage.sections],
  );

  // Stable id list for SortableContext — must match the order rendered.
  const sortableIds = useMemo(
    () => sortedSections.map((s) => s.id),
    [sortedSections],
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    if (active.id === over.id) return;
    reorderSections(String(active.id), String(over.id));
  }

  // ── Publish (Phase B) ──
  // Walk the composition for `pending:{uuid}` markers, gather each file
  // from IndexedDB, and POST as multipart so the server can bundle them
  // into the Cloudflare Pages deployment alongside the rendered HTML.
  // Files that publish successfully get deleted from IDB on success.
  async function handlePublish() {
    // Wait for every in-flight image upload to settle first. Without
    // this, a user who picks an image and clicks Publish before the
    // upload finishes deploys with a stale composition (the URL only
    // lands in state when uploadImage resolves and the field's
    // onChange fires). Pair with the post-await flush below so any
    // resulting setComposition gets flushed too.
    setPublishing(true);
    try {
      await uploadTracker.awaitAllPendingUploads();
    } catch {
      // trackUpload settles even on rejection, so this catch is just
      // belt-and-suspenders — there shouldn't ever be a throw here.
    }
    // Force-save NOW so the autosave debounce window doesn't drop an
    // upload's onChange that landed during awaitAllPendingUploads.
    await flushPendingComposition();
    try {
      // Gather pending files from IDB
      const pendingKeys = collectPendingKeys(compositionRef.current);
      const form = new FormData();
      const missingKeys: string[] = [];
      for (const key of pendingKeys) {
        const file = await getPendingFile(key);
        if (!file) {
          missingKeys.push(key);
          continue;
        }
        form.append(`file:${key}`, file, file.name);
      }
      if (missingKeys.length > 0) {
        toast.error(
          `${missingKeys.length} pending image(s) missing from this device. Re-upload them and try again.`,
        );
        return;
      }

      const res = await fetch(`/api/sites/${siteId}/publish`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Publish failed");
        return;
      }
      // Toast carries the live URL and an "Open" action button. The action
      // is opt-in — clicking it opens the site in a new tab. We deliberately
      // do NOT auto-open the tab on success (Peter 2026-05-08): popping a
      // new tab in the user's face every publish is jarring, especially
      // when they're iterating on small edits and publishing multiple times.
      // The PublishMenu's "Live at" row is also clickable as a second path.
      toast.success(`Published! Live at ${data.url}`, {
        duration: 8000,
        action: data.url
          ? {
              label: "Open",
              onClick: () => window.open(data.url, "_blank", "noopener,noreferrer"),
            }
          : undefined,
      });

      // Capture the freshly-published URL FIRST so the next iframe
      // render (triggered by the composition patch below) uses it as
      // <base href>. Without this, the iframe re-renders with the new
      // /_uploads/... paths against the previous URL (or empty, on
      // first publish) and images 404 in the preview until
      // router.refresh() finishes — while the original Supabase
      // staging files have already been deleted.
      //
      // CRITICAL: prefer `data.pagesUrl` (the .pages.dev URL) over
      // `data.friendlyUrl` (the custom *.pages.dev domain). On first
      // publish the custom domain's DNS hasn't propagated yet and
      // the Cloudflare edge serves 404 for every /_uploads/* request,
      // making every newly-uploaded image show as broken in the
      // composer preview even though the live site is fine. The
      // .pages.dev URL is fronted directly by Cloudflare and goes
      // live the instant the deployment completes — no DNS step in
      // between. Same files, more reliable host for the immediate
      // post-publish window. The live site (and future composer
      // sessions reading siteUrl from the DB) will use the friendly
      // domain as before once it's actually reachable.
      const freshUrl: string | null =
        (typeof data.pagesUrl === "string" && data.pagesUrl) ||
        (typeof data.friendlyUrl === "string" && data.friendlyUrl) ||
        (typeof data.url === "string" && data.url) ||
        null;
      if (freshUrl) setFreshlyPublishedUrl(freshUrl);

      // Patch the local composition with the server's URL substitutions
      // (e.g. `pending:abc` → `/_uploads/123.png`). The composition is
      // stored in useState and won't pick up the refreshed initialComposition
      // prop on its own — we have to update local state manually so the
      // iframe + sidebar see the resolved URLs immediately.
      const subs: Record<string, string> = data.substitutions ?? {};
      if (Object.keys(subs).length > 0) {
        setComposition((prev) => substituteCompositionUrls(prev, subs));
        // Force the preview iframe to re-render with the new URLs (image
        // edits normally bypass structuralKey to keep the iframe stable).
        setPublishVersion((v) => v + 1);
      }

      // Clean up IDB entries that were just flushed to Cloudflare.
      const flushed: string[] = Array.isArray(data.flushedKeys)
        ? data.flushedKeys
        : [];
      for (const key of flushed) {
        await deletePendingImage(key);
      }

      // Refresh so the server component re-fetches site_url (needed for the
      // <base href> + thumbnail URL resolution after the very first publish).
      router.refresh();
    } catch (err) {
      console.error("[handlePublish] error:", err);
      toast.error("Network error");
    } finally {
      setPublishing(false);
    }
  }

  // ── Anchors list ──
  // Walks composition + template schemas to produce every link target the
  // user can `#<id>` to on this page. Used by the link-href autocomplete
  // in placeholder-field. Memoised so the list only recomputes when the
  // composition's content actually changes — typing into ANY text field
  // would otherwise rebuild this on every keystroke (cheap for now, but
  // pointless work).
  // Lookup object shared by collectPageAnchors + computeRenderedSectionIds
  // — both need the same template name + schema + defaultSectionId
  // accessor. Declared here so the memos below stay terse and the cast
  // (SectionTemplate's placeholder_schema vs AnchorSchemaEntry shape)
  // lives in one place.
  const anchorLookup = useMemo(() => {
    return {
      getTemplate: (id: string) => {
        const t = templateMap.get(id);
        if (!t) return undefined;
        return {
          name: t.name,
          // SectionTemplate's placeholder_schema is the narrower
          // {type, default, default_src} shape, but the runtime value
          // carries the full FieldSchema (parser writes it that way).
          // Cast through `unknown` — page-anchors only reads .type,
          // .item_id_source, .item_schema, all present at runtime.
          placeholder_schema: t.placeholder_schema as unknown as Record<
            string,
            AnchorSchemaEntry
          >,
        };
      },
      getDefaultSectionId: (id: string) =>
        templateBodyMap.get(id)?.defaultSectionId ?? null,
    };
  }, [templateMap, templateBodyMap]);

  const pageAnchors = useMemo<AnchorEntry[]>(() => {
    // In-page anchor targets (section ids + per-item ids) across ALL
    // pages. activePagePath decides which anchors are bare `#id`
    // (same page = pure scroll) vs qualified `o-nas.html#id`
    // (other page = resolves from anywhere, incl. the shared nav).
    const anchors = collectPageAnchors(composition, anchorLookup, activePagePath);
    // Whole-page link targets (every page in composition.pages).
    // Pages first so they sort above anchors in the dropdown — when
    // an operator is editing a nav-link href, "go to another page"
    // is a more common intent than "jump to an in-page section".
    const pages = collectPageEntries(composition);
    return [...pages, ...anchors];
  }, [composition, anchorLookup, activePagePath]);

  // Map of section.id → final rendered anchor id (after the page-wide
  // dedup pass). Used by SectionCard to show the "→ #sluzby-2" hint
  // when a section was auto-renumbered. Built from the exact same
  // algorithm the renderers use, so the chip's hint matches the
  // published HTML.
  const renderedSectionIds = useMemo(() => {
    return computeRenderedSectionIds(composition, anchorLookup, activePagePath);
  }, [composition, anchorLookup, activePagePath]);

  // ── Layout: 3 columns ──
  return (
    <UploadTrackerContext.Provider value={uploadTracker}>
    <SiteUrlContext.Provider value={effectiveSiteUrl ?? null}>
    <AnchorsProvider value={pageAnchors}>
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Top bar */}
      <header className="h-12 border-b shrink-0 flex items-center justify-between px-4 bg-card">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => router.push(backHref)}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <h1 className="text-sm font-semibold">{siteName}</h1>
          <SaveIndicator status={saveStatus} />
        </div>

        <div className="flex items-center gap-2">
          {/* AI Generate — top of the action group so it's the first
              thing a tech sees on a fresh scaffold. Opens the modal
              that pre-fills from the proposal, lets the tech tweak,
              then fires /api/composer/ai-generate and applies the
              returned overrides through the normal field-update path
              (no special render, no flicker). Hidden in client mode
              because clients aren't expected to invoke AI bulk-fill —
              IT runs it before handover, clients edit by hand. */}
          {!isClientMode && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setAiModalOpen(true)}
              title="Generate Slovak content with AI for every empty field"
            >
              <Sparkles className="h-4 w-4 text-primary" />
              Generate content
            </Button>
          )}

          {/* JSON workflow — bring-your-own-AI alternative to the paid
              Generate content button. Export the site's editable text
              fields as JSON, fill via chatgpt.com (free), import the
              result. Same field-update path as the paid AI Fill
              (applyAiOverrides) so behaviour is identical once the
              JSON is back. Tech-only — same gate as Generate content. */}
          {!isClientMode && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setJsonModalOpen(true)}
              title="Export content as JSON → fill in ChatGPT → import back (free)"
            >
              <FileJson className="h-4 w-4 text-primary" />
              JSON workflow
            </Button>
          )}

          {/* Preview site — renders the CURRENT in-memory composition into a
              Blob URL and opens it in a new tab. No server round-trip, no DB
              writes, no save needed; always reflects exactly what you see in
              the composer right now. Distinct from "Publish" because nothing
              goes live — it's a private preview only this browser can open. */}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              // Translate `pending:` URLs to in-memory blob URLs so the
              // new tab can actually load the images. Without this, the
              // rendered HTML carries `<img src="pending:...">` which the
              // browser can't fetch.
              const translated = translatePendingUrls(compositionRef.current);
              // Multi-page preview: holds EVERY page in one document with a
              // client router, so clicking a subpage link stays inside the
              // preview (swaps the visible page) instead of jumping to the
              // live deployed site. Opens on the page currently being edited.
              const html = renderMultiPagePreview(
                translated,
                templateBodyMap,
                {
                  baseCss,
                  initialPath: activePagePathRef.current,
                  // Same override the live preview uses — see notes near
                  // `freshlyPublishedUrl` declaration above.
                  deploymentBaseUrl: effectiveSiteUrl ?? undefined,
                },
              );
              const blob = new Blob([html], { type: "text/html" });
              const url = URL.createObjectURL(blob);
              // Drop "noopener" so the new tab is same-origin same-process
              // — required for blob: image URLs created in this tab to be
              // resolvable inside the new one.
              window.open(url, "_blank");
              // Free the wrapper blob URL after the new tab has had time
              // to load. Inner image blob URLs stay alive in this tab's
              // cache so the preview page can keep rendering them.
              setTimeout(() => URL.revokeObjectURL(url), 60_000);
            }}
            title="Open a private preview of the current edits in a new tab (no publish, no save needed)"
          >
            <ExternalLink className="h-4 w-4" />
            Preview site
          </Button>

          {/* Publish + history combined menu (Framer-style) — replaces the
              standalone Publish button. Shows the live URL, the publish
              action, and the last 5 versions with revert in one panel. */}
          <PublishMenu
            siteId={siteId}
            publishing={publishing}
            onPublish={handlePublish}
            siteUrl={siteUrl ?? undefined}
            flushPendingComposition={flushPendingComposition}
            mode={mode}
          />
        </div>
      </header>

      {/* Pages strip — full-width row between the header and the work
          columns. Clients see the tabs (so they can navigate to
          subpages and edit content on each), but the structural
          controls — Add page + per-tab × remove — are hidden in
          client mode via the isClientMode prop on PagesTabs.
          Pre-2026-05-30 the whole strip was hidden for clients, which
          made subpages invisible + unreachable from the client zone. */}
      <PagesTabs
        pages={composition.pages}
        activePagePath={activePagePath}
        onSwitch={handlePageSwitch}
        onAdd={handlePageAdd}
        onRemove={handlePageRemove}
        isClientMode={isClientMode}
        availableServices={homeServiceItems}
        linkedServiceIdsInUse={linkedServiceIdsInUse}
      />

      {/* 3 columns: rail | preview | composition.
          SectionsRail is HIDDEN for clients (Peter 2026-05-08, reaffirmed):
          clients only ever EDIT sections their IT team built — they don't
          add new structure. They keep drag-reorder, variant-swap, and
          remove on existing sections, plus full theme/SEO/publish, but no
          path to introduce a new section template. The preview + composition
          columns flex to fill the freed space. */}
      <div className="flex flex-1 overflow-hidden">
        {!isClientMode && (
          <SectionsRail
            templates={templates}
            templateBodies={templateBodies}
            baseCss={baseCss}
            onPick={handleRailPick}
          />
        )}

        {/* Preview — when the site is empty (no body sections + no shared
            slots set), skip the iframe entirely and show the scaffold card
            on a muted background that matches the rest of the dashboard
            chrome. Rendering the iframe in the empty case shows the
            template default white bg, which clashes with dark mode and
            looks broken. The card itself fully replaces the iframe in
            that state — no overlay-over-blank-iframe trickery. */}
        <div className="flex-1 min-w-0 border-r relative bg-muted/40">
          {/* Empty-state scaffold card is tech-only — clients should never
              land in the composer with zero sections (the IT person built
              the site for them already). If they somehow do (data bug or
              IT mid-build), they see the iframe's empty state without the
              big Generate button. */}
          {!isClientMode &&
          activePage.sections.length === 0 &&
          !composition.shared?.nav_template_id &&
          !composition.shared?.footer_template_id ? (
            <EmptyStateCard
              templateCount={templates.length}
              categoryCount={new Set(templates.map((t) => t.category)).size}
              onGenerateBasic={() => scaffoldFullSite("basic")}
              onGeneratePremium={() => scaffoldFullSite("premium")}
            />
          ) : (
            <PreviewPane srcDoc={previewHtml} iframeRef={iframeRef} />
          )}

          {/* Preview locale switcher — floats over the top-center of the
              preview, only when the site has more than one language. Lets
              the operator eyeball each translated version without
              publishing. Localizes the composition in the previewHtml memo. */}
          {(composition.i18n?.enabled_locales?.length ?? 1) > 1 && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-0.5 rounded-md border bg-card/95 backdrop-blur px-1 py-0.5 shadow-sm">
              {composition.i18n!.enabled_locales.map((loc) => {
                const isDefault = loc === composition.i18n!.default_locale;
                const active = isDefault
                  ? previewLocale === null || previewLocale === loc
                  : previewLocale === loc;
                const translated =
                  isDefault ||
                  Object.keys(composition.i18n!.translations?.[loc] ?? {}).length > 0;
                return (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => setPreviewLocale(isDefault ? null : loc)}
                    disabled={!translated}
                    title={
                      translated
                        ? LOCALE_LABELS[loc]
                        : `${LOCALE_LABELS[loc]} — not translated yet`
                    }
                    className={`px-2 py-0.5 rounded text-xs font-semibold transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : translated
                          ? "text-muted-foreground hover:text-foreground"
                          : "text-muted-foreground/40 cursor-not-allowed"
                    }`}
                  >
                    {LOCALE_SHORT[loc]}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right panel — tabbed: Composition (sections + theme) | SEO */}
        <div className="w-96 flex flex-col overflow-hidden shrink-0">
          {/* Tab bar */}
          <div className="flex shrink-0 border-b bg-card">
            <TabButton
              active={rightTab === "composition"}
              onClick={() => setRightTab("composition")}
              label="Composition"
              hint={`${activePage.sections.length} section${
                activePage.sections.length === 1 ? "" : "s"
              }`}
            />
            <TabButton
              active={rightTab === "seo"}
              onClick={() => setRightTab("seo")}
              label="SEO"
              hint={hasSeoContent(composition.seo) ? "Set up" : "Defaults only"}
            />
            <TabButton
              active={rightTab === "languages"}
              onClick={() => setRightTab("languages")}
              label="Languages"
              hint={
                (composition.i18n?.enabled_locales?.length ?? 1) > 1
                  ? `${composition.i18n!.enabled_locales.length} languages`
                  : "1 language"
              }
            />
          </div>

          {/* SEO tab body */}
          {rightTab === "seo" && (
            <div className="flex-1 overflow-y-auto p-3">
              <SeoPanel
                seo={composition.seo}
                siteName={siteName}
                siteId={siteId}
                siteUrl={siteUrl ?? undefined}
                onChange={updateSeo}
                // Per-page SEO: on a subpage the title/description/share-
                // image/visibility fields edit THAT page's overrides; on
                // home they edit the site-level SEO. The panel routes by
                // isHomePage. activePage is always defined (falls back to
                // home), so pageLabel/pageSeo are safe to read.
                pageLabel={activePage.label}
                isHomePage={activePagePath === HOME_PATH}
                pageSeo={activePage.seo}
                onPageSeoChange={(patch) =>
                  updatePageSeo(activePagePath, patch)
                }
                // Brand state powers the LocalBusiness JSON-LD indicator
                // at the bottom of the panel — tells the tech-admin
                // whether the auto-generated structured data has enough
                // info to emit on publish.
                brand={composition.brand}
                // Three brand fields (opening_hours, business_type,
                // social_*) are editable inside the Local business
                // section. SeoPanel pipes patches through this callback
                // so the data lives on composition.brand (shared with
                // the renderer) without SeoPanel needing to know about
                // composer-client's full update plumbing.
                onBrandChange={updateBrand}
              />
            </div>
          )}

          {/* Languages tab body */}
          {rightTab === "languages" && (
            <div className="flex-1 overflow-y-auto p-3">
              <LanguagesPanel
                i18n={composition.i18n}
                onSetDefault={setDefaultLocale}
                onToggleLocale={toggleLocale}
                onTranslate={(loc) => setTranslateLocale(loc)}
                onClearTranslation={clearTranslation}
              />
            </div>
          )}

          {/* Composition tab body */}
          {rightTab === "composition" && (
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {/* Regenerate site — destructive re-roll. Hidden when the
                site is empty (the empty-state card handles that case
                with the same scaffoldFullSite call, no confirm needed).
                Tech-only — clients can't structurally re-roll their own
                site. Two side-by-side buttons mirror the empty-state
                card: Basic (lean preset, skips how-it-works/faq/cta)
                vs Premium (every category). Discreet outline styling +
                destructive hover state so this doesn't compete with
                the section editing UI. */}
            {!isClientMode &&
              (activePage.sections.length > 0 ||
                composition.shared?.nav_template_id ||
                composition.shared?.footer_template_id) && (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => regenerateSite("basic")}
                  className="gap-1.5 text-xs text-muted-foreground hover:text-destructive hover:border-destructive/40"
                  title="Re-roll into a Basic scaffold (no how-it-works, faq, or cta). Your edits will be lost."
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Basic
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => regenerateSite("premium")}
                  className="gap-1.5 text-xs text-muted-foreground hover:text-destructive hover:border-destructive/40"
                  title="Re-roll into a Premium scaffold (every category). Your edits will be lost."
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Premium
                </Button>
              </div>
            )}

            <ThemePanel
              theme={composition.theme}
              onChange={updateTheme}
            />

            <SharedSlot
              slot="nav"
              template={navTemplate}
              siteId={siteId}
              overrides={composition.shared?.nav_overrides ?? {}}
              selected={selectedSectionId === "shared:nav"}
              onSelect={() =>
                setSelectedSectionId((prev) =>
                  prev === "shared:nav" ? null : "shared:nav",
                )
              }
              onContentChange={(key, value) => updateSharedContent("nav", key, value)}
              onItemFieldChange={(repeaterKey, idx, fk, v) =>
                updateSharedItemField("nav", repeaterKey, idx, fk, v)
              }
              hiddenFields={composition.shared?.nav_hidden_fields ?? []}
              onFieldHiddenChange={(rawKey, hidden) =>
                updateSharedFieldHidden("nav", rawKey, hidden)
              }
              onRemove={() => removeShared("nav")}
              // Brand mark control surfaces in the nav slot — logos belong
              // with the navbar UI, not buried in the Theme tab. Footer
              // slot inherits the same brand by design (single source of
              // truth in composition.brand) so we don't pass these to it.
              brand={composition.brand}
              themePrimary={composition.theme?.primary}
              onBrandChange={updateBrand}
              onPreviewBrandLogo={previewBrandLogo}
              mode={mode}
            />

            <DndContext
              sensors={dndSensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sortableIds}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-3">
                  {sortedSections.map((section) => (
                    <SectionCard
                      key={section.id}
                      section={section}
                      template={templateMap.get(section.template_id)}
                      allTemplates={templates}
                      templateBodies={templateBodies}
                      baseCss={baseCss}
                      siteId={siteId}
                      renderedAnchorId={renderedSectionIds.get(section.id) ?? ""}
                      selected={selectedSectionId === section.id}
                      onSelect={() =>
                        setSelectedSectionId((prev) =>
                          prev === section.id ? null : section.id,
                        )
                      }
                      onRemove={() => removeSection(section.id)}
                      onChangeVariant={(newId) =>
                        changeVariant(section.id, newId)
                      }
                      onContentChange={(key, value) =>
                        updateSectionContent(section.id, key, value)
                      }
                      onItemFieldChange={(repeaterKey, idx, fk, v) =>
                        updateSectionItemField(
                          section.id, repeaterKey, idx, fk, v,
                        )
                      }
                      onFieldFocus={(fieldKey) =>
                        handleFieldFocus(fieldKey ? section.id : null, fieldKey)
                      }
                      onPreviewImage={(fieldKey, url) =>
                        previewSectionImage(section.id, fieldKey, url)
                      }
                      onFieldSizeChange={(rawKey, next) =>
                        updateSectionFieldStyle(section.id, rawKey, next)
                      }
                      measureFieldSize={(rawKey) =>
                        measureIframeFieldSize(section.id, rawKey)
                      }
                      onFieldWidthChange={(rawKey, next) =>
                        updateSectionFieldWidth(section.id, rawKey, next)
                      }
                      measureFieldWidth={(rawKey) =>
                        measureIframeFieldWidth(section.id, rawKey)
                      }
                      onFieldFillChange={(rawKey, next) =>
                        updateSectionFieldFill(section.id, rawKey, next)
                      }
                      onFieldHiddenChange={(rawKey, hidden) =>
                        updateSectionFieldHidden(section.id, rawKey, hidden)
                      }
                      mode={mode}
                      onAiRegenerate={applyAiOverrides}
                      brand={composition.brand}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {/* Empty-state hint references the left rail, which is hidden
                from clients — only show this hint in tech mode. Clients
                shouldn't ever land in empty state (IT builds the site
                first), so they see nothing here either way. */}
            {activePage.sections.length === 0 && !isClientMode && (
              <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-12 text-center">
                <p className="text-sm text-muted-foreground">
                  Click a section in the left rail to add it here.
                </p>
              </div>
            )}

            <SharedSlot
              slot="footer"
              template={footerTemplate}
              siteId={siteId}
              overrides={composition.shared?.footer_overrides ?? {}}
              selected={selectedSectionId === "shared:footer"}
              onSelect={() =>
                setSelectedSectionId((prev) =>
                  prev === "shared:footer" ? null : "shared:footer",
                )
              }
              onContentChange={(key, value) =>
                updateSharedContent("footer", key, value)
              }
              onItemFieldChange={(repeaterKey, idx, fk, v) =>
                updateSharedItemField("footer", repeaterKey, idx, fk, v)
              }
              hiddenFields={composition.shared?.footer_hidden_fields ?? []}
              onFieldHiddenChange={(rawKey, hidden) =>
                updateSharedFieldHidden("footer", rawKey, hidden)
              }
              onRemove={() => removeShared("footer")}
              // Brand passed (without onBrandChange) so the footer's
              // FieldsList runs the brand-contact fall-back layer for
              // phone/email/address fields. SharedSlot only renders the
              // BrandSection edit card when BOTH brand AND onBrandChange
              // are present (nav-only by design — see slot==="nav" gate
              // in SharedSlot), so the footer won't sprout a duplicate
              // logo editor. Without this, the bug Peter reported
              // 2026-05-15: footer phone/email shows template defaults
              // instead of brand values, while nav shows brand correctly.
              brand={composition.brand}
              mode={mode}
            />
          </div>
          )}
        </div>
      </div>
    </div>

    {/* AI Generate modal — controlled by `aiModalOpen`. Lives outside
        the 3-column layout so it overlays everything (the Dialog
        portal handles z-index). Generated overrides flow back through
        applyAiOverrides → updateSectionContent → SK_PATCH_FIELD per
        field, so the iframe updates live as each section is filled. */}
    {!isClientMode && (
      <AiGenerateModal
        open={aiModalOpen}
        onOpenChange={setAiModalOpen}
        siteId={siteId}
        onGenerate={applyAiOverrides}
      />
    )}

    {/* JSON round-trip modal — twin of AiGenerateModal but free
        (uses chatgpt.com instead of paid API). Wires to
        applyJsonImport (NOT applyAiOverrides) because the JSON path
        needs per-item repeater updates to trigger the live nav-
        dropdown linkage — replacing a whole repeater array bypasses
        the linkage code that mirrors service-title changes into the
        navbar's Services dropdown rows. */}
    {!isClientMode && (
      <JsonRoundtripModal
        open={jsonModalOpen}
        onOpenChange={setJsonModalOpen}
        composition={composition}
        templates={jsonRoundtripTemplateMap}
        brandCompanyName={composition.brand?.company_text ?? ""}
        siteId={siteId}
        onApply={(overrides) => applyJsonImport(overrides as AiOverrides)}
        targetPagePath={activePagePath}
        pageContext={jsonPageContext ?? undefined}
      />
    )}

    {/* Translate-mode round-trip modal — opened per locale from the
        Languages tab. Same export/validate machinery as the fill modal,
        but the prompt translates into the target language and the import
        is stored on composition.i18n.translations[locale] instead of the
        base composition (so the default-language content is untouched). */}
    {!isClientMode && translateLocale && (
      <JsonRoundtripModal
        open={translateLocale !== null}
        onOpenChange={(open) => {
          if (!open) setTranslateLocale(null);
        }}
        composition={composition}
        templates={jsonRoundtripTemplateMap}
        brandCompanyName={composition.brand?.company_text ?? ""}
        siteId={siteId}
        mode="translate"
        targetLocaleLabel={LOCALE_LABELS[translateLocale]}
        sourceLocaleLabel={
          LOCALE_LABELS[composition.i18n?.default_locale ?? "sk"]
        }
        onApply={(snapshot) => {
          applyTranslationImport(translateLocale, snapshot);
          setTranslateLocale(null);
        }}
      />
    )}
    </AnchorsProvider>
    </SiteUrlContext.Provider>
    </UploadTrackerContext.Provider>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Saving...
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
        <CheckCircle2 className="h-3 w-3" />
        Saved
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <AlertCircle className="h-3 w-3" />
        Save failed
      </span>
    );
  }
  return null;
}


// Card for the nav/footer slots. Card-level collapse + auto-expand on selection.
function SharedSlot({
  slot,
  template,
  siteId,
  overrides,
  selected,
  onSelect,
  onContentChange,
  onItemFieldChange,
  hiddenFields,
  onFieldHiddenChange,
  onRemove,
  brand,
  themePrimary,
  onBrandChange,
  onPreviewBrandLogo,
  mode = "tech",
}: {
  slot: "nav" | "footer";
  template: SectionTemplate | undefined;
  siteId: string;
  overrides: Record<string, FieldValue>;
  selected?: boolean;
  onSelect: () => void;
  onContentChange: (key: string, value: FieldValue) => void;
  /** In-place patch hook for repeater item fields — the composer wires
   *  this to send SK_PATCH_REPEATER_ITEM messages so typing into a nav
   *  link label doesn't bump publishVersion (which would re-render the
   *  whole iframe and flicker). */
  onItemFieldChange?: (
    repeaterKey: string,
    itemIndex: number,
    itemFieldKey: string,
    value: FieldValue,
  ) => void;
  /** Currently-hidden field keys for THIS slot. Read from
   *  `composition.shared.{nav,footer}_hidden_fields`. Forwarded to
   *  FieldsList so each field's HideToggle reflects the right state
   *  and `:hidden` styling applies (opacity dim, "hidden" badge). */
  hiddenFields?: string[];
  /** Toggle hide on a slot-level field (e.g. nav_facebook). */
  onFieldHiddenChange?: (rawKey: string, hidden: boolean) => void;
  onRemove: () => void;
  /** Brand identity (logo + favicon). Only meaningful for slot="nav" —
   *  the nav slot exposes the brand-mark control above its fields so
   *  users edit the logo where they think of it (next to the navbar UI).
   *  Footer doesn't render this even if passed; the brand is single-source
   *  on composition.brand and shared between nav + footer logos. */
  brand?: SiteBrand;
  /** Current theme primary color — feeds the auto-generated logo's icon
   *  fill so the inline preview tracks the Theme panel's primary picker
   *  in real time. */
  themePrimary?: string;
  /** Apply a partial patch to composition.brand. */
  onBrandChange?: (patch: Partial<SiteBrand>) => void;
  /** Optimistic logo paint — fired with a local blob: URL when a file
   *  is picked. Composer wires it to a SK_PATCH_BRAND postMessage so
   *  the iframe shows the new logo instantly while the Supabase upload
   *  runs in the background. */
  onPreviewBrandLogo?: (logoUrl: string) => void;
  /** "client" hides the empty-slot pick CTA (which references the section
   *  rail clients can't see). Edit + remove on a populated slot still work
   *  for clients. */
  mode?: ComposerMode;
}) {
  const isClientMode = mode === "client";
  const cardRef = useRef<HTMLDivElement>(null);
  // Expansion is driven by selection — only one card open at a time.
  const expanded = !!selected;

  useEffect(() => {
    if (selected) {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selected]);

  if (!template) {
    // Empty-slot CTA references the sections rail on the left, which is
    // hidden for clients (Peter 2026-05-08). Render nothing for clients
    // rather than telling them about a UI they can't see.
    if (isClientMode) return null;
    return (
      <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-3 text-xs text-muted-foreground flex items-center gap-2">
        <Plus className="h-3 w-3" />
        Pick a {slot} from the sections panel on the left
      </div>
    );
  }

  const rawSchema = template.placeholder_schema as Record<string, FieldSchema>;
  // Hide the standalone `nav_logo` / `footer_logo` field from the field
  // list — the BrandSection card above this list owns logo uploads now,
  // so showing the same image picker twice (one in BrandSection, one in
  // the field list) is just confusing UX. The conventional field name
  // is also how SK_PATCH_BRAND finds the <img> in the iframe, so we
  // can't simply rename it; just hide it here. Users with a non-standard
  // template that doesn't use `nav_logo` are unaffected.
  const hiddenLogoKey = slot === "nav" ? "nav_logo" : "footer_logo";
  const schema = Object.fromEntries(
    Object.entries(rawSchema).filter(([k]) => k !== hiddenLogoKey),
  ) as Record<string, FieldSchema>;
  const fieldKeys = Object.keys(schema);

  return (
    <div
      ref={cardRef}
      className={`rounded-lg border bg-card overflow-hidden transition-all ${
        selected
          ? "border-primary ring-2 ring-primary/30 shadow-md"
          : "hover:border-primary/40"
      }`}
    >
      {/* Header: click toggles open/closed via selection. Only the X stops propagation. */}
      <div
        onClick={onSelect}
        className={`flex items-center gap-2 px-3 py-2 border-b transition-colors cursor-pointer ${
          selected
            ? "bg-primary/10"
            : "bg-muted/40 hover:bg-muted/60"
        }`}
      >
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <span
          className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 font-semibold ${
            selected ? "bg-primary text-primary-foreground" : "bg-foreground/10"
          }`}
        >
          {slot}
        </span>
        <span className="text-sm font-medium">{template.name}</span>
        <span className="text-[10px] text-muted-foreground">
          {fieldKeys.length} field{fieldKeys.length === 1 ? "" : "s"}
        </span>
        {/* Remove (X) — hidden in client mode (Peter 2026-05-08). Without
            the SectionsRail (also hidden), removing the nav/footer would
            be a one-way trap for clients. Tech keeps the button. */}
        {!isClientMode && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Remove the ${slot}?`)) onRemove();
            }}
            title="Remove"
            className="ml-auto p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Brand mark + fields — both stop propagation so typing/clicking
          inside doesn't re-trigger onSelect on the card header.
          ── Panel animation ── Same grid-rows + bounce easing as
          SectionCard so the nav / footer panels feel identical to the
          page sections. See section-card.tsx for the rationale. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`grid transition-[grid-template-rows,opacity] duration-300 ${
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
        style={{
          transitionTimingFunction: expanded
            ? "cubic-bezier(0.34, 1.56, 0.64, 1)"
            : "cubic-bezier(0.4, 0, 0.2, 1)",
        }}
        aria-hidden={!expanded}
      >
        <div className="overflow-hidden">
          <div className="px-3 py-3 space-y-3">
            {/* Nav slot exclusive: logo upload + company-text editor.
                Renders above the field list because the brand mark is what
                users see first in a navbar — easier to find here than
                hidden under "Theme". Footer slot intentionally doesn't
                get this card; the same brand flows through both via
                composition.brand. */}
            {slot === "nav" && brand && onBrandChange && (
              <BrandSection
                brand={brand}
                primaryColor={themePrimary || "#142733"}
                siteId={siteId}
                onChange={onBrandChange}
                onOptimisticLogo={onPreviewBrandLogo}
              />
            )}

            {/* Footer slot exclusive: dedicated logo upload card,
                visually mirroring BrandSection but for the footer's
                optional override. Renders above the field list so the
                user finds it where they think of "the footer logo" —
                same place pattern as BrandSection above the navbar
                fields. The corresponding `footer_logo` field is
                hidden from FieldsList below via excludeKeys to avoid
                two editors competing for the same value. */}
            {slot === "footer" && brand && (
              <FooterLogoCard
                brand={brand}
                primaryColor={themePrimary || "#142733"}
                customFooterLogoUrl={
                  typeof overrides.footer_logo === "string"
                    ? overrides.footer_logo
                    : undefined
                }
                siteId={siteId}
                onChange={(logoUrl) => onContentChange("footer_logo", logoUrl)}
              />
            )}

            {fieldKeys.length === 0 ? (
              <p className="py-4 text-xs text-muted-foreground text-center">
                This template has no editable fields.
              </p>
            ) : (
              <FieldsList
                category={template.category}
                schema={schema}
                overrides={overrides}
                siteId={siteId}
                onChange={onContentChange}
                onItemFieldChange={onItemFieldChange}
                hiddenFields={hiddenFields}
                onFieldHiddenChange={onFieldHiddenChange}
                brand={brand}
                // Footer's `footer_logo` is owned by the FooterLogoCard
                // rendered above this list — hide the duplicate inline
                // image-field editor that would otherwise show up in
                // the field list. Nav's `nav_logo` is hidden similarly
                // by virtue of BrandSection being the only logo control
                // for the nav slot.
                excludeKeys={
                  slot === "footer"
                    ? ["footer_logo"]
                    : slot === "nav"
                      ? ["nav_logo"]
                      : undefined
                }
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Right-panel tab button — Composition / SEO. Active tab gets a primary
// underline; inactive ones are muted but still clearly clickable.
function TabButton({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-3 py-2 text-left transition-colors border-b-2 ${
        active
          ? "border-primary bg-card"
          : "border-transparent bg-muted/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground"
      }`}
    >
      <p
        className={`text-xs font-semibold uppercase tracking-wide ${
          active ? "text-foreground" : ""
        }`}
      >
        {label}
      </p>
      {hint && (
        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
          {hint}
        </p>
      )}
    </button>
  );
}

// Whether composition.seo has any non-default content. Used for the SEO
// tab's hint badge to nudge the user that there's nothing set yet.
function hasSeoContent(seo: SiteSeo | undefined): boolean {
  if (!seo) return false;
  return !!(
    (seo.title ?? "").trim() ||
    (seo.description ?? "").trim() ||
    seo.og_image_url ||
    seo.favicon_url
  );
}

// Deep-clone a composition while replacing every string value that's a key
// in `subs` with its mapped replacement. Used after a successful publish to
// patch in `pending:` -> `/_uploads/...` URLs without a roundtrip to the DB.
function substituteCompositionUrls<T>(value: T, subs: Record<string, string>): T {
  if (typeof value === "string") {
    return (subs[value] ?? value) as T;
  }
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => substituteCompositionUrls(v, subs)) as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = substituteCompositionUrls(v, subs);
  }
  return out as T;
}
