"use client";

import { useRef, useState } from "react";
import { HelpCircle, Loader2, RefreshCw, Upload } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { previewLogoUrl, type SiteBrand } from "@/lib/composer/brand";
import {
  deleteStagedImage,
  uploadImage,
  useDisplayUrl,
} from "@/lib/composer/image-store";
import { useUploadTracker } from "@/lib/composer/upload-tracker";

/**
 * Footer logo subsection — visual mirror of `BrandSection` (the
 * Brand mark card in the navbar slot), but specialized for the
 * footer's optional per-footer logo override.
 *
 * Why separate from `BrandSection`:
 *   `BrandSection` owns three pieces of state on `composition.brand`:
 *   mode (auto/custom), company_text (used to generate auto SVG), and
 *   custom_logo_url. The footer override is a single optional URL —
 *   no auto/custom toggle (auto-mode for footer just means "use brand
 *   logo"), no separate company text. Reusing BrandSection would
 *   require either coupling the footer to brand mode flips (wrong
 *   semantics) or adding a footer-only mode toggle (extra UI for no
 *   user benefit). A dedicated component keeps each surface clean.
 *
 * Two visual modes:
 *   - **No override (default):** preview shows the brand-resolved
 *     logo (custom upload OR auto SVG from Brand panel). Caption
 *     reads "Same as Brand panel logo." One button: Upload custom.
 *   - **Custom override:** preview shows the footer-specific upload.
 *     Two buttons: Reset to Brand logo + Replace.
 *
 * Lives at the top of the footer slot card, mirroring how
 * BrandSection sits at the top of the navbar slot card. Tech-admin
 * sees one consistent pattern: per-slot logo control where they
 * already think about that slot.
 */
export function FooterLogoCard({
  brand,
  primaryColor,
  customFooterLogoUrl,
  siteId,
  onChange,
}: {
  /** Site brand from `composition.brand`. Drives the "default" preview
   *  thumbnail when no per-footer logo has been uploaded. */
  brand: SiteBrand;
  /** Theme primary color — feeds the auto-generated logo's icon fill
   *  for the brand-fallback preview thumbnail. */
  primaryColor: string;
  /** Currently-set footer-specific logo URL (from
   *  `composition.shared.footer_overrides.footer_logo`). When empty
   *  / undefined, the card shows brand fallback. */
  customFooterLogoUrl?: string;
  /** Required for the upload path — files are namespaced by site so
   *  cleanup + publish find them by prefix. */
  siteId: string;
  /** Receives the new URL on upload, or `""` on reset. The composer
   *  wires this to `updateSharedContent("footer", "footer_logo", v)`
   *  so it lands in the same `footer_overrides.footer_logo` slot
   *  the renderer's withBrandLogo("fallback") consults. */
  onChange: (logoUrl: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // Same race-prevention as BrandSection: picking a new file cancels
  // the in-flight upload so the older completion can't overwrite the
  // newer one.
  const uploadAbortRef = useRef<AbortController | null>(null);
  const uploadTracker = useUploadTracker();

  // Resolve `pending:` markers to blob: URLs for the <img> tag — same
  // hook BrandSection uses for its custom-mode preview. Two parallel
  // tracks because both the footer-specific override AND the brand-
  // mode custom logo can carry pending: markers (mid-upload state):
  //   - customFooterLogoUrl → translated via brandedFooterDisplay
  //   - brand.custom_logo_url → translated via brandCustomDisplay
  // Without the brand-side translation, clicking "Reset to Brand"
  // when the brand panel is custom-mode (and its logo is still a
  // pending: marker) leaves the <img> with `src="pending:xyz"`,
  // browser shows broken-image icon. Peter caught this 2026-05-15.
  const customFooterDisplay = useDisplayUrl(customFooterLogoUrl);
  const brandCustomDisplay = useDisplayUrl(brand.custom_logo_url);

  // Compute the brand-fallback URL exactly like the renderer does so
  // the card thumbnail matches what the iframe shows when no override
  // is set. Custom brand logo wins over auto-mode SVG when set; the
  // pending:→blob translation above keeps the <img> loadable.
  const brandFallbackUrl =
    brand.mode === "custom" && brand.custom_logo_url
      ? brandCustomDisplay || brand.custom_logo_url
      : previewLogoUrl(brand.company_text, primaryColor);

  const hasCustom = !!(customFooterLogoUrl && customFooterLogoUrl.trim());
  const previewSrc = hasCustom
    ? customFooterDisplay || customFooterLogoUrl
    : brandFallbackUrl;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    uploadAbortRef.current?.abort();
    const abort = new AbortController();
    uploadAbortRef.current = abort;
    setUploading(true);
    const previousUrl = customFooterLogoUrl ?? "";

    try {
      const url = await uploadTracker.trackUpload(
        uploadImage(file, siteId, abort.signal),
      );
      if (abort.signal.aborted) {
        // Newer pick replaced this — orphan, best-effort delete.
        void deleteStagedImage(url);
        return;
      }
      // Preload the URL before swapping the iframe so the transition
      // from no-image → real URL is invisible. Same trick as
      // BrandSection.
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
      onChange(url);
      // Replace cleanup — drop the prior file from staging now that
      // the slot points at the new one.
      if (previousUrl && previousUrl !== url) {
        void deleteStagedImage(previousUrl);
      }
      toast.success("Footer logo uploaded — publish to make it live.");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if ((err as { name?: string })?.name === "AbortError") return;
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      if (uploadAbortRef.current === abort) {
        uploadAbortRef.current = null;
        setUploading(false);
      }
    }
  }

  function resetToBrand() {
    const abandoned = customFooterLogoUrl ?? "";
    onChange(""); // empty string → renderer fallback re-fills with brand
    if (abandoned) void deleteStagedImage(abandoned);
    toast.success("Footer logo reset — back to Brand panel logo.");
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="dash-panel dash-subhead px-2.5 py-2.5 space-y-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            Footer logo
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground hover:text-(--dash-accent) transition-colors p-0.5 -m-0.5 rounded shrink-0"
                aria-label="What is the footer logo?"
              >
                <HelpCircle className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="left"
              className="max-w-65 text-xs leading-snug"
            >
              <strong className="block mb-1">Footer logo</strong>
              By default the footer shows the same logo as the navbar
              (set in the Brand mark card). Upload a different file
              here when the footer needs its own mark — e.g. a wider
              wordmark when the navbar uses just an icon.
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Logo preview — checkerboard backdrop so transparency is
            visible on user-uploaded PNG/SVG logos. Same treatment as
            BrandSection. */}
        <div
          className="rounded-md border dash-hairline bg-muted/40 p-2 flex items-center justify-center min-h-16"
          style={{
            backgroundImage:
              "linear-gradient(45deg, #f0f0f0 25%, transparent 25%), linear-gradient(-45deg, #f0f0f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f0f0f0 75%), linear-gradient(-45deg, transparent 75%, #f0f0f0 75%)",
            backgroundSize: "12px 12px",
            backgroundPosition: "0 0, 0 6px, 6px -6px, -6px 0",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewSrc}
            alt="Footer logo preview"
            className="max-h-12 max-w-full"
          />
        </div>

        {!hasCustom ? (
          <>
            <p className="text-[10px] text-muted-foreground leading-snug">
              Same as Brand panel logo. Upload a file here to use a
              different one in the footer.
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full inline-flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 rounded-md border dash-hairline bg-background hover:bg-muted/60 transition-colors disabled:opacity-60"
            >
              {uploading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Upload className="h-3 w-3" />
              )}
              Upload custom footer logo
            </button>
          </>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={resetToBrand}
              className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 rounded-md border dash-hairline bg-background hover:bg-muted/60 transition-colors"
              title="Use the same logo as Brand panel"
            >
              <RefreshCw className="h-3 w-3" />
              Reset to Brand
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 rounded-md border dash-hairline bg-background hover:bg-muted/60 transition-colors disabled:opacity-60"
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
      </div>
    </TooltipProvider>
  );
}
