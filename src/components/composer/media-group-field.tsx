"use client";

import { useRef, useState } from "react";
import {
  Loader2,
  Trash2,
  ImagePlus,
  FileVideo,
  ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  deleteStagedImage,
  deleteStagedVideo,
  uploadImage,
  uploadVideo,
  useDisplayUrl,
} from "@/lib/composer/image-store";
import { useUploadTracker } from "@/lib/composer/upload-tracker";

/**
 * Combined image / video uploader for repeater items whose schema
 * declares a `media` group on an image-type + video-type field pair
 * (e.g. gallery-04). Two explicit actions ("Upload image" / "Upload
 * video"), one shared preview slot. Mutual exclusion on the data
 * layer — picking one kind clears the other underlying field so the
 * gallery item is unambiguously "an image" or "a video".
 *
 * Layout (right panel inside a gallery item editor):
 *
 *   ┌────────────────────────────────────┐
 *   │                                     │
 *   │    [4:3 preview / empty state]     │   ← preview area
 *   │                                     │
 *   │  [Image]                            │   ← optional type badge
 *   └────────────────────────────────────┘
 *
 *   ┌──────────────────┬──────────────────┐
 *   │ 🖼 Upload image  │ 🎞 Upload video  │   ← two explicit buttons
 *   └──────────────────┴──────────────────┘
 *                                  Remove   ← only when media is set
 *
 * The preview slot is also a drop target — drag a file from anywhere
 * (desktop, another tab) and we route to the right upload by MIME.
 * Each button opens a file picker filtered to its kind so the OS
 * sheet only shows files the user can actually use.
 *
 * Why not a single shared button (previous draft):
 *   Peter pushed back on the implicit "guess from file type" flow —
 *   users prefer to PICK the action upfront ("I want to put a video
 *   here"), not select a file and discover what mode it triggered.
 *   Two buttons make the intent visible before the file dialog opens
 *   AND make the supported media types obvious at a glance.
 *
 * Mutual exclusion lives on the data side, not the UI side: both
 * buttons remain clickable even when the other kind is already set —
 * the labels just switch to "Replace image" / "Replace video" so the
 * user knows what'll happen. The OTHER field is cleared on commit so
 * the renderer can't accidentally show stale state.
 */

interface Props {
  imageValue: string;
  videoValue: string;
  siteId: string;
  onImageChange: (url: string) => void;
  onVideoChange: (url: string) => void;
  /** Stored alt text for the image (under `<imageKey>_alt`). undefined
   *  when no explicit override exists; renderer then falls back to
   *  `altFallback` (the item title) when present. */
  altValue?: string;
  /** Auto-fallback shown in the input when `altValue` is empty —
   *  typically the repeater-item's `title` field. Same convention
   *  as PlaceholderField's image branch so galleries with both
   *  paired media (gallery-01) and standalone images (gallery-02/03)
   *  feel identical to the user. */
  altFallback?: string;
  /** Fires when the user types in the alt input. Composer wires this
   *  to write `<imageKey>_alt` onto the same overrides scope as the
   *  rest of the item's fields. Optional — only present for groups
   *  where the image half has alt-text support (always true today). */
  onAltChange?: (next: string) => void;
}

export function MediaGroupField({
  imageValue,
  videoValue,
  siteId,
  onImageChange,
  onVideoChange,
  altValue,
  altFallback,
  onAltChange,
}: Props) {
  // One spinner state across both buttons — only one upload at a time
  // per item slot. `uploadingKind` lets us label the spinner ("Uploading
  // image…" vs "Uploading video…") and keep the OTHER button enabled
  // visually but inert via the disabled prop.
  const [uploadingKind, setUploadingKind] = useState<"image" | "video" | null>(
    null,
  );
  const uploading = uploadingKind !== null;
  const [optimisticUrl, setOptimisticUrl] = useState<string | null>(null);
  const [optimisticKind, setOptimisticKind] = useState<"image" | "video" | null>(
    null,
  );
  const [dragActive, setDragActive] = useState(false);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const tracker = useUploadTracker();

  // useDisplayUrl is a hook — must be called unconditionally for both.
  const displayImage = useDisplayUrl(imageValue);
  const displayVideo = useDisplayUrl(videoValue);

  async function handlePick(file: File, forcedKind?: "image" | "video") {
    uploadAbortRef.current?.abort();
    const abort = new AbortController();
    uploadAbortRef.current = abort;

    // If a button forced a kind, trust it (user already chose). For
    // drag-and-drop we autodetect from MIME — most browsers populate
    // type reliably, but fall back to the extension as a safety net.
    let kind: "image" | "video";
    if (forcedKind) {
      kind = forcedKind;
    } else if (file.type.startsWith("video/")) {
      kind = "video";
    } else if (file.type.startsWith("image/")) {
      kind = "image";
    } else if (/\.(mp4|webm|mov|mkv)$/i.test(file.name)) {
      kind = "video";
    } else if (/\.(jpe?g|png|webp|gif|svg|avif)$/i.test(file.name)) {
      kind = "image";
    } else {
      toast.error("Unsupported file type — pick an image or video.");
      return;
    }
    setUploadingKind(kind);

    const blobUrl =
      typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(file)
        : null;
    if (blobUrl) {
      setOptimisticUrl(blobUrl);
      setOptimisticKind(kind);
    }

    // Capture URLs that this upload will replace so we can delete the
    // orphaned Supabase files after the swap. Snapshotting BEFORE the
    // await is important: the mutual-exclusion below clears whichever
    // field gets replaced, so reading from props after onChange would
    // give us an empty string.
    const previousImage = imageValue;
    const previousVideo = videoValue;
    try {
      const url = await tracker.trackUpload(
        kind === "video"
          ? uploadVideo(file, siteId, abort.signal)
          : uploadImage(file, siteId, abort.signal),
      );
      if (abort.signal.aborted) return;
      if (kind === "video") {
        onVideoChange(url);
        if (imageValue) onImageChange("");
      } else {
        onImageChange(url);
        if (videoValue) onVideoChange("");
      }
      // Fire-and-forget cleanup of files orphaned by this swap. The
      // delete helpers are no-ops for non-staged URLs (data URLs,
      // /_uploads/ paths from prior publishes), so calling them
      // unconditionally is safe. Cases covered:
      //   - Replace video A → video B: A's Supabase file deleted.
      //   - Replace image A → image B: A's Supabase file deleted.
      //   - Swap kinds (mutual exclusion): old kind's file deleted.
      if (kind === "video") {
        if (previousVideo && previousVideo !== url) {
          void deleteStagedVideo(previousVideo);
        }
        if (previousImage) void deleteStagedImage(previousImage);
      } else {
        if (previousImage && previousImage !== url) {
          void deleteStagedImage(previousImage);
        }
        if (previousVideo) void deleteStagedVideo(previousVideo);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if ((err as { name?: string })?.name === "AbortError") return;
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      if (uploadAbortRef.current === abort) {
        uploadAbortRef.current = null;
        setUploadingKind(null);
        setOptimisticUrl(null);
        setOptimisticKind(null);
      }
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    }
  }

  function handleReset() {
    // Snapshot before clearing so the fire-and-forget deletes have
    // the URLs to target. Clearing state first then reading would
    // give us an empty string.
    const wipeVideo = videoValue;
    const wipeImage = imageValue;
    if (videoValue) onVideoChange("");
    if (imageValue) onImageChange("");
    // Best-effort orphan cleanup. Helpers no-op on URLs that aren't
    // staged Supabase files (e.g. data URLs, /_uploads/ paths) so
    // calling them unconditionally is safe.
    if (wipeVideo) void deleteStagedVideo(wipeVideo);
    if (wipeImage) void deleteStagedImage(wipeImage);
  }

  function handleDragOver(e: React.DragEvent) {
    if (uploading) return;
    e.preventDefault();
    e.stopPropagation();
    if (!dragActive) setDragActive(true);
  }
  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) handlePick(file);
  }

  const previewKind: "image" | "video" | null =
    optimisticKind ?? (videoValue ? "video" : imageValue ? "image" : null);
  const previewSrc =
    optimisticUrl ?? (videoValue ? displayVideo : displayImage);
  const hasMedia = !!(videoValue || imageValue || optimisticUrl);
  const hasImage = !!imageValue || optimisticKind === "image";
  const hasVideo = !!videoValue || optimisticKind === "video";

  return (
    <div className="space-y-2">
      {/* Hidden file inputs, one per kind, so each button opens the
          OS file dialog filtered to the right MIME set. value reset
          in onChange so picking the same file twice still fires. */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml,image/avif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handlePick(f, "image");
          e.target.value = "";
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/x-matroska"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handlePick(f, "video");
          e.target.value = "";
        }}
      />

      {/* Preview slot — purely visual, also acts as a drag target so a
          file dropped anywhere on the well routes to the right upload
          by MIME. Click is NOT bound here on purpose: the two action
          buttons below are the explicit entry points, and a clickable
          preview made the "what does clicking the preview do?" mental
          load worse than the small drag-and-drop convenience gained. */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          // No rounded corners on the preview — Peter caught that the
          // radius was visible during the uploading overlay's frosted
          // backdrop and looked off. Keeping overflow-hidden so the
          // absolutely-positioned <img>/<video> stays clipped inside
          // the box.
          "relative w-full aspect-4/3 overflow-hidden",
          "transition-colors border dash-hairline bg-muted/20",
          hasMedia
            ? ""
            : "border-dashed",
          dragActive &&
            "border-solid border-(--dash-accent)/60 bg-(--dash-accent)/5 ring-2 ring-(--dash-accent)/20",
        )}
      >
        {/* Filled state — preview fills the well. */}
        {hasMedia && previewKind === "video" && previewSrc && (
          <video
            src={previewSrc}
            muted
            playsInline
            controls={false}
            preload="metadata"
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {hasMedia && previewKind === "image" && previewSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewSrc}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}

        {/* Empty state — quiet center: paired icons + a single helper
            line. Deliberately understated since the explicit Upload
            buttons below carry the call-to-action weight. */}
        {!hasMedia && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center pointer-events-none">
            <div className="flex items-center gap-1.5 text-muted-foreground/60">
              <ImagePlus className="h-5 w-5" />
              <span className="text-muted-foreground/30">+</span>
              <FileVideo className="h-5 w-5" />
            </div>
            <div className="text-xs text-muted-foreground/70">
              {dragActive
                ? "Drop to upload"
                : "Drop a file here, or use the buttons below"}
            </div>
          </div>
        )}

        {/* Type badge — appears only when media is set so the user can
            tell at a glance what's currently in this slot. */}
        {hasMedia && previewKind && !uploading && (
          <div className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full border dash-hairline bg-background/90 backdrop-blur-sm px-2 py-0.5 text-[10px] font-medium shadow-[0_1px_2px_oklch(0_0_0/0.06)]">
            {previewKind === "video" ? (
              <FileVideo className="h-3 w-3 dash-accent" />
            ) : (
              <ImageIcon className="h-3 w-3 dash-accent" />
            )}
            <span className="capitalize">{previewKind}</span>
          </div>
        )}

        {/* Uploading overlay — covers either state with a frosted
            backdrop so the previous preview stays visible underneath. */}
        {uploading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/85 backdrop-blur-sm">
            <Loader2 className="h-6 w-6 animate-spin dash-accent" />
            <span className="text-xs font-medium text-foreground/80">
              {uploadingKind === "video"
                ? "Uploading video…"
                : "Uploading image…"}
            </span>
          </div>
        )}
      </div>

      {/* Explicit action pair — equal width, icon + label. The labels
          flip to "Replace" when the matching kind is already set so
          the user knows clicking will overwrite, not append. */}
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => imageInputRef.current?.click()}
          className={cn(
            "h-9 gap-2 text-xs font-medium",
            // Subtle indicator that this kind is currently set —
            // accent-tinted ring without going as loud as a filled
            // button (which would compete with the preview's
            // visual hierarchy).
            hasImage &&
              "ring-1 ring-(--dash-accent)/35 bg-(--dash-accent)/5 dash-accent",
          )}
        >
          {uploadingKind === "image" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ImagePlus className="h-3.5 w-3.5" />
          )}
          {hasImage ? "Replace image" : "Upload image"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => videoInputRef.current?.click()}
          className={cn(
            "h-9 gap-2 text-xs font-medium",
            hasVideo &&
              "ring-1 ring-(--dash-accent)/35 bg-(--dash-accent)/5 dash-accent",
          )}
        >
          {uploadingKind === "video" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileVideo className="h-3.5 w-3.5" />
          )}
          {hasVideo ? "Replace video" : "Upload video"}
        </Button>
      </div>

      {/* Remove — only when something is set. Lives below the action
          row as a quiet secondary control (right-aligned, ghost
          variant) so it doesn't compete with the primary uploads. */}
      {hasMedia && !uploading && (
        <div className="flex items-center justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="h-7 gap-1 text-[11px] text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" />
            Remove
          </Button>
        </div>
      )}

      {/* Alt text input — only when the active media is the IMAGE
          half (videos don't carry alt). Mirrors PlaceholderField's
          alt input so galleries that use the grouped media pattern
          (gallery-01) feel identical to galleries with standalone
          images (gallery-02/03). Pre-fills with the sibling-title
          fallback so the user sees the auto-default. */}
      {onAltChange && hasImage && !hasVideo && (
        <MediaAltTextInput
          value={altValue}
          fallback={altFallback}
          onChange={onAltChange}
        />
      )}
    </div>
  );
}

/**
 * Inline alt-text input for the image half of a paired media field.
 * Same UX as PlaceholderField.AltTextInput — visible default pulled
 * from `fallback`, select-on-focus, store-empty-when-matches-fallback
 * so the renderer's auto-path keeps working. Duplicated here rather
 * than imported so MediaGroupField stays self-contained (no
 * cross-component coupling for one small input). Behavior MUST stay
 * in sync with the PlaceholderField version — touch both when you
 * touch one.
 */
function MediaAltTextInput({
  value,
  fallback,
  onChange,
}: {
  value: string | undefined;
  fallback: string | undefined;
  onChange: (next: string) => void;
}) {
  const displayValue =
    typeof value === "string" && value.length > 0 ? value : fallback ?? "";
  const isShowingFallback =
    (value === undefined || value === "") &&
    typeof fallback === "string" &&
    fallback.length > 0;

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    if (
      typeof fallback === "string" &&
      fallback.length > 0 &&
      next === fallback
    ) {
      onChange("");
      return;
    }
    onChange(next);
  }

  function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
    if (isShowingFallback) {
      const el = e.currentTarget;
      setTimeout(() => el.select(), 0);
    }
  }

  return (
    <div className="space-y-1">
      <label className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        Alt text
        <span
          className="text-muted-foreground/60"
          title="Image description for screen readers and image SEO. Falls back to the item title automatically."
        >
          ⓘ
        </span>
        {isShowingFallback && (
          <span className="text-[10px] text-muted-foreground/70 italic">
            (auto from title)
          </span>
        )}
      </label>
      <Input
        type="text"
        value={displayValue}
        onChange={handleInputChange}
        onFocus={handleFocus}
        placeholder="Describe what's in the image"
        className={
          "text-xs h-8 " +
          (isShowingFallback ? "italic text-muted-foreground" : "")
        }
        maxLength={140}
      />
    </div>
  );
}
