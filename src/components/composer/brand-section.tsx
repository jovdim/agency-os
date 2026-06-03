"use client";

import { useRef, useState } from "react";
import { HelpCircle, Loader2, RefreshCw, RotateCcw, Upload } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  LOGO_HEIGHT_DEFAULT_PX,
  LOGO_HEIGHT_MAX_PX,
  LOGO_HEIGHT_MIN_PX,
  LOGO_HEIGHT_STEP_PX,
  previewLogoUrl,
  type SiteBrand,
} from "@/lib/composer/brand";
import {
  deleteStagedImage,
  uploadImage,
  useDisplayUrl,
} from "@/lib/composer/image-store";
import { useUploadTracker } from "@/lib/composer/upload-tracker";

/**
 * Brand subsection — shows the current logo, lets the user edit the
 * company text (auto mode), upload a custom file, or reset back to auto.
 *
 * Two visual modes:
 *   - Auto: text input + preview that recolors with theme.primary live.
 *           Image follows the primary color dice 🎲 in the Theme panel
 *           without any extra wiring (re-renders use the latest
 *           primaryColor prop).
 *   - Custom: shows the uploaded image + Reset/Replace buttons. The
 *             current image stays put even when primary color changes.
 *
 * Lives next to the Navbar fields in the right panel — same place users
 * already think about "the logo + nav link labels", so brand controls
 * are co-located with the rest of the navbar editor. The Theme panel
 * still owns the primary color (which the auto logo derives from), so
 * the two stay visually linked even though the controls are split.
 */
export function BrandSection({
  brand,
  primaryColor,
  siteId,
  onChange,
  onOptimisticLogo,
}: {
  brand: SiteBrand;
  primaryColor: string;
  /** Required for the upload path — every staged file is namespaced by
   *  site so cleanup + publish can find them by prefix. */
  siteId: string;
  onChange: (patch: Partial<SiteBrand>) => void;
  /** Called with a local blob: URL the moment a file is picked, before
   *  the upload runs. The composer paints the iframe's logo via
   *  SK_PATCH_BRAND without touching composition state — same idea as
   *  PlaceholderField's onOptimisticImage. */
  onOptimisticLogo?: (logoUrl: string) => void;
}) {
  const isCustom = brand.mode === "custom" && !!brand.custom_logo_url;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // Same race-prevention as PlaceholderField: picking a new logo
  // cancels the previous in-flight upload so the older completion
  // can't overwrite composition.brand with a stale URL.
  const uploadAbortRef = useRef<AbortController | null>(null);
  const uploadTracker = useUploadTracker();
  // Intentionally NO unmount abort here — see PlaceholderField for the
  // full reasoning. Short version: re-renders from selecting a
  // different section in the rail used to silently kill in-flight
  // uploads via this cleanup, dropping images the user thought were
  // saved. The composer-level tracker keeps the promise alive so
  // publish awaits it and onChange remains a valid callback regardless
  // of which section is currently selected.

  // Auto-mode preview is computed inline from text + theme primary —
  // changes instantly when either input updates. Custom-mode previews
  // resolve through useDisplayUrl so `pending:` markers flip to blob:
  // URLs the <img> can actually render.
  const autoPreview = previewLogoUrl(brand.company_text, primaryColor);
  const customDisplay = useDisplayUrl(brand.custom_logo_url);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Always reset the input so picking the same file twice in a row
    // still fires onChange (browsers skip the event when the value is
    // identical to the last one).
    e.target.value = "";
    if (!file) return;
    // Cancel any previous in-flight upload so a slow first upload
    // can't land AFTER a fast second upload and overwrite the new logo.
    uploadAbortRef.current?.abort();
    const abort = new AbortController();
    uploadAbortRef.current = abort;

    setUploading(true);
    // Optimistic paint — show the new logo in the iframe instantly via
    // a local blob: URL while the upload runs in the background.
    // Composition state stays untouched until the real Supabase URL
    // is back; otherwise autosave could capture the blob: URL which
    // is meaningless to anyone else.
    const blobUrl =
      typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(file)
        : null;
    if (blobUrl && onOptimisticLogo) onOptimisticLogo(blobUrl);
    // Capture the URL we're about to replace so we can clean it up
    // from staging once the new upload lands.
    const previousUrl = brand.custom_logo_url ?? "";
    try {
      // Upload to the composer-staging bucket — visible immediately to
      // every device + role looking at this site. Publish copies it to
      // Cloudflare and removes it from staging. The trackUpload wrap
      // is what lets handlePublish() in composer-client await this
      // promise before posting; without it, a user who clicks Publish
      // mid-upload would deploy without the new logo.
      const url = await uploadTracker.trackUpload(
        uploadImage(file, siteId, abort.signal),
      );
      if (abort.signal.aborted) {
        // Newer pick replaced this — the file we just uploaded is
        // already orphaned. Best-effort delete.
        void deleteStagedImage(url);
        return;
      }
      // Preload the Supabase URL before swapping the iframe so the
      // transition from optimistic blob → real URL is invisible.
      // See PlaceholderField for the full reasoning.
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = url;
      });
      if (abort.signal.aborted) {
        void deleteStagedImage(url);
        return;
      }
      // Atomic switch: mode + URL set in one patch so the renderer never
      // sees mode=custom with a stale logo URL or vice versa.
      onChange({ mode: "custom", custom_logo_url: url });
      // Replace cleanup — drop the prior file from staging now that
      // composition references the new one.
      if (previousUrl && previousUrl !== url) {
        void deleteStagedImage(previousUrl);
      }
      toast.success("Logo uploaded — publish to make it live.");
    } catch (err) {
      // AbortError = the user picked a different logo before this one
      // finished. Silently ignore — the newer upload owns the UI now.
      if (err instanceof DOMException && err.name === "AbortError") return;
      if ((err as { name?: string })?.name === "AbortError") return;
      toast.error(err instanceof Error ? err.message : "Upload failed");
      // Best-effort rollback: tell the iframe to revert to whatever
      // logo composition currently shows.
      if (onOptimisticLogo) {
        onOptimisticLogo(brand.custom_logo_url ?? autoPreview);
      }
    } finally {
      // Only this upload's owner flips the spinner off; a newer pick
      // already toggled it back on for itself.
      if (uploadAbortRef.current === abort) {
        uploadAbortRef.current = null;
        setUploading(false);
      }
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    }
  }

  function resetToAuto() {
    // Capture the file we're about to abandon so we can clean it up
    // from staging — composition is moving to auto mode and won't
    // reference this URL anymore.
    const abandoned = brand.custom_logo_url ?? "";
    // Drop the custom URL when going back to auto so future publishes
    // don't carry the orphaned reference around.
    onChange({ mode: "auto", custom_logo_url: undefined });
    if (abandoned) void deleteStagedImage(abandoned);
    toast.success("Back to auto-generated logo.");
  }

  return (
    // Self-contained TooltipProvider so the component works in any
    // ancestor — the original embedded version sat under the Theme
    // panel's provider, but now we render inside the Navbar slot where
    // no provider is guaranteed. delayDuration matches the Theme panel
    // (150ms) for visual consistency between the two sections.
    <TooltipProvider delayDuration={150}>
    <div className="rounded-md border bg-background/40 px-2.5 py-2.5 space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
          Brand mark
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground transition-colors p-0.5 -m-0.5 rounded shrink-0"
              aria-label="What is the brand mark?"
            >
              <HelpCircle className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-65 text-xs leading-snug">
            <strong className="block mb-1">Brand mark</strong>
            Logo + favicon used on the navigation bar, footer, and browser
            tab. Auto mode generates an SVG from your company name + brand
            color (recolors with the primary dice in the Theme panel). Upload
            your own file any time — the auto version is then ignored.
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Logo preview — checkerboard backdrop so transparency is visible
          on user-uploaded PNG/SVG logos. */}
      <div
        className="rounded border bg-muted/40 p-2 flex items-center justify-center min-h-16"
        style={{
          backgroundImage:
            "linear-gradient(45deg, #f0f0f0 25%, transparent 25%), linear-gradient(-45deg, #f0f0f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f0f0f0 75%), linear-gradient(-45deg, transparent 75%, #f0f0f0 75%)",
          backgroundSize: "12px 12px",
          backgroundPosition: "0 0, 0 6px, 6px -6px, -6px 0",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={isCustom ? customDisplay || autoPreview : autoPreview}
          alt="Logo preview"
          className="max-h-12 max-w-full"
        />
      </div>

      {/* Navbar logo size — applied to the `.logo` ancestor of nav_logo at
          render time (server + browser). Image inherits via the template's
          `.logo img { height: 100%; width: auto }` so width scales with
          the natural aspect ratio. ↺ clears the override back to the
          template default (48px on most navs). */}
      <LogoSizeControls
        size={brand.logo_height_px}
        onChange={(next) =>
          onChange({ logo_height_px: next === null ? undefined : next })
        }
      />


      {/* Auto-mode: text input + upload-custom button.
          Custom-mode: reset-to-auto + replace button. */}
      {!isCustom ? (
        <>
          <label className="block">
            <span className="sr-only">Company text</span>
            <input
              type="text"
              value={brand.company_text}
              onChange={(e) => onChange({ company_text: e.target.value })}
              placeholder="Company name"
              className="w-full text-xs px-2 py-1.5 rounded border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 rounded border bg-background hover:bg-muted/60 transition-colors disabled:opacity-60"
            >
              {uploading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Upload className="h-3 w-3" />
              )}
              Upload custom
            </button>
          </div>
        </>
      ) : (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={resetToAuto}
            className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 rounded border bg-background hover:bg-muted/60 transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            Reset to auto
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 rounded border bg-background hover:bg-muted/60 transition-colors disabled:opacity-60"
          >
            {uploading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Upload className="h-3 w-3" />
            )}
            Replace
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        className="hidden"
      />

      {/* Site-wide contact info — pre-filled from the linked proposal's
          contact on first composer open. Renderer auto-applies these
          across every section field whose key is phone / email /
          address (footer, nav CTA, contact form, map callouts), same
          way company_text propagates to nav + footer logos. Type once
          here, shows everywhere. */}
      <div className="border-t pt-2 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            Contact info
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground transition-colors p-0.5 -m-0.5 rounded shrink-0"
                aria-label="What is contact info?"
              >
                <HelpCircle className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-65 text-xs leading-snug">
              <strong className="block mb-1">Contact info</strong>
              Phone, email, and address shown across the site — footer,
              navbar CTA, contact form, map callouts. Type once here and
              every section auto-fills. Pre-filled from the proposal&apos;s
              contact when the site is first opened.
            </TooltipContent>
          </Tooltip>
        </div>
        <label className="block">
          <span className="sr-only">Phone</span>
          <input
            type="tel"
            value={brand.phone ?? ""}
            onChange={(e) => onChange({ phone: e.target.value })}
            placeholder="+1 555 123 4567"
            className="w-full text-xs px-2 py-1.5 rounded border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </label>
        <label className="block">
          <span className="sr-only">Email</span>
          <input
            type="email"
            value={brand.email ?? ""}
            onChange={(e) => onChange({ email: e.target.value })}
            placeholder="info@company.com"
            className="w-full text-xs px-2 py-1.5 rounded border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </label>
        <label className="block">
          <span className="sr-only">Address</span>
          <input
            type="text"
            value={brand.address ?? ""}
            onChange={(e) => onChange({ address: e.target.value })}
            placeholder="123 Main Street, City"
            className="w-full text-xs px-2 py-1.5 rounded border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </label>
      </div>
    </div>
    </TooltipProvider>
  );
}

/**
 * Inline +/− cluster controlling the navbar logo height. Mirrors the
 * SizeControls / WidthControls pattern from placeholder-field.tsx but
 * lives in BrandSection because the logo isn't a per-section field —
 * it's a brand-mark attribute that the renderer stamps on every nav
 * template's `.logo` ancestor.
 *
 *   [↺ − Npx +]
 *
 * Behavior:
 *  - + and − step by LOGO_HEIGHT_STEP_PX, clamped to MIN..MAX.
 *  - The pixel value is click-to-edit (type a custom number; Enter
 *    commits, empty + Enter resets to template default).
 *  - The ↺ slot is reserved (no layout shift on first click); only
 *    visible once an override is set.
 *  - When no override is set, the value column shows the default
 *    height (LOGO_HEIGHT_DEFAULT_PX) so users have a starting point.
 *
 * `onChange(null)` clears the override; `onChange(N)` sets a value.
 */
function LogoSizeControls({
  size,
  onChange,
}: {
  size: number | undefined;
  onChange: (next: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function clamp(n: number): number {
    return Math.max(LOGO_HEIGHT_MIN_PX, Math.min(LOGO_HEIGHT_MAX_PX, n));
  }
  function startingValue(): number {
    return typeof size === "number" ? size : LOGO_HEIGHT_DEFAULT_PX;
  }
  function shrink() {
    onChange(clamp(startingValue() - LOGO_HEIGHT_STEP_PX));
  }
  function grow() {
    onChange(clamp(startingValue() + LOGO_HEIGHT_STEP_PX));
  }
  function reset() {
    onChange(null);
  }
  function startEdit() {
    setDraft(typeof size === "number" ? String(size) : "");
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }
  function commitEdit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed === "") {
      onChange(null);
      return;
    }
    const parsed = parseInt(trimmed, 10);
    if (!Number.isFinite(parsed)) return;
    onChange(clamp(parsed));
  }

  const canShrink = typeof size !== "number" || size > LOGO_HEIGHT_MIN_PX;
  const canGrow = typeof size !== "number" || size < LOGO_HEIGHT_MAX_PX;
  const hasOverride = typeof size === "number";
  const displayValue = typeof size === "number" ? size : LOGO_HEIGHT_DEFAULT_PX;

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
        Logo size
      </span>
      <div
        className="flex items-center gap-0.5"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={reset}
          disabled={!hasOverride}
          title="Reset to default"
          aria-label="Reset to default"
          className={
            "h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground transition-colors " +
            (hasOverride
              ? "hover:text-foreground hover:bg-muted"
              : "invisible pointer-events-none")
          }
        >
          <RotateCcw className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={shrink}
          disabled={!canShrink}
          title="Smaller logo"
          aria-label="Smaller logo"
          className="h-5 w-5 inline-flex items-center justify-center rounded text-[10px] font-bold text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          −
        </button>
        {editing ? (
          <input
            ref={inputRef}
            type="number"
            inputMode="numeric"
            min={LOGO_HEIGHT_MIN_PX}
            max={LOGO_HEIGHT_MAX_PX}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitEdit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
            className="h-5 w-12 text-center text-[10px] font-semibold tabular-nums bg-background border border-input rounded px-0 outline-none focus:border-primary"
          />
        ) : (
          <button
            type="button"
            onClick={startEdit}
            title="Click to enter custom logo height"
            aria-label="Edit logo height"
            className="h-5 min-w-10 px-1 text-[10px] font-semibold tabular-nums text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
          >
            {displayValue}px
          </button>
        )}
        <button
          type="button"
          onClick={grow}
          disabled={!canGrow}
          title="Larger logo"
          aria-label="Larger logo"
          className="h-5 w-5 inline-flex items-center justify-center rounded text-[10px] font-bold text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          +
        </button>
      </div>
    </div>
  );
}
