"use client";

/**
 * SEO panel for the composer.
 *
 * Mirrors the ThemePanel pattern — collapsible card that lives inside the
 * right-side composition panel. Edits autosave to composition.seo via the
 * standard scheduleSave + sendIframePatch flow (same as ThemePanel).
 *
 * Includes two live previews:
 *   - Google search result mockup (Title + URL + Description)
 *   - Social share card mockup (OG image + title + description)
 *
 * For the IT guy now. Client-zone version comes later as part of the
 * planned client-side overhaul — keeping them separate so we don't mix.
 */

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Loader2, X, Image as ImageIcon, Info } from "lucide-react";
import { toast } from "sonner";
import type { SiteSeo, PageSeo } from "@/lib/templates/seo";
import type { SiteBrand } from "@/lib/composer/brand";
import {
  putPendingImage,
  useDisplayUrl,
} from "@/lib/composer/image-store";

const TITLE_MAX = 60;
const DESCRIPTION_MAX = 160;
// Local-state typing buffer flushes to the parent after this many ms of
// idle keypresses. The composer's whole render tree (theme tokens, save
// scheduler, all the memos) re-runs on every parent state change, so
// keeping rapid keystrokes local makes typing feel instant.
const TYPING_DEBOUNCE_MS = 300;

interface Props {
  /** Current SEO block from composition.seo. */
  seo: SiteSeo | undefined;
  /** Site name — used as the title fallback in previews. */
  siteName: string;
  /** Live published URL — used in the Google preview. Optional (preview shows
   *  a placeholder if absent). */
  siteUrl?: string;
  /** Site id — used by image upload for the storage path. */
  siteId: string;
  /** Apply a partial patch to composition.seo. Multi-field updates land
   *  atomically in one composition mutation — image upload uses this to
   *  set og_image_url + og_image_width + og_image_height in a single edit
   *  so the published <head> can emit `og:image:width/height` and avoid
   *  blurry share-card thumbnails. The composer wires this to its rAF-
   *  throttled composition update + iframe patch (same path as theme). */
  onChange: (patch: Partial<SiteSeo>) => void;
  /** Brand record from `composition.brand`. Optional — when present,
   *  the LocalBusiness JSON-LD indicator at the bottom of the panel
   *  reports its eligibility (active when name + at least one of
   *  phone/email/address is set, otherwise hint to fill the Brand
   *  panel). The contact bits (phone/email/address/company_text)
   *  remain edited in the Brand panel; the SEO-only enrichment
   *  fields (opening_hours, business_type, social_*) are edited
   *  inside the Local business section here. */
  brand?: SiteBrand;
  /** Optional callback to patch composition.brand. When provided, the
   *  Local business section becomes editable for the three enrichment
   *  fields (opening hours, business type, social URLs). When omitted,
   *  the section stays read-only — useful for surfaces that don't
   *  want brand-edit affordances (none today, but kept optional for
   *  future client-mode parity). */
  onBrandChange?: (patch: Partial<SiteBrand>) => void;
  /** Label of the page currently being edited (e.g. "About us"). Shown in
   *  the per-page header so the user knows whose SEO they're editing. */
  pageLabel?: string;
  /** True when the active page is the home page. On home, the
   *  title/description/share-image/visibility fields edit the SITE-level
   *  SEO (home IS the site default). On a subpage they edit that page's
   *  overrides via onPageSeoChange. Defaults to true so legacy/single-page
   *  callers keep the old site-level behavior. */
  isHomePage?: boolean;
  /** The active page's SEO overrides (when on a subpage). */
  pageSeo?: PageSeo;
  /** Patch the active page's SEO overrides. Wired only on subpages. */
  onPageSeoChange?: (patch: Partial<PageSeo>) => void;
}

export function SeoPanel({
  seo,
  siteName,
  siteUrl,
  siteId,
  onChange,
  brand,
  onBrandChange,
  pageLabel,
  isHomePage = true,
  pageSeo,
  onPageSeoChange,
}: Props) {
  // ── Per-page vs site-level routing ──
  // On a SUBPAGE, the page-specific fields (title, description, share
  // image, search visibility) edit that page's overrides; the inherited
  // site values show as placeholders. On HOME they edit the site-level
  // SEO directly (home is the site default). Favicon + the Google-tools
  // section + LocalBusiness stay SITE-WIDE on every page.
  const editingPage = !isHomePage && !!onPageSeoChange;
  const pageable: PageSeo | SiteSeo = editingPage ? (pageSeo ?? {}) : (seo ?? {});
  // Unified patch fn for the page-specific fields. PageSeo's keys are a
  // subset of SiteSeo, so a Partial<PageSeo> is always a valid SiteSeo
  // patch when we fall back to the site-level onChange on home.
  const applyPageable = editingPage
    ? onPageSeoChange!
    : (patch: Partial<PageSeo>) => onChange(patch as Partial<SiteSeo>);
  // Inherited site-level values — shown as placeholders/hints on subpages
  // so the user sees what they'd get if they leave a field blank.
  const inheritedTitle = (seo?.title ?? "").trim();
  const inheritedDescription = (seo?.description ?? "").trim();
  // Title + description live in a local typing buffer so rapid keystrokes
  // don't churn the parent composer's state on every char (which would re-
  // run all of its memos + flash the save indicator). Image fields stay
  // direct since they fire one event each (file picked / cleared).
  const [title, setTitle, flushTitle] = useTypingBuffer(pageable.title ?? "", (v) =>
    applyPageable({ title: v || undefined }),
  );
  const [description, setDescription, flushDescription] = useTypingBuffer(
    pageable.description ?? "",
    (v) => applyPageable({ description: v || undefined }),
  );
  const ogImage = pageable.og_image_url ?? "";
  // Favicon is ALWAYS site-wide (one tab icon for the whole site).
  const favicon = seo?.favicon_url ?? "";
  // Toggle reads as "visible" — the inverse of the underlying no_index flag
  // so the on-state matches the common-case default (yes, index this page).
  // Stored as `no_index: true` (hidden) or absent (visible). We never store
  // `no_index: false` — it's the same as "absent" and just bloats the JSON.
  const visibleInSearch = !pageable.no_index;

  // Effective values used for previews — mimic the renderer's fallbacks
  // so the mockups match what'll actually go live. Read from the local
  // buffer so the previews update instantly (the parent doesn't yet know).
  const previewTitle =
    title.trim() || (editingPage ? inheritedTitle || siteName : siteName);
  const previewDescription =
    description.trim() ||
    (editingPage && inheritedDescription
      ? inheritedDescription
      : "Add a description for search engines and social media.");
  const previewUrl = siteUrl?.replace(/^https?:\/\//, "") || "your-domain.com";

  return (
    <div className="space-y-4">
          {/* ── Per-page header ──
              On a subpage, make it explicit that these fields override
              the home page's SEO and that empty fields inherit it. Favicon
              + the Google-tools section stay site-wide regardless. */}
          {editingPage && (
            <div className="rounded-md border border-primary/30 bg-primary/5 px-2.5 py-2">
              <p className="text-[11px] font-medium leading-tight">
                Editing SEO for: {pageLabel || "this page"}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">
                Empty fields inherit the home page&apos;s SEO. Favicon and
                Google tools are shared across the whole site.
              </p>
            </div>
          )}

          {/* ── Google search result preview ── */}
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-semibold mb-1.5">
              Google preview
            </p>
            <div className="rounded-md border border-border bg-background px-3 py-2">
              <p className="text-[10px] text-muted-foreground truncate">
                {previewUrl}
              </p>
              <p className="text-[14px] text-blue-600 dark:text-blue-400 leading-tight truncate">
                {previewTitle}
              </p>
              <p className="text-[11px] text-muted-foreground line-clamp-2 leading-snug mt-0.5">
                {previewDescription}
              </p>
            </div>
          </div>

          {/* ── Title input ── */}
          <FieldGroup label="Title" hint="What people see in browser tab + Google results">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={flushTitle}
              placeholder={editingPage ? inheritedTitle || siteName : siteName}
              maxLength={TITLE_MAX + 30}
              className="w-full px-2.5 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <CharBar value={title.length} max={TITLE_MAX} />
          </FieldGroup>

          {/* ── Description input ── */}
          <FieldGroup label="Description" hint="The snippet shown under the title in search results">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={flushDescription}
              placeholder="A short description of your site for Google and social media (~150 characters)…"
              rows={3}
              maxLength={DESCRIPTION_MAX + 60}
              className="w-full px-2.5 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-y"
            />
            <CharBar value={description.length} max={DESCRIPTION_MAX} />
          </FieldGroup>

          {/* ── Social preview + upload (merged) ──
              The preview box IS the upload trigger:
                - Empty: click anywhere on the preview to pick a file
                - Filled: preview shows the image; hover reveals Replace + Remove */}
          <div>
            <div className="flex items-end justify-between mb-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-semibold">
                Social share preview
              </p>
              <p className="text-[10px] text-muted-foreground/70">
                1200 × 630 recommended
              </p>
            </div>
            <div className="rounded-md border border-border overflow-hidden bg-background">
              <SocialImageUpload
                value={ogImage}
                siteId={siteId}
                onChange={(url, dims) =>
                  applyPageable({
                    og_image_url: url || undefined,
                    // Store width + height alongside the URL so buildHeadMeta
                    // can emit og:image:width/height. Without these, FB and
                    // LinkedIn often downscale the share card to a small
                    // crop (= the blurry preview Peter reported). Cleared
                    // when the user removes the image. Routes per-page on a
                    // subpage, site-level on home.
                    og_image_width: dims?.width ?? undefined,
                    og_image_height: dims?.height ?? undefined,
                  })
                }
              />
              <div className="px-3 py-2 border-t bg-muted/30">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">
                  {previewUrl}
                </p>
                <p className="text-[12px] font-medium leading-tight mt-0.5 truncate">
                  {previewTitle}
                </p>
                <p className="text-[10px] text-muted-foreground line-clamp-1 leading-snug">
                  {previewDescription}
                </p>
              </div>
            </div>
          </div>

          {/* ── Favicon upload ── */}
          <ImageUploadField
            label="Favicon"
            hint="Tab icon shown in browsers. Square image (e.g. 256×256). PNG works."
            value={favicon}
            siteId={siteId}
            onChange={(url) => onChange({ favicon_url: url || undefined })}
            uploadPathPrefix="seo/favicon"
          />

          {/* ── Advanced section ──
              Per Peter (2026-05-14): the three Google integrations
              (GA4, GSC, LocalBusiness) are useful but overwhelming
              for first-time users — and irrelevant for clients who
              don't use Google's marketing tools. Collapse them under
              one disclosure, defaulted closed. Visibility toggle
              stays OUTSIDE this group at the very bottom because
              everyone needs to think about indexing eventually. */}
          <AdvancedSection
            seo={seo}
            brand={brand}
            onChange={onChange}
            onBrandChange={onBrandChange}
          />

          {/* ── Search engine visibility toggle ──
              Controls composition.seo.no_index. When OFF, buildHeadMeta
              emits <meta name="robots" content="noindex,nofollow"> which
              tells Google + Bing + Seznam etc. to skip the site. Use for
              staging/unfinished sites. Stored as no_index=true when OFF
              and absent when ON (we never store the explicit false). */}
          <SearchVisibilityToggle
            visible={visibleInSearch}
            isPage={editingPage}
            pageLabel={pageLabel}
            onToggle={() =>
              applyPageable({
                // ON → OFF: explicitly mark no_index=true.
                // OFF → ON: clear the field (undefined gets dropped by the
                // empty-cleanup, keeping composition lean). Routes per-page
                // on a subpage (hide just this page), site-level on home.
                no_index: visibleInSearch ? true : undefined,
              })
            }
          />
    </div>
  );
}

/**
 * Collapsible disclosure that hides the three Google-integration
 * fields (GA4, GSC verification, LocalBusiness indicator) behind one
 * click. Closed by default — first-time users see a clean SEO panel
 * and only encounter these settings when they go looking. The trigger
 * line says what's inside in plain language so users know whether to
 * expand or skip.
 *
 * State is purely local — opening/closing isn't persisted across
 * mounts. That's intentional: the closed state is the "I don't
 * use this" signal, and we want first-mount-after-revisit to also
 * show the cleaner closed view.
 */
function AdvancedSection({
  seo,
  brand,
  onChange,
  onBrandChange,
}: {
  seo: SiteSeo | undefined;
  brand?: SiteBrand;
  onChange: (patch: Partial<SiteSeo>) => void;
  onBrandChange?: (patch: Partial<SiteBrand>) => void;
}) {
  const [open, setOpen] = useState(false);
  // Show a tiny "set" badge on the trigger when at least one of the
  // three is configured — reassures the tech-admin that something
  // IS persisted even though the panel is closed.
  const hasSomething =
    !!seo?.ga4_measurement_id?.trim() ||
    !!seo?.google_site_verification?.trim() ||
    !!(brand?.company_text?.trim() &&
      (brand?.phone?.trim() ||
        brand?.email?.trim() ||
        brand?.address?.trim()));

  return (
    <div className="rounded-md border border-input">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-muted/40 transition-colors rounded-md"
        aria-expanded={open}
      >
        <ChevronRight
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0 ${
            open ? "rotate-90" : ""
          }`}
        />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium leading-tight">
            Google tools
            {hasSomething && (
              <span className="ml-1.5 text-[9px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400 font-semibold">
                active
              </span>
            )}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">
            Traffic tracking, indexing, local results. Optional.
          </p>
        </div>
      </button>
      {open && (
        // Each integration gets its own padded block separated from
        // the next by a thin divider line. Tighter visual grouping
        // than the previous single space-y-3 stack — reads as three
        // distinct subsections inside one panel rather than three
        // floating cards. Per Peter (2026-05-14): "not so scattered".
        <div className="border-t bg-muted/20">
          <div className="px-2.5 py-3">
            <Ga4Field
              value={seo?.ga4_measurement_id ?? ""}
              onChange={(v) =>
                onChange({ ga4_measurement_id: v || undefined })
              }
            />
          </div>
          <div className="px-2.5 py-3 border-t border-border/60">
            <GscField
              value={seo?.google_site_verification ?? ""}
              onChange={(v) =>
                onChange({ google_site_verification: v || undefined })
              }
            />
          </div>
          <div className="px-2.5 py-3 border-t border-border/60">
            <LocalBusinessIndicator
              brand={brand}
              onBrandChange={onBrandChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Single text input for the Google Search Console verification token.
 * Same UI pattern as Ga4Field — local typing buffer, validates format
 * on every keystroke (visual only, never blocks input), shows an
 * amber publish-required callout when valid so the tech-admin knows
 * a re-publish is needed before Google's verifier will see the tag.
 */
function GscField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [local, setLocal, flush] = useTypingBuffer(value, onChange);
  const trimmed = local.trim();
  // Same regex as buildHeadMeta's isValidGscToken — kept in sync to
  // give the user the same yes/no answer the renderer will give.
  const isValid = /^[A-Za-z0-9_-]{16,128}$/.test(trimmed);
  const showWarning = trimmed.length > 0 && !isValid;

  return (
    <div>
      <label className="block text-xs font-medium mb-1">
        Google Search Console
      </label>
      <p className="text-[10px] text-muted-foreground mb-1.5 leading-snug">
        Helps Google find and index the site faster (days instead of weeks).
        If you don&apos;t use Search Console, leave this empty.
      </p>
      <input
        type="text"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={flush}
        placeholder="e.g. abc123XYZ_..."
        spellCheck={false}
        className={`w-full px-2 py-1.5 text-xs font-mono rounded border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 ${
          showWarning
            ? "border-amber-500/60 focus:ring-amber-500/40"
            : isValid
              ? "border-emerald-500/40"
              : "border-input"
        }`}
      />
      {showWarning && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 leading-snug">
          The code must be 16 to 128 characters (letters, numbers, <code className="font-mono">-</code> or <code className="font-mono">_</code>).
        </p>
      )}
      {isValid && (
        // Same two-part confirmation as Ga4Field — saved indicator
        // plus prominent publish callout so the tech-admin knows the
        // verification meta tag only appears after a publish.
        <div className="mt-1.5 space-y-2">
          <p className="text-[10px] text-emerald-600 dark:text-emerald-400 leading-snug">
            ✓ Saved to the database.
          </p>
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-[11px] leading-snug text-amber-900 dark:text-amber-100">
              <p className="font-semibold mb-0.5">
                Publish the site for the change to take effect
              </p>
              <p className="text-amber-800/90 dark:text-amber-200/90">
                The verification tag is added only on published sites.
                Once published, go back to Search Console and click
                &quot;Verify&quot;.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Read-only status card for the auto-generated LocalBusiness JSON-LD
 * block. Mirrors `buildLocalBusinessJsonLd`'s eligibility rule
 * (name + at least one of phone/email/address) so what the tech-admin
 * sees here matches what the renderer actually emits.
 *
 * Two states:
 *   - Active: green check + summary of what'll go to Google
 *   - Inactive: muted info box explaining what's missing in Brand panel
 *
 * No edit affordance — this is informational only. The fields live
 * in the Brand panel; we point users there when they need to fix it.
 */
function LocalBusinessIndicator({
  brand,
  onBrandChange,
}: {
  brand?: SiteBrand;
  onBrandChange?: (patch: Partial<SiteBrand>) => void;
}) {
  const name = brand?.company_text?.trim() ?? "";
  const phone = brand?.phone?.trim() ?? "";
  const email = brand?.email?.trim() ?? "";
  const address = brand?.address?.trim() ?? "";
  const hours = brand?.opening_hours?.trim() ?? "";
  const businessType = brand?.business_type?.trim() ?? "";
  const facebook = brand?.social_facebook?.trim() ?? "";
  const instagram = brand?.social_instagram?.trim() ?? "";
  const businessTypeCustom = brand?.business_type_custom?.trim() ?? "";
  const hasName = name.length > 0;
  const hasContact = phone.length > 0 || email.length > 0 || address.length > 0;
  const isActive = hasName && hasContact;
  // Resolve a human-readable label for the active-state summary.
  // When the user picked "Custom" + typed something, the custom text
  // wins so the summary shows what they actually wrote (rather than
  // the generic "Other — name it yourself" dropdown label).
  const businessTypeLabel =
    businessType === "Custom" && businessTypeCustom
      ? businessTypeCustom
      : labelForBusinessType(businessType);

  return (
    <div>
      <label className="block text-xs font-medium mb-1">
        Local business on Google
      </label>
      <p className="text-[10px] text-muted-foreground mb-1.5 leading-snug">
        Helps Google show the business as local (info panel on the right when
        searching the business name, &quot;near me&quot; results).
        Fills in automatically from the Brand panel &mdash; nothing to type here.
      </p>
      {isActive ? (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-2">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-[11px] leading-snug">
              <p className="font-semibold text-emerald-900 dark:text-emerald-100 mb-0.5">
                Ready
              </p>
              <p className="text-emerald-800/90 dark:text-emerald-200/90">
                On publish, Google will receive:
              </p>
              <ul className="text-emerald-800/90 dark:text-emerald-200/90 mt-1 space-y-0.5">
                <li>
                  <span className="opacity-70">Name:</span>{" "}
                  <span className="font-medium">{name}</span>
                </li>
                {phone && (
                  <li>
                    <span className="opacity-70">Phone:</span>{" "}
                    <span className="font-medium">{phone}</span>
                  </li>
                )}
                {email && (
                  <li>
                    <span className="opacity-70">Email:</span>{" "}
                    <span className="font-medium">{email}</span>
                  </li>
                )}
                {address && (
                  <li>
                    <span className="opacity-70">Address:</span>{" "}
                    <span className="font-medium">{address}</span>
                  </li>
                )}
                {businessTypeLabel && (
                  <li>
                    <span className="opacity-70">Type:</span>{" "}
                    <span className="font-medium">{businessTypeLabel}</span>
                  </li>
                )}
                {hours && (
                  <li>
                    <span className="opacity-70">Hours:</span>{" "}
                    <span className="font-medium">{hours}</span>
                  </li>
                )}
                {(facebook || instagram) && (
                  <li>
                    <span className="opacity-70">Social media:</span>{" "}
                    <span className="font-medium">
                      {[facebook && "Facebook", instagram && "Instagram"]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-input bg-muted/30 px-2.5 py-2">
          <div className="flex items-start gap-2">
            <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
            <div className="text-[11px] leading-snug text-muted-foreground">
              <p className="font-medium mb-0.5 text-foreground">
                Not active yet
              </p>
              <p>
                {!hasName
                  ? "Add the business name in the Brand panel."
                  : "Add at least one contact detail (phone, email or address) in the Brand panel."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Enrichment fields ──
          Three optional fields that only matter for LocalBusiness
          JSON-LD — opening hours (Google's info card highlights them),
          business type (correct categorization in local searches),
          and social URLs (links the website to other online presences
          via schema.org `sameAs`). Edit affordance only renders when
          onBrandChange is provided so read-only callers stay clean.
          Showing them ALWAYS (regardless of isActive state) so the
          user can fill them while building the brand info — they
          take effect once the active gate flips. */}
      {onBrandChange && (
        <div className="mt-3 space-y-3">
          <BrandTextField
            label="Opening hours"
            hint="Optional. Example: Mon-Fri 8:00-17:00, Sat 9:00-12:00. Google shows them in the info panel."
            value={hours}
            placeholder="Mon-Fri 8:00-17:00"
            onChange={(v) => onBrandChange({ opening_hours: v || undefined })}
          />
          <div className="space-y-1.5">
            <BusinessTypeSelect
              value={businessType}
              onChange={(v) =>
                onBrandChange({
                  business_type: v || undefined,
                  // Clear the custom text whenever the user picks a
                  // non-Custom option — keeps the data tidy and
                  // prevents stale custom text from leaking into the
                  // schema if they switch back to Custom later.
                  ...(v !== "Custom"
                    ? { business_type_custom: undefined }
                    : {}),
                })
              }
            />
            {businessType === "Custom" && (
              <BrandTextField
                label="Name your business type"
                hint="Short description (1-2 words), for example: Garden Center, Photographer, Cleaning Company. Added to Google as a description."
                value={businessTypeCustom}
                placeholder="e.g. Gardening services"
                onChange={(v) =>
                  onBrandChange({ business_type_custom: v || undefined })
                }
              />
            )}
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              Social media
            </label>
            <p className="text-[10px] text-muted-foreground mb-1.5 leading-snug">
              Optional. Helps Google link the site to your social
              profiles. Paste the full URL.
            </p>
            <div className="space-y-1.5">
              <BrandUrlField
                label="Facebook"
                value={facebook}
                placeholder="https://www.facebook.com/yourcompany"
                onChange={(v) =>
                  onBrandChange({ social_facebook: v || undefined })
                }
              />
              <BrandUrlField
                label="Instagram"
                value={instagram}
                placeholder="https://www.instagram.com/yourcompany"
                onChange={(v) =>
                  onBrandChange({ social_instagram: v || undefined })
                }
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Small input components for the LocalBusiness enrichment fields.
   All use the local typing buffer pattern (same as Ga4Field) so
   keystrokes don't churn the parent composer state.
   ───────────────────────────────────────────────────────────── */

function BrandTextField({
  label,
  hint,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  const [local, setLocal, flush] = useTypingBuffer(value, onChange);
  return (
    <div>
      <label className="block text-xs font-medium mb-1">{label}</label>
      {hint && (
        <p className="text-[10px] text-muted-foreground mb-1.5 leading-snug">
          {hint}
        </p>
      )}
      <input
        type="text"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={flush}
        placeholder={placeholder}
        spellCheck={false}
        className="w-full px-2 py-1.5 text-xs rounded border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
    </div>
  );
}

/**
 * URL field with light-touch validation — flips the border amber
 * when the value is non-empty AND doesn't start with http(s)://.
 * Doesn't block typing; the renderer also re-checks before emitting
 * into JSON-LD `sameAs` so half-typed values can't reach Google.
 */
function BrandUrlField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  const [local, setLocal, flush] = useTypingBuffer(value, onChange);
  const trimmed = local.trim();
  const looksValid = !trimmed || /^https?:\/\//i.test(trimmed);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-16 shrink-0">
        {label}
      </span>
      <input
        type="url"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={flush}
        placeholder={placeholder}
        spellCheck={false}
        className={`flex-1 min-w-0 px-2 py-1.5 text-[11px] rounded border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 ${
          looksValid ? "border-input" : "border-amber-500/60"
        }`}
      />
    </div>
  );
}

/**
 * Dropdown for the business category. Each option's `value` MUST
 * match a key in KNOWN_SCHEMA_TYPES inside local-business.ts so the
 * renderer honors the choice — adding a new option here without
 * adding it there silently falls back to generic LocalBusiness.
 *
 * English labels for tech-admin readability; schema.org type names
 * stored as the value (English, since they're a Google contract).
 */
function BusinessTypeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1">Business type</label>
      <p className="text-[10px] text-muted-foreground mb-1.5 leading-snug">
        Optional. Helps Google place the business in the right category.
      </p>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1.5 text-xs rounded border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        <option value="">— Not selected (Other local business) —</option>
        {BUSINESS_TYPE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * English-labeled dropdown options. Values map 1:1 to schema.org
 * LocalBusiness subtypes — kept in sync with `KNOWN_SCHEMA_TYPES`
 * in `local-business.ts`. Order roughly by frequency among
 * SMB clients (trades + services first, niche stuff last).
 */
const BUSINESS_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  // Trades + construction
  { value: "Plumber", label: "Plumber" },
  { value: "Electrician", label: "Electrician" },
  { value: "HousePainter", label: "Painter" },
  { value: "Locksmith", label: "Locksmith" },
  { value: "HVACBusiness", label: "Heating / Air conditioning" },
  { value: "RoofingContractor", label: "Roofer / Roofing" },
  { value: "GeneralContractor", label: "Construction company (general)" },
  { value: "HomeAndConstructionBusiness", label: "Construction & home" },
  { value: "MovingCompany", label: "Moving company" },
  // Auto
  { value: "AutoRepair", label: "Auto repair" },
  { value: "AutoBodyShop", label: "Auto body shop" },
  { value: "AutoDealer", label: "Car dealer / Car sales" },
  // Beauty + health
  { value: "BeautySalon", label: "Beauty salon" },
  { value: "HairSalon", label: "Hair salon" },
  { value: "HealthClub", label: "Fitness / Gym" },
  { value: "Dentist", label: "Dentist" },
  { value: "MedicalBusiness", label: "Other healthcare" },
  { value: "VeterinaryCare", label: "Veterinarian" },
  { value: "Optician", label: "Optician" },
  // Food
  { value: "Restaurant", label: "Restaurant" },
  { value: "CafeOrCoffeeShop", label: "Cafe" },
  { value: "Bakery", label: "Bakery" },
  { value: "FoodEstablishment", label: "Other food service" },
  // Services
  { value: "LegalService", label: "Legal services" },
  { value: "Notary", label: "Notary" },
  { value: "AccountingService", label: "Accounting" },
  { value: "RealEstateAgent", label: "Real estate agency" },
  { value: "DryCleaningOrLaundry", label: "Dry cleaner / Laundry" },
  { value: "ProfessionalService", label: "Other professional service" },
  // Other
  { value: "Florist", label: "Florist" },
  { value: "ChildCare", label: "Daycare / Childcare" },
  { value: "Store", label: "Store" },
  // Custom — sentinel value matches `businessType === "Custom"` checks
  // in the renderer + UI. Picking this triggers the
  // BrandTextField for `business_type_custom`. Renderer maps Custom +
  // text → schema @type="LocalBusiness" + description=customText.
  { value: "Custom", label: "Other — name it yourself" },
];

/**
 * Reverse lookup: schema.org type → English label. Used in the active-
 * state summary so the indicator shows "Type: Plumber" rather than
 * the raw "Plumber". Returns empty string for unknown / blank values
 * so the indicator just omits the line.
 */
function labelForBusinessType(value: string): string {
  if (!value) return "";
  const match = BUSINESS_TYPE_OPTIONS.find((o) => o.value === value);
  return match?.label ?? "";
}

/**
 * Single text input for the GA4 measurement id (G-XXXXXXXXXX).
 * Validates the format on every keystroke (visual only — invalid
 * values still save so the user can finish typing). Renderer only
 * injects the snippet when the value matches the strict regex AND
 * the page is being published (siteUrl set), so a half-typed id in
 * draft state can't break the live page.
 */
function Ga4Field({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  // Local typing buffer — same pattern as title/description above so
  // rapid keystrokes don't churn the parent composer state on every
  // char (rerunning all the SEO/preview memos is wasteful).
  const [local, setLocal, flush] = useTypingBuffer(value, onChange);
  const trimmed = local.trim();
  // Empty = neutral state (no validation feedback). Non-empty + matches
  // = green check. Non-empty + doesn't match = warning hint. We never
  // BLOCK the input so the user can paste before finishing the format.
  const isValid = /^G-[A-Z0-9]{6,12}$/i.test(trimmed);
  const showWarning = trimmed.length > 0 && !isValid;

  return (
    <div>
      <label className="block text-xs font-medium mb-1">
        Google Analytics
      </label>
      <p className="text-[10px] text-muted-foreground mb-1.5 leading-snug">
        Tracks how many people visit the site and where they came from (Google, Facebook…).
        If you don&apos;t have a Google Analytics account, leave this empty.
      </p>
      <input
        type="text"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={flush}
        placeholder="G-XXXXXXXXXX"
        spellCheck={false}
        autoCapitalize="characters"
        className={`w-full px-2 py-1.5 text-xs font-mono rounded border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 ${
          showWarning
            ? "border-amber-500/60 focus:ring-amber-500/40"
            : isValid
              ? "border-emerald-500/40"
              : "border-input"
        }`}
      />
      {showWarning && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 leading-snug">
          The ID must start with <code className="font-mono">G-</code> and be 6 to 12 characters.
        </p>
      )}
      {isValid && (
        // Two-part confirmation:
        //   1. Tiny green "Saved" line — reassures the value is in
        //      the database (no separate Save button needed; composer
        //      autosaves on blur via useTypingBuffer).
        //   2. Prominent amber callout box — the IMPORTANT bit: the
        //      live site doesn't pick up the script until publish.
        //      This is the #1 source of confusion ("I typed it, why
        //      isn't tracking working?") so it gets a proper boxed
        //      callout with icon + bold heading rather than a single
        //      muted line that's easy to miss. Existing live sites
        //      need a re-publish; new sites need their first publish
        //      — "publish" works for both, but we say it explicitly
        //      with "re-publishing" so existing sites aren't ambiguous.
        <div className="mt-1.5 space-y-2">
          <p className="text-[10px] text-emerald-600 dark:text-emerald-400 leading-snug">
            ✓ Saved to the database.
          </p>
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-[11px] leading-snug text-amber-900 dark:text-amber-100">
              <p className="font-semibold mb-0.5">
                Publish the site for the change to take effect
              </p>
              <p className="text-amber-800/90 dark:text-amber-200/90">
                Tracking activates only after the site is published (or
                re-published). It isn&apos;t measured in the editor to keep the data clean.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Switch-style toggle for "Visible in Google search".
 *
 * Reads as the *positive* state (visible = ON) because the common case is
 * "yes, index my site" — flipping the underlying no_index field makes the
 * UI clearer than asking users to think in double-negatives.
 *
 * Uses a hand-rolled track+thumb (no shadcn Switch dep yet). Track turns
 * emerald when on, muted when off; thumb slides 16px on toggle. role +
 * aria-checked make it keyboard- + screen-reader-accessible.
 */
function SearchVisibilityToggle({
  visible,
  onToggle,
  isPage = false,
  pageLabel,
}: {
  visible: boolean;
  onToggle: () => void;
  /** True when this toggle controls a single subpage's noindex rather
   *  than the whole site. Adjusts the copy so it's clear the scope is
   *  this page, not everything. */
  isPage?: boolean;
  pageLabel?: string;
}) {
  return (
    <div className="rounded-md border border-border p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium">
            {isPage
              ? `"${pageLabel || "This page"}" visible in search`
              : "Visible in Google search"}
          </p>
          <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
            {visible
              ? isPage
                ? "This page can be found and indexed by search engines."
                : "Search engines can find and index this site."
              : isPage
                ? "This page is hidden from search engines (rest of the site stays visible)."
                : "Hidden from Google, Bing, and other search engines."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={visible}
          aria-label="Toggle search engine visibility"
          onClick={onToggle}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background ${
            visible ? "bg-emerald-500" : "bg-muted-foreground/30"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-md ring-0 transition-transform ${
              visible ? "translate-x-4.5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
      {!visible && (
        <p className="text-[10px] text-amber-700 dark:text-amber-400 leading-snug border-t border-border pt-2">
          {isPage
            ? "⚠ Hides only this page from search (e.g. a thank-you or internal page). The rest of the site stays indexable."
            : "⚠ Use this for staging or unfinished sites. Turn it back on once the site is ready to be discovered."}
        </p>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// Combined image upload + preview surface for the social share image.
// Empty state: the box is one big click-to-upload zone with prompt text.
// Filled state: the image fills the box (object-contain so off-ratio
//   uploads aren't cropped in the preview) + hover reveals Replace + Remove.
function SocialImageUpload({
  value,
  onChange,
}: {
  value: string;
  /** Kept for interface back-compat (Phase B uses IDB, no per-site path). */
  siteId?: string;
  /** Called with the new URL + the probed dimensions (or null if probing
   *  failed). Dims feed og:image:width/height so social platforms render
   *  the share card at full resolution instead of a downscaled crop. */
  onChange: (
    url: string,
    dims: { width: number; height: number } | null,
  ) => void;
}) {
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      // Probe dimensions BEFORE the IDB stash — same blob can be reused
      // for both, and if probing fails (corrupt/unsupported file) the
      // upload should fail too with a clearer error. Cheap: ~5-20ms for
      // a typical 1200×630 file.
      const dims = await probeImageDimensions(file);
      // Phase B: stash in IndexedDB, return a `pending:{uuid}` marker.
      // Real upload to Cloudflare Pages happens on Publish.
      const pendingUrl = await putPendingImage(file);
      onChange(pendingUrl, dims);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // Resolve `pending:` URLs to a blob URL for the live preview. Real URLs
  // (https://, blob:, data:) pass through unchanged.
  const displayUrl = useDisplayUrl(value);

  if (value) {
    return (
      <div className="aspect-1200/630 bg-muted/40 relative group/og">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={displayUrl || value}
          alt=""
          className="w-full h-full object-contain"
        />
        {/* Hover overlay with Replace + Remove */}
        <div className="absolute inset-0 bg-black/0 group-hover/og:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover/og:opacity-100">
          <label
            className={`px-3 py-1.5 rounded-md bg-background text-foreground text-xs font-medium cursor-pointer hover:bg-muted ${
              uploading ? "pointer-events-none opacity-60" : ""
            }`}
          >
            {uploading ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Uploading…
              </span>
            ) : (
              "Replace"
            )}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => onChange("", null)}
            className="px-3 py-1.5 rounded-md bg-background text-destructive text-xs font-medium hover:bg-destructive/10"
            title="Remove"
          >
            <span className="inline-flex items-center gap-1">
              <X className="h-3 w-3" />
              Remove
            </span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <label
      className={`aspect-1200/630 bg-muted/40 relative flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:bg-muted/60 transition-colors ${
        uploading ? "pointer-events-none" : ""
      }`}
    >
      {uploading ? (
        <>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-[11px] text-muted-foreground">Uploading…</p>
        </>
      ) : (
        <>
          <ImageIcon className="h-6 w-6 text-muted-foreground/60" />
          <p className="text-[11px] text-foreground/80 font-medium">
            Click to upload social image
          </p>
          <p className="text-[10px] text-muted-foreground/70">
            Shown when shared on Facebook / LinkedIn
          </p>
        </>
      )}
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
    </label>
  );
}

function FieldGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1">{label}</label>
      {hint && (
        <p className="text-[10px] text-muted-foreground mb-1.5 leading-snug">
          {hint}
        </p>
      )}
      {children}
    </div>
  );
}

function CharBar({ value, max }: { value: number; max: number }) {
  const ratio = Math.min(value / max, 1.5);
  const overflow = value > max;
  const color = overflow
    ? "bg-destructive"
    : ratio > 0.85
    ? "bg-amber-500"
    : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full transition-all ${color}`}
          style={{ width: `${Math.min(ratio * 100, 100)}%` }}
        />
      </div>
      <span
        className={`text-[10px] tabular-nums ${
          overflow ? "text-destructive" : "text-muted-foreground"
        }`}
      >
        {value} / {max}
      </span>
    </div>
  );
}

// ── Image upload field — uses the existing /api/upload pipeline ─────────────
// (Same path as placeholder-field's image fields. Will be migrated to the
//  in-memory + flush-on-publish pattern in Phase B alongside other images.)

function ImageUploadField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  /** kept for interface back-compat, no longer used (Phase B uses IDB). */
  siteId?: string;
  /** kept for interface back-compat, no longer used. */
  uploadPathPrefix?: string;
  onChange: (url: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const displayUrl = useDisplayUrl(value);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const pendingUrl = await putPendingImage(file);
      onChange(pendingUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <label className="block text-xs font-medium mb-1">{label}</label>
      {hint && (
        <p className="text-[10px] text-muted-foreground mb-1.5 leading-snug">
          {hint}
        </p>
      )}
      {value ? (
        <div className="flex items-center gap-2 rounded-md border border-input p-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={displayUrl || value}
            alt=""
            className="h-10 w-10 object-cover rounded shrink-0 border"
          />
          <input
            type="text"
            value={value}
            readOnly
            className="flex-1 px-2 py-1 text-[11px] bg-transparent text-muted-foreground truncate min-w-0"
          />
          <label
            className={`px-2 py-1 text-[11px] rounded border cursor-pointer hover:bg-muted ${
              uploading ? "opacity-60 pointer-events-none" : ""
            }`}
          >
            {uploading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              "Replace"
            )}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => onChange("")}
            className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            title="Remove"
            aria-label="Remove"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <label
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-dashed border-input bg-muted/20 hover:bg-muted/40 hover:border-primary/40 cursor-pointer text-xs text-muted-foreground transition-colors ${
            uploading ? "opacity-60 pointer-events-none" : ""
          }`}
        >
          {uploading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Uploading…
            </>
          ) : (
            <>
              <ImageIcon className="h-3.5 w-3.5" />
              Choose file
            </>
          )}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
        </label>
      )}
    </div>
  );
}

/**
 * Read an image file's natural dimensions in the browser.
 *
 * Used by the SEO panel to capture og:image width + height at upload time
 * so the published <head> can emit `og:image:width` / `og:image:height` —
 * without these tags, FB and LinkedIn often render the share card with a
 * downscaled crop instead of the full-resolution image (the "blurry
 * preview" symptom).
 *
 * Returns null if the file can't be decoded as an image (corrupt, wrong
 * MIME, etc.) — caller should still proceed with the upload, just without
 * dimension hints. Cheap (~5-20ms for typical share images).
 */
function probeImageDimensions(
  file: File,
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      // Round to whole pixels — meta tags expect integer values.
      resolve({
        width: Math.round(img.naturalWidth),
        height: Math.round(img.naturalHeight),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * Local typing buffer that absorbs rapid keystrokes and only emits to the
 * parent after the user pauses (`TYPING_DEBOUNCE_MS`) or blurs the field.
 * Returns [value, setValue, flush]. SEO meta tags only show in <head> so
 * the iframe never needs to know about them mid-typing — the parent
 * composer's whole memo tree (theme, render, save scheduler) re-runs on
 * every parent state change, and that's the cost we're avoiding.
 *
 * If the parent value changes externally (e.g. a revert wipes the field),
 * the local state syncs back to that value.
 */
function useTypingBuffer(
  initial: string,
  onChange: (value: string) => void,
): [string, (v: string) => void, () => void] {
  const [local, setLocal] = useState(initial);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the value most recently emitted to (or received from) the
  // parent — so an external prop change can be distinguished from one
  // we're about to emit ourselves and avoid an infinite loop.
  const lastSyncedRef = useRef(initial);

  // External resync: if parent's value changes to something we didn't
  // emit, adopt it (e.g. revert, undo, programmatic edit).
  useEffect(() => {
    if (initial !== lastSyncedRef.current) {
      lastSyncedRef.current = initial;
      setLocal(initial);
    }
  }, [initial]);

  function setValue(v: string) {
    setLocal(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      lastSyncedRef.current = v;
      onChange(v);
    }, TYPING_DEBOUNCE_MS);
  }

  function flush() {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    lastSyncedRef.current = local;
    onChange(local);
  }

  // Flush on unmount so a quick tab switch doesn't lose the last keystrokes.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        lastSyncedRef.current = local;
        onChange(local);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [local, setValue, flush];
}
