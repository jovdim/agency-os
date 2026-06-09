"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";

/**
 * IndexedDB-backed store for pending image uploads in the composer.
 *
 * Why: Phase B — instead of POSTing every image swap to Supabase Storage
 * (which leaks files for abandoned tries and adds a second CDN), we stash
 * the File in the user's browser. When they finally click Publish, we
 * upload the bytes to Cloudflare Pages alongside the HTML in a single
 * deployment. Single CDN, no orphan files in Supabase.
 *
 * IndexedDB instead of pure in-memory:
 *   - Survives tab close, browser restart, even crash recovery
 *   - ~50 MB available without permission prompts (more if user grants)
 *   - Files keyed by uuid → safe across multiple parallel uploads
 *
 * The composition stores `pending:{uuid}` markers in image fields. The
 * composer translates those to short-lived `blob:` URLs for the live
 * preview (via getBlobUrl). At publish time, the server-side flush
 * resolves them to real Cloudflare URLs. See publish.ts for the flush.
 */

const DB_NAME = "sk-composer-images";
const STORE_NAME = "files";
const DB_VERSION = 1;

/** A `pending:{uuid}` marker stored in composition.image fields. */
export type PendingImageUrl = `pending:${string}`;

export function isPendingUrl(value: string | undefined | null): value is PendingImageUrl {
  return typeof value === "string" && value.startsWith("pending:");
}

export function pendingKey(value: PendingImageUrl): string {
  return value.slice("pending:".length);
}

interface StoredImage {
  key: string;
  file: File;
  createdAt: number;
}

// ── DB lifecycle ───────────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  // Server-side guard — IndexedDB doesn't exist on the server. Code that
  // calls into this module from server-render contexts would fail anyway,
  // so we throw to make it loud.
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB not available in this context"));
  }
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB open failed"));
  });
  return dbPromise;
}

function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        let result: T | undefined;
        Promise.resolve(fn(store))
          .then((r) => {
            // If the fn returned an IDBRequest, await it via onsuccess.
            if (r && typeof r === "object" && "onsuccess" in r) {
              const req = r as IDBRequest<T>;
              req.onsuccess = () => {
                result = req.result;
              };
              req.onerror = () => reject(req.error);
            } else {
              result = r as T;
            }
          })
          .catch(reject);
        transaction.oncomplete = () => resolve(result as T);
        transaction.onerror = () =>
          reject(transaction.error ?? new Error("IDB tx failed"));
        transaction.onabort = () =>
          reject(transaction.error ?? new Error("IDB tx aborted"));
      }),
  );
}

// ── Public API ─────────────────────────────────────────────────────────────

const blobUrlCache = new Map<string, string>(); // pending-key → blob URL

/**
 * Image cap: 25 MB. Mirrored on the API route + the composer-staging
 * bucket. Bumped from 8 MB on 2026-05-09 to allow raw camera shots
 * (modern phones / DSLRs hit ~10-15 MB on JPEG, ~25 MB on uncompressed
 * PNG). publish.ts still optimizes every image down to web-friendly
 * bytes before deploy, so this only loosens the staging entry gate.
 *
 * Video cap: 200 MB. Mirrored on the API route + the composer-video
 * bucket (migration 00062). Sized for ~30s 1080p clips at reasonable
 * bitrate. Unlike images, videos are NEVER optimized — they ship as-is
 * to the live site (via Supabase, not Cloudflare Pages — see publish.ts
 * for why). Bump all three layers in lockstep if the agency needs
 * longer or 4K content.
 *
 * NOTE (2026-05-13): The Vercel body-cap caveat is GONE. Both functions
 * (uploadImage + uploadVideo) use presigned URLs and PUT bytes directly
 * to Supabase, so the Vercel API route only ever ships small JSON.
 */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
/** Max video duration in seconds. Enforced client-side before upload
 *  to keep Supabase storage bounded — without this, a client could
 *  drop a 30-minute screen recording and we'd happily store it.
 *
 *  2 minutes balances two concerns:
 *    - Covers testimonials, hero clips, short demos, product reels —
 *      the realistic agency-website use cases.
 *    - Anything longer is a candidate for YouTube/Vimeo embeds
 *      instead. gallery-04 still accepts those via the video_url
 *      text field; nothing about this limit blocks longer content,
 *      it just stops us from being the host for it.
 *
 *  Enforcement is browser-side (read duration via a hidden <video
 *  preload="metadata">). The 200 MB bucket cap is the only hard
 *  server-side gate, which is fine for an authenticated internal
 *  tool — bypassing this check requires DevTools shenanigans and
 *  even then the size limit catches anything truly absurd.
 */
const MAX_VIDEO_DURATION_SECONDS = 120;
/** @deprecated Kept as an alias for any external consumer that imported
 *  it before the image/video split. Maps to MAX_IMAGE_BYTES. */
const MAX_FILE_BYTES = MAX_IMAGE_BYTES;

/**
 * Read a video file's duration in seconds without uploading anything.
 * Returns null when the metadata can't be read (corrupt file, codec
 * the browser can't decode at all, etc.) — caller decides whether to
 * fail open or closed in that case.
 *
 * Hidden <video preload="metadata"> + loadedmetadata event is the
 * cheapest cross-browser way to do this; we don't need the full
 * decode, just the duration field, which is in the container header
 * and reads in well under a second for typical files.
 *
 * 8-second safety timeout so a malformed file can't hang the upload
 * flow — if metadata doesn't surface by then, treat it as unreadable.
 */
function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
      resolve(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        /* no-op */
      }
    };
    video.addEventListener("loadedmetadata", () => {
      const d = video.duration;
      cleanup();
      resolve(Number.isFinite(d) && d > 0 ? d : null);
    });
    video.addEventListener("error", () => {
      cleanup();
      resolve(null);
    });
    timeoutId = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 8000);
    video.src = objectUrl;
  });
}

/** Format seconds as "1m 23s" / "45s" for user-facing duration errors. */
function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}

/** The upload target the server issued — one of two storage providers. */
interface UploadTarget {
  provider?: "r2" | "supabase";
  upload_url?: string; // r2: presigned S3 PUT URL
  signed_url?: string; // supabase: (unused here; the SDK uses path+token)
  token?: string; // supabase: signed-upload token
  path: string;
}

/**
 * PUT the file bytes to whichever backend the server issued a target for.
 * Bytes go straight to storage — never through our Vercel function:
 *   - r2: raw `fetch` PUT to the presigned S3 URL.
 *   - supabase: the SDK's signed-upload token handshake.
 * Shared by uploadImage + uploadVideo so both providers stay in lockstep.
 */
async function putToStorage(
  issued: UploadTarget,
  file: File,
  supabaseBucket: string,
  signal?: AbortSignal,
): Promise<void> {
  if (issued.provider === "r2") {
    if (!issued.upload_url) throw new Error("Upload URL missing from server");
    const res = await fetch(issued.upload_url, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type || "application/octet-stream" },
      signal,
    });
    if (!res.ok) {
      if (signal?.aborted) throw new DOMException("Upload aborted", "AbortError");
      throw new Error(`Upload failed (${res.status})`);
    }
    return;
  }
  // Supabase signed-upload (default + fallback when R2 isn't configured).
  if (!issued.token) throw new Error("Upload token missing from server");
  const supabase = createBrowserSupabase();
  const { error: uploadErr } = await supabase.storage
    .from(supabaseBucket)
    .uploadToSignedUrl(issued.path, issued.token, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (uploadErr) {
    // Supabase wraps AbortError as a plain Error — re-throw the canonical
    // DOMException shape so callers' `name === "AbortError"` guards match.
    if (signal?.aborted) throw new DOMException("Upload aborted", "AbortError");
    throw new Error(`Upload failed: ${uploadErr.message}`);
  }
}

/**
 * Upload a File to the composer-staging bucket and return a real
 * public URL we can drop straight into composition fields.
 *
 * REPLACES the old `putPendingImage` IndexedDB-only flow. Every upload
 * now persists server-side immediately, so:
 *   - Cross-device editing works (laptop upload visible on phone).
 *   - Cross-role review works (client previews IT's pending logo).
 *   - Publish from any device works.
 *
 * Files in the staging bucket are deleted at publish time once they've
 * been copied to Cloudflare — staging is truly transient, only holds
 * in-progress edits.
 *
 * Caller is expected to pass `siteId` so uploads are namespaced by
 * site (`{site_id}/{uuid}.{ext}` in the bucket). That lets the future
 * orphan-cleanup task query by prefix and lets the publish flow find
 * the staged files for a given site without walking the whole bucket.
 *
 * Pass an `AbortSignal` to cancel an in-flight upload — used by the UI
 * when the user picks a new file before the previous one finishes
 * uploading. Aborted uploads throw a DOMException with name
 * "AbortError" which the caller is expected to silently ignore.
 */
export async function uploadImage(
  file: File,
  siteId: string,
  signal?: AbortSignal,
): Promise<string> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `Image is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 25 MB.`,
    );
  }

  // ── Step 1: ask the server for a one-shot signed upload URL ──
  // Only metadata travels through Vercel here — the response is small
  // JSON. The file bytes never touch the serverless function, which
  // is what makes uploads bigger than Vercel's body cap (4.5 MB on
  // Hobby, ~10 MB on Pro) actually work. The browser does the heavy
  // lifting in step 2.
  const urlRes = await fetch("/api/composer/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      site_id: siteId,
      mime_type: file.type,
      size: file.size,
      filename: file.name,
    }),
    signal,
  });
  if (!urlRes.ok) {
    const data = await urlRes.json().catch(() => ({}));
    throw new Error(data.error || `Could not get upload URL (${urlRes.status})`);
  }
  const issued = (await urlRes.json()) as UploadTarget & { public_url: string };

  // Bail if the caller aborted between the URL response and starting
  // the actual upload. Avoids burning the signed URL slot for a file
  // the user already moved on from.
  if (signal?.aborted) {
    throw new DOMException("Upload aborted", "AbortError");
  }

  // ── Step 2: PUT the file bytes straight to storage (R2 or Supabase) ──
  await putToStorage(issued, file, "composer-staging", signal);

  return issued.public_url;
}

/**
 * Upload a raw video file to the composer-video bucket and return its
 * public URL. Mirrors `uploadImage` step-for-step (presigned URL +
 * direct-PUT to Supabase) but with the video-specific cap, MIME
 * allowlist, and bucket. The live site references the returned URL
 * directly — publish.ts is taught to skip composer-video URLs so the
 * file stays on Supabase rather than being migrated to Cloudflare Pages
 * (which isn't sized for ≥25 MB assets per file).
 *
 * Caller is responsible for picking a field type that semantically
 * holds a video URL (a `<video>` element in the template, not `<img>`).
 * See PlaceholderField's `video` type for the canonical wiring.
 */
export async function uploadVideo(
  file: File,
  siteId: string,
  signal?: AbortSignal,
): Promise<string> {
  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error(
      `Video is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_VIDEO_BYTES / 1024 / 1024} MB.`,
    );
  }
  // Duration gate — read the file's metadata locally and reject if it
  // exceeds MAX_VIDEO_DURATION_SECONDS. Null = couldn't read; we fail
  // open in that case so a quirky-but-valid file doesn't get blocked
  // unfairly. The 200 MB bucket cap still bounds the storage hit.
  const duration = await readVideoDuration(file);
  if (duration !== null && duration > MAX_VIDEO_DURATION_SECONDS) {
    throw new Error(
      `Video is too long (${formatDuration(duration)}). Max ${formatDuration(MAX_VIDEO_DURATION_SECONDS)}.`,
    );
  }
  if (signal?.aborted) {
    throw new DOMException("Upload aborted", "AbortError");
  }
  const urlRes = await fetch("/api/composer/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      site_id: siteId,
      mime_type: file.type,
      size: file.size,
      filename: file.name,
      kind: "video",
    }),
    signal,
  });
  if (!urlRes.ok) {
    const data = await urlRes.json().catch(() => ({}));
    throw new Error(data.error || `Could not get upload URL (${urlRes.status})`);
  }
  const issued = (await urlRes.json()) as UploadTarget & {
    public_url: string;
    bucket?: string;
  };
  if (signal?.aborted) {
    throw new DOMException("Upload aborted", "AbortError");
  }
  await putToStorage(issued, file, issued.bucket || "composer-video", signal);
  return issued.public_url;
}

/** Public base URL R2 assets are served from (inlined at build time via the
 *  NEXT_PUBLIC_ prefix). Empty when R2 isn't configured — then only the
 *  Supabase storage markers match below. */
function r2PublicBase(): string {
  return (process.env.NEXT_PUBLIC_R2_PUBLIC_URL || "").replace(/\/+$/, "");
}

/**
 * True iff `url` points at a staged video — the Supabase composer-video bucket
 * OR an R2 `/videos/` object. Used by publish.ts to skip video URLs when
 * collecting bytes to migrate to Cloudflare (videos stay at their permanent
 * home), and to gate delete-on-replace cleanup to assets we own.
 */
export function isStagedVideoUrl(url: string | null | undefined): boolean {
  if (typeof url !== "string") return false;
  if (/\/storage\/v1\/object\/public\/composer-video\//.test(url)) return true;
  const base = r2PublicBase();
  return Boolean(base) && url.startsWith(`${base}/videos/`);
}

/**
 * Best-effort delete of a single staged video. Mirrors
 * `deleteStagedImage` but targets the composer-video bucket. Routes
 * through the same DELETE /api/composer/upload endpoint, which now
 * accepts both bucket URL shapes.
 *
 * Use sites:
 *   - MediaGroupField "Replace": clear the old video when a new one
 *     (or an image) takes its slot.
 *   - MediaGroupField "Remove": user emptied the slot entirely.
 *   - PlaceholderField with `type: "video"` if/when that path also
 *     needs a per-replace cleanup (not wired today).
 *
 * Fire-and-forget: failures are silently swallowed because the worst
 * case is an orphan in composer-video that the periodic sweeper picks
 * up later. Throwing here would force every callsite to wrap in
 * try/catch for a non-critical operation.
 */
export async function deleteStagedVideo(
  url: string | null | undefined,
): Promise<void> {
  if (!isStagedVideoUrl(url)) return;
  try {
    await fetch(
      `/api/composer/upload?url=${encodeURIComponent(url as string)}`,
      { method: "DELETE", keepalive: true },
    );
  } catch {
    // Swallowed — see comment above.
  }
}

/**
 * True iff `url` looks like a Supabase composer-staging public URL.
 * Used to gate `deleteStagedImage` calls — we only want to clean up
 * files this app put there. External URLs, Cloudflare published URLs,
 * data: URLs, blob: URLs, and `pending:` markers are all left alone.
 */
export function isStagedImageUrl(url: string | null | undefined): boolean {
  if (typeof url !== "string") return false;
  if (/\/storage\/v1\/object\/public\/composer-staging\//.test(url)) return true;
  const base = r2PublicBase();
  return Boolean(base) && url.startsWith(`${base}/images/`);
}

/**
 * Best-effort delete of a single staged image. Used when:
 *   - User replaces an image (delete the previous file).
 *   - User resets a custom logo back to auto.
 *   - An upload completes server-side but is then immediately
 *     superseded by a newer pick (abort race window).
 *
 * Fire-and-forget: failures are silently swallowed because the worst
 * case is a tiny orphan in the staging bucket, which the future
 * cleanup task will sweep on a schedule. Throwing here would force
 * every callsite to wrap in try/catch for a non-critical operation.
 */
export async function deleteStagedImage(
  url: string | null | undefined,
): Promise<void> {
  if (!isStagedImageUrl(url)) return;
  try {
    await fetch(
      `/api/composer/upload?url=${encodeURIComponent(url as string)}`,
      { method: "DELETE", keepalive: true },
    );
  } catch {
    // Swallowed — see comment above.
  }
}

/**
 * Legacy alias for callers that haven't migrated to `uploadImage` yet.
 * Will be removed once every upload site uses the new function.
 *
 * @deprecated Use `uploadImage(file, siteId)` instead. The composition
 * stores a real Supabase URL now, not a `pending:{uuid}` marker.
 */
export async function putPendingImage(file: File): Promise<PendingImageUrl> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `Image is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 25 MB.`,
    );
  }
  const key =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const stored: StoredImage = { key, file, createdAt: Date.now() };
  await tx<IDBValidKey>("readwrite", (store) => store.put(stored));
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    blobUrlCache.set(key, URL.createObjectURL(file));
  }
  return `pending:${key}`;
}

/** Get the File back. Returns null if the key isn't in IDB (different device). */
export async function getPendingFile(key: string): Promise<File | null> {
  try {
    const result = await tx<StoredImage | undefined>("readonly", (store) =>
      store.get(key),
    );
    return result?.file ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve a `pending:{uuid}` URL to a `blob:` URL the iframe can render.
 * Cached so repeated calls don't allocate new blob URLs (which leak).
 */
export async function getBlobUrlForPending(
  pendingUrl: PendingImageUrl | string,
): Promise<string | null> {
  if (!isPendingUrl(pendingUrl)) return null;
  const key = pendingKey(pendingUrl);
  const cached = blobUrlCache.get(key);
  if (cached) return cached;
  const file = await getPendingFile(key);
  if (!file) return null;
  const url = URL.createObjectURL(file);
  blobUrlCache.set(key, url);
  return url;
}

/**
 * Synchronous variant — only returns a URL if we already have the blob in
 * memory. Used by render paths that can't await (the previewHtml memo and
 * the SK_PATCH_FIELD postMessage). Pair with `prefetchPendingBlobUrls` to
 * warm the cache from IDB on mount before we try to render.
 */
export function getCachedBlobUrl(
  pendingUrl: PendingImageUrl | string,
): string | null {
  if (!isPendingUrl(pendingUrl)) return null;
  return blobUrlCache.get(pendingKey(pendingUrl)) ?? null;
}

/**
 * Warm the blob-URL cache for a list of pending uuids by reading them
 * from IDB. Call from composer-client on mount + whenever the composition
 * picks up new pending markers (e.g. after revert).
 *
 * Returns the set of keys that were successfully cached so the caller
 * knows which ones survived (rest are missing — different device).
 */
export async function prefetchPendingBlobUrls(
  keys: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  await Promise.all(
    keys.map(async (key) => {
      if (blobUrlCache.has(key)) {
        found.add(key);
        return;
      }
      const file = await getPendingFile(key);
      if (!file) return;
      blobUrlCache.set(key, URL.createObjectURL(file));
      found.add(key);
    }),
  );
  return found;
}

/** Remove a single pending entry (use after publish). */
export async function deletePendingImage(key: string): Promise<void> {
  // Free the blob URL if we created one
  const url = blobUrlCache.get(key);
  if (url) {
    URL.revokeObjectURL(url);
    blobUrlCache.delete(key);
  }
  try {
    await tx<undefined>("readwrite", (store) => store.delete(key));
  } catch {
    /* best-effort */
  }
}

/** List ALL stored entries — used at publish time to gather pending uploads. */
export async function getAllPending(): Promise<StoredImage[]> {
  try {
    return (await tx<StoredImage[]>("readonly", (store) =>
      store.getAll(),
    )) ?? [];
  } catch {
    return [];
  }
}

/**
 * Drop any IDB entries whose keys are no longer referenced by the composition.
 * Run after a successful publish (when pending markers are replaced with
 * real URLs) AND on composer load (to garbage-collect from previous sessions).
 */
export async function purgeUnused(stillReferenced: Set<string>): Promise<void> {
  try {
    const all = await getAllPending();
    for (const entry of all) {
      if (!stillReferenced.has(entry.key)) {
        await deletePendingImage(entry.key);
      }
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Provides the site's deployment URL (e.g. `https://abc.pages.dev`) so
 * `useDisplayUrl` can resolve relative `/_uploads/` paths from prior
 * publishes. Wrap the composer tree in this provider so every image
 * thumbnail + iframe field-patch shows real images instead of broken icons.
 */
export const SiteUrlContext = createContext<string | null>(null);

/**
 * React hook: turn any URL string (including `pending:` markers and relative
 * `/_uploads/` paths) into something an `<img src>` can render.
 *   - `pending:{uuid}` → blob: URL from IndexedDB
 *   - `/anything` → resolved against SiteUrlContext if set
 *   - everything else (https://, blob:, data:) → unchanged
 *
 * Usage:
 *   const displaySrc = useDisplayUrl(field.value);
 *   <img src={displaySrc} />
 */
export function useDisplayUrl(url: string | null | undefined): string {
  const siteUrl = useContext(SiteUrlContext);
  const resolveStatic = (u: string) =>
    u.startsWith("/") && siteUrl ? `${siteUrl.replace(/\/$/, "")}${u}` : u;

  const [resolved, setResolved] = useState<string>(() => {
    if (!url || isPendingUrl(url)) return "";
    return resolveStatic(url);
  });

  useEffect(() => {
    let cancelled = false;
    if (!url) {
      setResolved("");
      return;
    }
    if (!isPendingUrl(url)) {
      setResolved(resolveStatic(url));
      return;
    }
    getBlobUrlForPending(url).then((blob) => {
      if (!cancelled) setResolved(blob ?? "");
    });
    return () => {
      cancelled = true;
    };
    // resolveStatic is stable per render (closes over siteUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, siteUrl]);

  return resolved;
}

/**
 * Walk a composition value and collect every `pending:{uuid}` marker it
 * contains. Used by composer-client to know which entries to keep alive
 * + by the publish handler to gather files for upload.
 */
export function collectPendingKeys(comp: unknown): string[] {
  const keys: string[] = [];
  walk(comp);
  return keys;

  function walk(node: unknown) {
    if (typeof node === "string") {
      if (isPendingUrl(node)) keys.push(pendingKey(node));
      return;
    }
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const v of Object.values(node)) walk(v);
  }
}
