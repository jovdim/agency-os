import { createAdminClient } from "@/lib/supabase/admin";
import { renderSite, type SiteComposition } from "./render";
import {
  buildRobotsTxt,
  buildSitemapXml,
  buildNotFoundHtml,
  buildPrivacyHtml,
  type SitemapImage,
} from "./crawl-files";
import {
  deployFiles,
  ensureDirectUploadProject,
  type DeploymentFile,
} from "@/lib/deployment/cloudflare-direct";
import { ensureCustomDomain } from "@/lib/deployment/cloudflare";
import { mergePageSeo } from "./seo";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { load as loadCheerio } from "cheerio";
// `sharp` import retired 2026-05-13 when optimizeImage went pass-through.
// Kept the comment so a future audit knows where the WebP re-encode
// used to live (see the block comment above optimizeImage).

/**
 * Static client-side scripts that get bundled into every Cloudflare
 * Pages deployment. The render layer emits `<script src="/foo.js">`
 * tags pointing at these names; without bundling them in here those
 * tags 404 on the deployed site. Pre-2026-05-10 the GitHub flow
 * pushed these via the repo, but the new direct-upload path needs
 * to copy them in explicitly.
 *
 *   - proposal-widget.js — BySquare QR + payment banner injected
 *     above the fold on `sent`/`viewed` proposals (this is the
 *     thing Peter calls out when he says "where people pay").
 *   - contact-handler.js — wires up the contact form on the site
 *     to /api/public/contact so submissions land in our DB +
 *     forward to the client's business email.
 *
 * (editor-helper.js used to be in this list but was removed
 * 2026-05-10 — the new composer doesn't need it and the
 * proxy-preview route injects its own inline equivalent. See
 * comment in render.ts buildScriptTags.)
 *
 * Read once at publish time and cached for the duration of the
 * Node process. The files themselves change rarely (committed in
 * public/), so cache invalidation is a non-issue — restart the
 * server when you update them.
 */
const WIDGET_SCRIPTS = ["proposal-widget.js", "contact-handler.js"] as const;
let cachedWidgetScripts: DeploymentFile[] | null = null;

function loadWidgetScripts(): DeploymentFile[] {
  if (cachedWidgetScripts) return cachedWidgetScripts;
  const files: DeploymentFile[] = WIDGET_SCRIPTS.map((name) => {
    const fullPath = path.join(process.cwd(), "public", name);
    // readFileSync intentionally — at publish time the cost is a
    // single sub-ms read per script. Async-fs would just add
    // boilerplate without buying anything here.
    const content = readFileSync(fullPath, "utf8");
    return {
      path: name,
      content,
      contentType: "application/javascript; charset=utf-8",
    };
  });
  cachedWidgetScripts = files;
  return files;
}

/** Base domain the agency owns and points at Cloudflare. Every published
 *  site gets a `{subdomain}.${PROPOSAL_DOMAIN}` URL automatically. Falls
 *  back to .pages.dev when not configured (dev / fresh setup). */
const PROPOSAL_DOMAIN = process.env.PROPOSAL_DOMAIN || "";

export interface PublishResult {
  /** Per-deploy unique URL (e.g. `https://abc.{project}.pages.dev`). Always
   *  present — every deployment gets a permanent immutable URL on CF. */
  url: string;
  /** Project's main pages.dev URL (e.g. `https://{project}.pages.dev`).
   *  Always present — points at the latest deployment. */
  pagesUrl: string;
  /** Friendly URL — custom domain if configured, else falls back to pagesUrl.
   *  This is what we save to site_url and surface in the UI. */
  friendlyUrl: string;
  /** Custom domain (e.g. `nexedge77.2dni.sk`) or null if not configured /
   *  domain registration failed. */
  customDomain: string | null;
  /** Subdomain used for the custom domain mapping (e.g. `nexedge77`).
   *  Persisted to sites.subdomain for future publishes + the editable UI. */
  subdomain: string | null;
  deploymentId: string;
  pageCount: number;
  /**
   * Snapshot row id from `site_versions`. Null on silent
   * publishes (auto-republishes that don't write a history row,
   * e.g. the banner config / disable dialogs' republish-on-save).
   */
  versionId: string | null;
  /** Map of original URL → new URL after substitution (e.g. `pending:abc`
   *  → `/_uploads/123.png`). Lets the client patch its in-memory composition
   *  without waiting for `router.refresh()` to roundtrip the DB. */
  substitutions: Record<string, string>;
}

/**
 * Files supplied by the browser at publish time, keyed by their `pending:{uuid}`
 * uuid. Each entry is the actual bytes (read from IndexedDB on the client and
 * sent as multipart/form-data).
 */
export interface PendingFile {
  bytes: Buffer;
  mimeType: string;
  /** Original filename — used only as a tie-breaker for the extension. */
  filename?: string;
}

export type PendingFilesMap = Map<string, PendingFile>;

/**
 * Render the site from its composition and publish to Cloudflare Pages
 * via the Direct Upload API. Records a snapshot in site_versions and
 * updates last_published_at on the site.
 *
 * Phase B additions:
 *   - Accepts a `pendingFiles` map of files the browser stashed in
 *     IndexedDB (image uploads that haven't been uploaded anywhere yet)
 *   - Walks the composition for `pending:{uuid}` markers AND for
 *     `*.supabase.co/...` URLs from older sites
 *   - Bundles those bytes into the Cloudflare deployment at
 *     `_uploads/{hash}.{ext}`, smart-cached by CF
 *   - Replaces URLs in the composition copy and saves the cleaned-up
 *     version to the DB ONLY after deploy succeeds (atomicity)
 *
 * @param siteId        the site to publish
 * @param userId        profile.id of the publisher (for site_versions.created_by)
 * @param reason        "tech_publish" | "change_request_apply" | "rollback" | "auto_banner_toggle"
 * @param pendingFiles  files the browser uploaded via multipart, keyed by uuid
 * @param options.silent  if true, skip the site_versions snapshot row.
 *                        Used by auto-republishes triggered by the
 *                        banner config / disable dialogs — the
 *                        composition didn't change, only the
 *                        show_banner / pricing flags did, so creating
 *                        a version row would just clutter the publish
 *                        history without giving anything to revert to.
 */
export async function publishSite(
  siteId: string,
  userId: string,
  reason:
    | "tech_publish"
    | "change_request_apply"
    | "rollback"
    | "auto_banner_toggle" = "tech_publish",
  pendingFiles?: PendingFilesMap,
  options?: { silent?: boolean },
): Promise<PublishResult> {
  const admin = createAdminClient();

  // ── PHASE 1: VALIDATE — no side effects yet ──
  const { data: site, error: siteErr } = await admin
    .from("sites")
    .select(
      "id, name, slug, subdomain, composition, is_legacy, proposal_id, owner_id, domain, domain_status, domain_setup_status",
    )
    .eq("id", siteId)
    .single();
  if (siteErr || !site) throw new Error("Site not found");
  if (site.is_legacy)
    throw new Error("Cannot publish legacy site (uses GitHub+cheerio path)");

  const originalComposition = site.composition as SiteComposition | null;
  if (!originalComposition?.pages || originalComposition.pages.length === 0) {
    throw new Error("Site has no composition");
  }

  // Optional: pull proposal context for script injection.
  // 2026-05-15: dropped the contacts(business_email) join — the contact-
  // handler script no longer needs a site-wide recipient stamped on its
  // <script> tag. Every <form> on the rendered HTML carries its own
  // `data-sk-form-recipient` attribute (set by parser.ts Pass 6 from
  // the section's `form_recipient_email` + `form_enabled` carriers),
  // and renderSite walks the composition to decide whether to inject
  // contact-handler.js at all. The `contacts.business_email` column
  // stays in the DB for sales-side reference but is no longer wired
  // into deployment.
  let proposalSlug: string | null = null;
  // Opt-IN model (Peter 2026-05-15): the banner ONLY ships on a
  // publish when `proposals.show_banner` is explicitly `true`. Null /
  // undefined / false all suppress the script tag. Sales has to
  // configure the banner via BannerConfigDialog (which sets the
  // discount + base prices AND flips show_banner=true atomically)
  // BEFORE the banner appears on the live site. Reasoning: prior
  // default-true behavior shipped the banner on the very first
  // publish — before any discount was configured — so the live site
  // displayed a banner with default/empty prices.
  let showBanner = false;
  if (site.proposal_id) {
    const { data: proposal } = await admin
      .from("proposals")
      .select("slug, show_banner")
      .eq("id", site.proposal_id)
      .single();
    if (proposal) {
      proposalSlug = (proposal as { slug?: string }).slug ?? null;
      const sb = (proposal as { show_banner?: boolean | null }).show_banner;
      showBanner = sb === true;
    }
  }

  // ── PHASE 2: RESOLVE IMAGE URLS — collect pending markers + Supabase URLs
  //    + existing /_uploads/ paths from prior publishes; fetch their bytes;
  //    prepare for the deployment bundle. Still no side effects — everything
  //    in memory. Each Cloudflare Pages deployment is independent, so any
  //    image referenced by the new HTML must be included in the new bundle
  //    or it 404s — even if the previous deployment had it.
  const pendingKeys = collectMatching(originalComposition, isPendingMarker);
  const supabaseUrls = collectMatching(originalComposition, isSupabaseUrl);
  // Videos collected separately — they go through a no-optimize +
  // size-gated migration branch. Files that fit under Cloudflare Pages'
  // 25 MiB per-file limit get bundled into the deployment (free CDN,
  // free egress). Files over the limit stay on Supabase so the live
  // site never breaks on an oversize asset.
  const supabaseVideoUrls = collectMatching(
    originalComposition,
    isSupabaseVideoUrl,
  );
  const existingUploadPaths = collectMatching(
    originalComposition,
    isExistingUploadPath,
  );

  // Resolve the Cloudflare project name. This name is used for THREE
  // things later in this function:
  //   1. ensureDirectUploadProject(projectName) — CF project we deploy to
  //   2. deployFiles(projectName, …)            — same project for new files
  //   3. ensureCustomDomain(projectName, …)     — same project for custom domain
  // AND for one thing right below:
  //   4. pagesBaseUrl = https://{projectName}.pages.dev — used to re-fetch
  //      previously-deployed /_uploads/* images so they survive the new
  //      deploy (each CF Pages deployment is independent).
  //
  // If any of these compute a DIFFERENT name than where prior publishes
  // landed, two failure modes follow:
  //   - The new deploy creates / writes to a different CF project than
  //     the existing one (custom domain still points at the old project).
  //   - The /_uploads/* fetch hits a wrong-or-empty project and
  //     fetchAndPrepare silently returns null — image gets DROPPED from
  //     the new deployment. (User-reported 2026-05-12.)
  //
  // Originally we always recomputed it from `sanitizeProjectName(site.slug)`.
  // That breaks whenever slug drifts from the actual project — usually
  // after the user changes their subdomain, or if the slug was set
  // differently when the CF project was first created.
  //
  // Fix: pin projectName to the most recent successful publish's URL.
  // site_versions.deployment_url stores the deployed URL on every publish;
  // its .pages.dev hostname is the canonical project name. Fall back to
  // slug-based sanitization only for the very first publish (no version
  // history yet) so the bootstrap path still works.
  const { data: lastVersion } = await admin
    .from("site_versions")
    .select("deployment_url")
    .eq("site_id", site.id)
    .not("deployment_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  function extractCfProjectName(url: string | null | undefined): string | null {
    if (!url) return null;
    try {
      const host = new URL(url).hostname;
      // Direct match: "{project}.pages.dev"
      const direct = host.match(/^([a-z0-9-]+)\.pages\.dev$/);
      if (direct) return direct[1];
      // Preview deploy: "{hash}.{project}.pages.dev" — strip the hash prefix
      const preview = host.match(/^[a-f0-9]+\.([a-z0-9-]+)\.pages\.dev$/);
      if (preview) return preview[1];
      return null;
    } catch {
      return null;
    }
  }

  const projectName =
    extractCfProjectName(lastVersion?.deployment_url) ??
    sanitizeProjectName(site.slug || site.id);
  const pagesBaseUrl = `https://${projectName}.pages.dev`;

  const urlSubstitutions = new Map<string, string>();
  const imageDeploymentFiles: DeploymentFile[] = [];

  // Pending markers — bytes already in memory from the multipart upload.
  // Optimize each before bundling (resize huge photos, convert to WebP).
  // Awaited in parallel so 10 images doesn't take 10× single-image time.
  const optimizedPending = await Promise.all(
    pendingKeys.map(async (marker) => {
      const uuid = marker.slice("pending:".length);
      const file = pendingFiles?.get(uuid);
      if (!file) {
        throw new Error(
          `Pending image not provided in upload (uuid=${uuid}). Re-upload the image and try again.`,
        );
      }
      const opt = await optimizeImage(file.bytes, file.mimeType, file.filename);
      return { marker, opt };
    }),
  );
  for (const { marker, opt } of optimizedPending) {
    const hash = sha256Short(opt.bytes);
    const path = `_uploads/${hash}.${opt.ext}`;
    if (!imageDeploymentFiles.some((f) => f.path === path)) {
      imageDeploymentFiles.push({
        path,
        content: opt.bytes,
        contentType: opt.mimeType,
      });
    }
    // Use a relative URL so it works under any custom domain mapping.
    urlSubstitutions.set(marker, `/${path}`);
  }

  // Async fetches: Supabase migration + existing-deployment re-bundle. Run
  // in parallel — they're independent network calls, total wall time = the
  // slowest single fetch instead of their sum. With ~10 images this drops
  // ~1s of publish time to ~150ms; with 50 images it's ~5s -> ~300ms.
  //
  //   - Supabase URLs: fetched from the project's Supabase Storage CDN, then
  //     migrated to /_uploads/{hash}.{ext} so the site stops depending on
  //     Supabase. Substitution is recorded in urlSubstitutions.
  //   - Existing /_uploads/ paths: each CF Pages deploy is independent so
  //     prior images would 404 on re-publish unless we re-include the bytes.
  //     Path stays the same — no substitution needed.
  type Fetched = {
    path: string;
    content: Buffer;
    contentType: string;
    substituteFrom?: string;
  };

  // Critical-fetch failures (existing /_uploads/* paths from prior
  // deploy that we couldn't re-fetch after retries). Each CF Pages
  // deploy is independent — if we can't bundle these bytes, the new
  // deployment will reference URLs that 404, breaking every image on
  // the live site (= the "all images Propagating…" failure mode).
  //
  // Closed-over by fetchAndPrepare so we collect every failure across
  // the parallel Promise.all without losing any to first-rejection.
  // Drained + thrown AFTER the Promise.all so the operator sees a
  // complete list of missing files, not just the first one.
  const criticalFetchFailures: Array<{ url: string; reason: string }> = [];

  // Cloudflare Pages keeps every past deployment accessible at its own
  // preview URL ({hash}.{project}.pages.dev), even after the main URL
  // points at a newer deploy. When a /_uploads/* file is missing from
  // the latest deployment (because a past publish silently dropped it,
  // pre-f8d1fb5 bug), the file usually still exists on an OLDER preview
  // URL — we just have to find it. This walk lists past deployments
  // via the CF API and tries each preview URL until one serves the
  // file. Auto-recovery, no manual re-upload needed.
  //
  // Lazily populated on first miss so we don't burn the API listing
  // call when every image fetches cleanly. Cached so a publish with
  // many missing files only lists deployments once.
  let cfDeploymentsCache: string[] | null = null;
  async function listCfDeploymentPreviewUrls(): Promise<string[]> {
    if (cfDeploymentsCache !== null) return cfDeploymentsCache;
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !apiToken) {
      cfDeploymentsCache = [];
      return cfDeploymentsCache;
    }
    const urls: string[] = [];
    let pageNum = 1;
    while (pageNum <= 20) {
      try {
        const res = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments?page=${pageNum}&per_page=25`,
          { headers: { Authorization: `Bearer ${apiToken}` } },
        );
        if (!res.ok) break;
        const json = (await res.json()) as {
          success?: boolean;
          result?: Array<{ url?: string }>;
        };
        if (!json.success || !json.result || json.result.length === 0) break;
        for (const d of json.result) {
          if (d.url) urls.push(d.url.replace(/\/$/, ""));
        }
        if (json.result.length < 25) break;
        pageNum++;
      } catch {
        break;
      }
    }
    cfDeploymentsCache = urls;
    console.log(
      `[publish] cached ${urls.length} past CF deployments for ${projectName} (history walk available for missing files)`,
    );
    return cfDeploymentsCache;
  }

  /** Try to find an existing /_uploads/* file in older CF deployments.
   *  Returns the bytes on first hit, null after exhausting history. */
  async function tryRecoverFromDeploymentHistory(
    relPath: string,
  ): Promise<{ bytes: Buffer; mimeType: string; foundAt: string } | null> {
    const previewUrls = await listCfDeploymentPreviewUrls();
    // Skip the FIRST entry (it's the current main deploy — already
    // failed, no point retrying). Walk the rest newest-to-oldest.
    for (let i = 1; i < previewUrls.length; i++) {
      const tryUrl = `${previewUrls[i]}${relPath}`;
      try {
        const res = await fetch(tryUrl);
        if (res.ok) {
          const bytes = Buffer.from(await res.arrayBuffer());
          const mimeType =
            res.headers.get("content-type") ?? "application/octet-stream";
          console.log(
            `[publish] auto-recovered ${relPath} from deployment history (${previewUrls[i]})`,
          );
          return { bytes, mimeType, foundAt: previewUrls[i] };
        }
      } catch {
        // try next deployment
      }
    }
    return null;
  }

  /** Retryable HTTP status: 5xx, 408 (timeout), 429 (rate limit). 4xx
   *  other than those are deterministic and won't change on retry. */
  function isRetryableStatus(status: number): boolean {
    return status >= 500 || status === 408 || status === 429;
  }
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  async function fetchAndPrepare(
    fetchUrl: string,
    opts: {
      substituteFrom?: string;
      forcedPath?: string;
      sourceHint?: string;
      /** Set true to skip image optimization. Used for re-bundling files
       *  that were already in a previous deployment — keeping them
       *  byte-identical preserves the URL substitution map and avoids
       *  changing extensions on URLs the user might already have shared. */
      skipOptimize?: boolean;
      /** Return null if the fetched bytes exceed this. Used by the video
       *  migration path: Cloudflare Pages drops any file over 25 MiB
       *  from the deployment, which would deliver a broken `<video>` on
       *  the live site. Returning null leaves the original Supabase URL
       *  in place — the video stays streamable from the staging bucket
       *  even if it can't ride along into Pages. */
      maxBytes?: number;
      /** When true, a final failure (after retries) is collected into
       *  `criticalFetchFailures` and will abort the publish. Used for
       *  `existingUploadPaths` — losing one of those means the new
       *  deployment will ship HTML pointing at /_uploads/* paths that
       *  don't exist in this deployment. Supabase URLs stay non-critical
       *  because the HTML safely falls back to the original Supabase
       *  URL on failure (degraded, but not broken). */
      critical?: boolean;
    },
  ): Promise<Fetched | null> {
    const MAX_ATTEMPTS = 3;
    let lastReason = "unknown";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(fetchUrl);
        if (!res.ok) {
          lastReason = `HTTP ${res.status}`;
          // 4xx (other than 408/429) is deterministic — file genuinely
          // doesn't exist or auth is wrong. Don't burn retries.
          if (!isRetryableStatus(res.status)) {
            break;
          }
          if (attempt < MAX_ATTEMPTS) {
            // Exponential backoff: 500ms, 1s, 2s.
            await sleep(500 * Math.pow(2, attempt - 1));
            continue;
          }
          break;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (typeof opts.maxBytes === "number" && buf.length > opts.maxBytes) {
          // Oversize for the target host — caller falls back gracefully.
          // Not retryable, not critical (Supabase URL stays live).
          return null;
        }
        const mimeType =
          res.headers.get("content-type") ?? "application/octet-stream";
        // Optimize freshly-staged uploads (Supabase URLs) — these are NEW
        // images headed for production for the first time. Existing
        // /_uploads paths are re-bundled as-is to keep URLs stable.
        const final = opts.skipOptimize
          ? {
              bytes: buf,
              mimeType,
              ext: pickExtension(mimeType, opts.sourceHint ?? fetchUrl),
            }
          : await optimizeImage(buf, mimeType, opts.sourceHint ?? fetchUrl);
        const path =
          opts.forcedPath ??
          `_uploads/${sha256Short(final.bytes)}.${final.ext}`;
        return {
          path,
          content: final.bytes,
          contentType: final.mimeType,
          substituteFrom: opts.substituteFrom,
        };
      } catch (err) {
        // Network error / TLS failure / DNS hiccup — always retryable.
        lastReason = err instanceof Error ? err.message : "network error";
        if (attempt < MAX_ATTEMPTS) {
          await sleep(500 * Math.pow(2, attempt - 1));
          continue;
        }
      }
    }
    // Exhausted retries. For critical (existing /_uploads/*) fetches,
    // try the deployment-history walk BEFORE declaring failure — the
    // file is often still alive on an older preview URL.
    if (opts.critical && opts.forcedPath) {
      // forcedPath is the /_uploads/{hash}.{ext} path we're trying to
      // re-bundle. Pass it through the history walker (prepend / to
      // match the URL shape Cloudflare serves).
      const relPath = opts.forcedPath.startsWith("/")
        ? opts.forcedPath
        : `/${opts.forcedPath}`;
      const recovered = await tryRecoverFromDeploymentHistory(relPath);
      if (recovered) {
        // Skip optimization — historical files are already at their
        // final size. forcedPath keeps the URL stable so existing HTML
        // continues to resolve.
        return {
          path: opts.forcedPath,
          content: recovered.bytes,
          contentType: recovered.mimeType,
          substituteFrom: opts.substituteFrom,
        };
      }
      criticalFetchFailures.push({ url: fetchUrl, reason: lastReason });
    } else if (opts.critical) {
      criticalFetchFailures.push({ url: fetchUrl, reason: lastReason });
    } else {
      // Soft failure — log for ops visibility but don't fail the publish.
      // The HTML stays pointing at the original URL; it'll work as long
      // as the Supabase staging file lives.
      console.warn(
        `[publish] soft-failed to re-fetch ${fetchUrl} after retries: ${lastReason}`,
      );
    }
    return null;
  }

  const fetched = await Promise.all([
    ...supabaseUrls
      .filter((u) => !urlSubstitutions.has(u))
      .map((u) =>
        fetchAndPrepare(u, {
          substituteFrom: u,
          sourceHint: u,
          // Mark as critical: if we can't migrate a fresh Supabase upload
          // into the new CF deployment, the live HTML keeps pointing at
          // the Supabase staging URL — AND Phase 6 cleanup then deletes
          // that staging file regardless. End state: broken image on
          // live site, no recovery possible. Loud-fail forces the
          // operator to retry (transient blip auto-heals via retries)
          // or re-upload (genuine failure) BEFORE we ship a broken
          // deploy. Same logic as critical:true for existingUploadPaths.
          critical: true,
        }),
      ),
    // Video migration: same shape as image migration, but skip the
    // sharp/WebP pipeline (video bytes aren't an image format) and
    // gate on the Cloudflare Pages per-file limit. fetchAndPrepare
    // returns null for oversize bytes; the loop below treats null as
    // "no substitution" so the deployed HTML keeps pointing at
    // Supabase for that video — no broken player, no failed deploy.
    ...supabaseVideoUrls
      .filter((u) => !urlSubstitutions.has(u))
      .map((u) =>
        fetchAndPrepare(u, {
          substituteFrom: u,
          sourceHint: u,
          skipOptimize: true,
          maxBytes: CF_PAGES_MAX_FILE_BYTES,
        }),
      ),
    ...existingUploadPaths.map((relPath) =>
      fetchAndPrepare(`${pagesBaseUrl}${relPath}`, {
        forcedPath: relPath.replace(/^\//, ""),
        // Re-bundling a previously-deployed file → preserve bytes
        // verbatim. Optimizing here would change the file size at the
        // same path, breaking deduplication and any external caches
        // that hashed the original bytes.
        skipOptimize: true,
        // Critical: if we lose one of these, the new deployment ships
        // HTML referencing a /_uploads/* path that doesn't exist in
        // this deploy → broken image on the live site. Better to abort
        // the publish and let the operator retry than silently ship a
        // partially-broken site (the "all images Propagating…" failure
        // mode that bit nexedge77 on 2026-05-21).
        critical: true,
      }),
    ),
  ]);

  // Hard-fail if we couldn't re-bundle one or more critical /_uploads/*
  // images. We abort BEFORE the Cloudflare deploy so the live site stays
  // on the previous (working) deployment. The operator gets a clear
  // listing of which images are missing — they can re-upload them in
  // the composer or just click Publish again if it was a transient blip.
  if (criticalFetchFailures.length > 0) {
    const list = criticalFetchFailures
      .map((f) => `  - ${f.url}  (${f.reason})`)
      .join("\n");
    throw new Error(
      `Cannot publish: ${criticalFetchFailures.length} previously-deployed image${
        criticalFetchFailures.length > 1 ? "s" : ""
      } could not be re-fetched from Cloudflare after 3 retries:\n${list}\n\nTry Publish again in a moment — most of these are transient (rate limit, cold cache). If the same file keeps failing, the image was lost from the previous deployment and you'll need to re-upload it in the composer before publishing again.`,
    );
  }

  for (const r of fetched) {
    if (!r) continue;
    if (!imageDeploymentFiles.some((f) => f.path === r.path)) {
      imageDeploymentFiles.push({
        path: r.path,
        content: r.content,
        contentType: r.contentType,
      });
    }
    if (r.substituteFrom) urlSubstitutions.set(r.substituteFrom, `/${r.path}`);
  }

  // Build a substituted composition (deep copy, then replace strings).
  const substitutedComposition =
    urlSubstitutions.size > 0
      ? substituteUrls(originalComposition, urlSubstitutions)
      : originalComposition;

  // Compute the canonical URL upfront so the rendered HTML's <head> can
  // emit absolute og:image / og:url / canonical links AND so the
  // privacy policy / robots / sitemap reference the right hostname.
  // Crawlers (FB, WhatsApp, LinkedIn, Twitter, Slack, Discord) can
  // only fetch og:image when it's an absolute URL — relative
  // `/_uploads/...` paths produce blurry "low quality" share previews
  // because the platform falls back to auto-detecting any tiny inline
  // image on the page.
  //
  // Resolution order — MUST match the friendlyUrl logic in Phase 5
  // (line ~860) so every consumer (privacy.html "controller" line,
  // robots.txt sitemap pointer, sitemap.xml page list, <link
  // rel="canonical">, og:url) agrees with the user-visible site_url
  // saved to the DB:
  //   1. Active custom domain (the client's real .sk) — wins over
  //      every other option. If the user attached a custom domain
  //      and it verified, that's the hostname Google indexes and the
  //      privacy policy must reference.
  //   2. PROPOSAL_DOMAIN subdomain (acme.2dni.sk) — agency fallback.
  //   3. Cloudflare's .pages.dev URL — last resort when neither
  //      custom domain nor PROPOSAL_DOMAIN is configured.
  //
  // The custom-domain CF-registration step itself lives in Phase 4b
  // because it touches Cloudflare's API. The URL is deterministic
  // from the DB columns we already loaded (`site.domain`,
  // `site.domain_status`, `site.domain_setup_status`), so we can
  // compute it here without waiting on CF. If the deploy ends up
  // unable to register the custom domain, the URL is still the right
  // canonical to advertise — the next publish corrects the CF side.
  const customDomainSetupFailedEarly =
    site.domain_setup_status === "failed";
  const customDomainSetupActiveEarly =
    site.domain_setup_status === "active";
  const customDomainLegacyApprovedEarly =
    !site.domain_setup_status && site.domain_status === "active";
  const customDomainActiveEarly =
    !!site.domain &&
    site.domain.length > 0 &&
    !customDomainSetupFailedEarly &&
    (customDomainSetupActiveEarly || customDomainLegacyApprovedEarly);

  const subdomainForUrl =
    site.subdomain ?? sanitizeSubdomain(site.slug || site.id);
  const canonicalSiteUrl = customDomainActiveEarly && site.domain
    ? `https://${site.domain}`
    : PROPOSAL_DOMAIN
      ? `https://${subdomainForUrl}.${PROPOSAL_DOMAIN}`
      : pagesBaseUrl;

  // ── PHASE 3: RENDER — generate HTML using the in-memory composition
  //    (so DB stays untouched until after the deploy succeeds).
  const rendered = await renderSite(siteId, {
    preview: false,
    proposalSlug,
    showBanner,
    compositionOverride: substitutedComposition,
    siteUrl: canonicalSiteUrl,
  });
  if ("error" in rendered) throw new Error(rendered.error);
  if (rendered.pages.length === 0) throw new Error("Composition has no pages");

  // ── PHASE 3b: CRAWL + ERROR + LEGAL FILES ──
  // Generate robots.txt, sitemap.xml, 404.html, and privacy.html alongside
  // the rendered HTML so search engines have a proper entry point,
  // visitors hitting bad URLs get a branded error page instead of
  // Cloudflare's default, and the cookie-bar / footer "Privacy policy"
  // links land on a real GDPR-compliant page instead of a 404.
  //
  //   - robots.txt always emitted (says "stay out" when no_index, or
  //     "come on in + here's the sitemap" otherwise).
  //   - sitemap.xml skipped entirely on noindex'd sites — no point handing
  //     crawlers a list of URLs we just told them to ignore.
  //   - 404.html always emitted, themed to the site's primary + bg colors.
  //   - privacy.html always emitted. The cookie-bar widget asks for
  //     consent + needs a privacy policy explaining what's being
  //     consented to (basic GDPR requirement). Same theming as 404.html.
  //     Company-specific bits (company ID, address) are inline placeholders
  //     the IT guy can edit on the deployed file — composition doesn't yet
  //     carry structured legal fields, and a generic Slovak GDPR page
  //     with placeholders is much better than a 404 (which would itself
  //     be a GDPR violation since cookies-asking-for-consent require a
  //     privacy notice).
  const noIndex = !!substitutedComposition.seo?.no_index;
  // Today's date in YYYY-MM-DD — we ARE publishing right now, so this IS
  // the new lastmod for every page.
  const today = new Date().toISOString().slice(0, 10);

  const crawlFiles: DeploymentFile[] = [
    {
      path: "robots.txt",
      content: buildRobotsTxt({
        siteUrl: canonicalSiteUrl,
        noIndex,
      }),
      contentType: "text/plain; charset=utf-8",
    },
    {
      path: "404.html",
      content: buildNotFoundHtml({
        siteName: site.name,
        theme: substitutedComposition.theme,
      }),
      contentType: "text/html; charset=utf-8",
    },
    {
      path: "privacy.html",
      content: buildPrivacyHtml({
        siteName: site.name,
        siteUrl: canonicalSiteUrl,
        theme: substitutedComposition.theme,
      }),
      contentType: "text/html; charset=utf-8",
    },
  ];
  if (!noIndex) {
    // Build per-page image lists by parsing the rendered HTML of each
    // page. Source of truth = the actual `<img>` tags the visitor will
    // see, not a schema re-walk — that way alt text matches exactly
    // what the renderer wrote (sibling-title fallback + brand-contact
    // overrides + everything else) without re-running the resolution
    // logic. See `extractSitemapImagesFromHtml` for the filter rules.
    const sitemapHomePath = substitutedComposition.pages[0]?.path ?? "index.html";
    const sitemapPages = substitutedComposition.pages
      // Drop per-page noindex pages — they still get the noindex meta tag
      // from the renderer, but listing them in the sitemap would
      // contradict that signal. (Site-level noindex already skipped the
      // whole sitemap above.)
      .filter((compPage) => !mergePageSeo(substitutedComposition.seo, compPage.seo).no_index)
      .map((compPage) => {
        const renderedPage = rendered.pages.find((r) => r.path === compPage.path);
        const images = renderedPage
          ? extractSitemapImagesFromHtml(renderedPage.html, canonicalSiteUrl)
          : [];
        // Emit CLEAN URLs that match the per-page canonical the renderer
        // writes: home → "/", subpage → "/o-nas" (no ".html"). Without
        // this the sitemap listed "/index.html" (priority 0.8, wrong) and
        // "/o-nas.html" while canonical said "/o-nas" — a self-conflicting
        // signal to Google.
        const isHome =
          compPage.path === sitemapHomePath || compPage.path === "index.html";
        const cleanPath = isHome
          ? "/"
          : `/${compPage.path.replace(/\.html$/, "")}`;
        return { path: cleanPath, images };
      });

    crawlFiles.push({
      path: "sitemap.xml",
      content: buildSitemapXml({
        siteUrl: canonicalSiteUrl,
        pages: sitemapPages,
        lastmod: today,
      }),
      contentType: "application/xml; charset=utf-8",
    });
  }

  // ── PHASE 4: DEPLOY (irreversible if it succeeds) ──
  // projectName / pagesBaseUrl already computed in Phase 2.
  await ensureDirectUploadProject(projectName);

  // Cache-Control headers for the deployment. Cloudflare Pages reads a
  // `_headers` file at the deployment root and applies the rules to
  // matching request paths. We set immutable + 1-year max-age on
  // /_uploads/* because filenames are content-hashed (sha256 of the
  // bytes), so a returning visitor can safely reuse the cached image
  // without revalidation. End result: hot pages load images from the
  // browser cache instantly on second visit, even cross-page.
  const headersFile: DeploymentFile = {
    path: "_headers",
    content: Buffer.from(
      "/_uploads/*\n  Cache-Control: public, max-age=31536000, immutable\n",
      "utf8",
    ),
    contentType: "text/plain; charset=utf-8",
  };

  const allFiles: DeploymentFile[] = [
    ...rendered.pages.map((p) => ({
      path: p.path,
      content: p.html,
      contentType: "text/html; charset=utf-8",
    })),
    ...imageDeploymentFiles,
    ...crawlFiles,
    // Widget scripts need to land at the deployment root so the
    // `<script src="/proposal-widget.js">` tags emitted by render.ts
    // actually resolve. Without this the payment banner silently
    // 404s on the live site (was Peter's bug 2026-05-10).
    ...loadWidgetScripts(),
    headersFile,
  ];

  const deploy = await deployFiles(projectName, allFiles);

  // ── PHASE 4b: HOSTNAME MAPPING (best-effort) ──
  //
  // Two possible hostnames to wire at Cloudflare:
  //   (a) Real custom domain (e.g. `balkar.sk`) — the client's owned
  //       .sk. Set up by the dedicated custom-domain pipeline in
  //       custom-domain.ts; we don't (re)create it here, just read
  //       its status.
  //   (b) `*.2dni.sk` fallback subdomain — agency-owned wildcard.
  //       Mapped on every publish via ensureCustomDomain so the site
  //       has a stable URL even before the client buys their domain.
  //
  // Once the custom domain reaches `active` the custom-domain pipeline
  // calls removeSubdomainRouting() to drop the (b) mapping — the
  // subdomain has done its job and a paid client deserves to see only
  // their own brand in every "Live at" surface. So when we detect an
  // active custom domain HERE, we ALSO skip re-creating the subdomain
  // routing (the pipeline just removed it, no point re-adding).
  //
  // "Active" matches the same gate the SubdomainEditor uses
  // ([/api/sites/[id]/subdomain GET]) so the back-end and the UI agree
  // on when the subdomain disappears.
  const customDomainSetupFailed = site.domain_setup_status === "failed";
  const customDomainSetupActive = site.domain_setup_status === "active";
  const customDomainLegacyApproved =
    !site.domain_setup_status && site.domain_status === "active";
  const customDomainActive =
    !!site.domain &&
    site.domain.length > 0 &&
    !customDomainSetupFailed &&
    (customDomainSetupActive || customDomainLegacyApproved);

  let subdomainHostname: string | null = null;
  let subdomainPersisted = site.subdomain ?? null;
  if (!customDomainActive && PROPOSAL_DOMAIN) {
    const subdomain = site.subdomain ?? sanitizeSubdomain(site.slug || site.id);
    const desired = `${subdomain}.${PROPOSAL_DOMAIN}`;
    const ok = await ensureCustomDomain(projectName, desired);
    if (ok) {
      subdomainHostname = desired;
      // Persist the subdomain so future publishes don't re-derive (and so
      // the editable UI can read + change it from a known-stable value).
      if (!site.subdomain) {
        const { error: subErr } = await admin
          .from("sites")
          .update({ subdomain })
          .eq("id", siteId);
        if (subErr) {
          console.error(
            "[publish] subdomain persist failed (subdomain still works on CF):",
            subErr,
          );
        } else {
          subdomainPersisted = subdomain;
        }
      }
    }
  }

  // ── PHASE 5: COMMIT TO DB — only after deploy succeeds ──
  // 1. Save the substituted composition (so future renders + reverts use
  //    the cleaned-up URLs, not the dead pending: markers).
  // 2. Insert the version snapshot.
  // 3. Update last_published_at + site_url.
  //
  // Choose the most user-friendly URL for `site_url`:
  //   1. Verified custom domain (the client's real .sk — wins over
  //      the agency fallback so every "Live at" surface shows the
  //      client's brand, not balkar.2dni.sk).
  //   2. `*.{PROPOSAL_DOMAIN}` subdomain that was just registered THIS
  //      publish (subdomainHostname is non-null only when we ran
  //      ensureCustomDomain on the subdomain above).
  //   3. Already-configured subdomain — when ensureCustomDomain wasn't
  //      called or returned false this time but `subdomainPersisted`
  //      is set, CF still has the mapping from a previous successful
  //      publish/subdomain-change. The user-visible URL is still
  //      serving; don't downgrade site_url to .pages.dev and let
  //      composer/CRM forget the configured subdomain. (Skip this
  //      when the custom domain is active — the subdomain was just
  //      removed from CF by the custom-domain pipeline; pointing
  //      site_url at it would 404 client visits.)
  //   4. Cloudflare's .pages.dev URL — last resort.
  const pagesUrl = pagesBaseUrl;
  let friendlyUrl: string;
  if (customDomainActive && site.domain) {
    friendlyUrl = `https://${site.domain}`;
  } else if (subdomainHostname) {
    friendlyUrl = `https://${subdomainHostname}`;
  } else if (subdomainPersisted && PROPOSAL_DOMAIN && !customDomainActive) {
    friendlyUrl = `https://${subdomainPersisted}.${PROPOSAL_DOMAIN}`;
  } else {
    friendlyUrl = pagesUrl;
  }

  if (urlSubstitutions.size > 0) {
    const { error: compErr } = await admin
      .from("sites")
      .update({ composition: substitutedComposition })
      .eq("id", siteId);
    if (compErr) {
      // Don't throw — the deploy is live and that's what matters most. Log
      // loudly so we can recover manually. The next publish will redo this
      // substitution from whichever URLs still need migration.
      console.error(
        "[publish] composition update failed AFTER successful deploy:",
        compErr,
      );
    }
  }

  // Silent publishes (e.g. the banner config / disable dialogs'
  // auto-republish) skip the version snapshot — they don't change
  // the composition, only flip the show_banner flag (and adjust
  // pricing on the proposal row), so a history entry would be
  // noise. The deploy still happens; the version row is what gets
  // omitted.
  let version: { id: string } | null = null;
  if (!options?.silent) {
    const { data: insertedVersion, error: versionErr } = await admin
      .from("site_versions")
      .insert({
        site_id: siteId,
        composition: substitutedComposition,
        reason,
        created_by: userId,
        deployment_url: deploy.url,
      })
      .select("id")
      .single();
    if (versionErr) {
      console.error(
        "[publish] site_versions insert failed AFTER successful deploy:",
        versionErr,
      );
      throw new Error(
        `Deploy succeeded but version record failed: ${versionErr.message}`,
      );
    }
    version = insertedVersion;
  }

  await admin
    .from("sites")
    .update({
      last_published_at: new Date().toISOString(),
      site_url: friendlyUrl,
    })
    .eq("id", siteId);

  // ── PHASE 6: STAGING CLEANUP — delete the Supabase composer-staging
  //    files we just copied into Cloudflare. These bytes now live on
  //    the deployment as /_uploads/{hash}.{ext}, so the staging copy is
  //    redundant. Skipping this would gradually fill the staging bucket
  //    with files that already shipped — cheap to fix here, expensive
  //    to track down later.
  //
  //    Best-effort: any individual delete failure is logged but doesn't
  //    block the publish from succeeding. The deploy IS live, the DB
  //    points at /_uploads/, and the worst case is a few extra files
  //    in staging the periodic cleanup will sweep.
  //
  //    Only delete URLs that are actually composer-staging URLs — older
  //    sites might have URLs from arbitrary supabase.co buckets we
  //    shouldn't touch (legacy migration paths).
  // ONLY delete staging files we successfully migrated to /_uploads/*.
  // Without this guard, a partial-substitution publish (some URLs
  // migrated, others soft-failed) would still delete every staging
  // file referenced by composition — leaving the live HTML pointing
  // at Supabase URLs whose files we just removed. Same bug class as
  // the silent-skip on fetch failure; the critical:true gate on the
  // Supabase fetch above should make this path unreachable (any miss
  // throws before we reach Phase 6), but the filter is belt-and-
  // suspenders for any future path that bypasses the critical gate.
  const stagedToCleanup = supabaseUrls.filter(
    (url) =>
      /\/storage\/v1\/object\/public\/composer-staging\//.test(url) &&
      urlSubstitutions.has(url),
  );
  if (stagedToCleanup.length > 0) {
    // Convert public URLs back to bucket-relative paths for the
    // storage delete API. Each URL is shaped like:
    //   https://<project>.supabase.co/storage/v1/object/public/composer-staging/<site_id>/<uuid>.<ext>
    const objectPaths: string[] = [];
    for (const url of stagedToCleanup) {
      const m = url.match(
        /\/storage\/v1\/object\/public\/composer-staging\/(.+)$/,
      );
      if (m && m[1]) objectPaths.push(m[1]);
    }
    if (objectPaths.length > 0) {
      const { error: rmErr } = await admin.storage
        .from("composer-staging")
        .remove(objectPaths);
      if (rmErr) {
        console.warn(
          "[publish] staging cleanup partial failure (deploy already live, files orphaned in staging):",
          rmErr.message,
        );
      }
    }
  }

  // Video cleanup mirrors the image cleanup above, but is gated on
  // urlSubstitutions: a composer-video URL gets a substitution ONLY
  // when its bytes fit under Cloudflare Pages' 25 MiB cap and were
  // bundled into the deployment. Those Supabase copies are now
  // redundant — delete them. Videos that DIDN'T get a substitution
  // (too big to migrate) stay in composer-video because Supabase is
  // still the live source the deployed page points at; deleting them
  // would 404 the <video> on the live site.
  const migratedVideosToCleanup = supabaseVideoUrls.filter((url) =>
    urlSubstitutions.has(url),
  );
  if (migratedVideosToCleanup.length > 0) {
    const objectPaths: string[] = [];
    for (const url of migratedVideosToCleanup) {
      const m = url.match(
        /\/storage\/v1\/object\/public\/composer-video\/(.+)$/,
      );
      if (m && m[1]) objectPaths.push(m[1]);
    }
    if (objectPaths.length > 0) {
      const { error: rmErr } = await admin.storage
        .from("composer-video")
        .remove(objectPaths);
      if (rmErr) {
        // Same posture as the staging cleanup: log + continue. The
        // deploy is live, the live HTML points at CF Pages, and the
        // worst case is a paid-but-unreferenced video in composer-
        // video that the future orphan-cleanup task will sweep.
        console.warn(
          "[publish] composer-video cleanup partial failure (migrated to Pages, originals orphaned in Supabase):",
          rmErr.message,
        );
      }
    }
  }

  // ── PHASE 7: CACHE WARMING — HEAD-request every /_uploads/* path
  //    on the just-published pages.dev URL so Cloudflare's nearest
  //    edges fetch the bytes from R2 before the composer iframe
  //    reloads and asks for them.
  //
  //    The bug this fixes: even on a republish where no image bytes
  //    changed, each CF Pages deploy is fully independent and
  //    re-ships every file. The new deploy's origin (R2) has the
  //    files immediately, but every edge worldwide misses on its
  //    first hit and has to fetch-then-cache. During that window the
  //    composer iframe shows `Propagating…` placeholders for every
  //    image even though the live site is fine. Warming the edges
  //    here from the server collapses that flash to ~zero in the
  //    operator's region — they're the only person looking at the
  //    composer right after publish anyway.
  //
  //    Best-effort: any individual failure is swallowed. We cap the
  //    whole batch at 5s so a slow CF response can't hold the publish
  //    response hostage. Fire HEAD (not GET) so we don't pay for the
  //    body bytes — CF still primes the cache the same way.
  //
  //    Skipped when there are no /_uploads/* files to warm (e.g. an
  //    early publish with no images yet) so we don't burn the timeout
  //    on a no-op.
  const uploadPaths = imageDeploymentFiles
    .map((f) => f.path)
    .filter((p) => p.startsWith("_uploads/"));
  if (uploadPaths.length > 0) {
    const warmController = new AbortController();
    const warmTimeout = setTimeout(() => warmController.abort(), 5000);
    try {
      await Promise.allSettled(
        uploadPaths.map((relPath) =>
          fetch(`${pagesBaseUrl}/${relPath}`, {
            method: "HEAD",
            signal: warmController.signal,
            // CF picks the closest edge to the server; we don't care
            // which one, we just need ONE to pull the bytes from R2.
            cache: "no-store",
          }).catch(() => {
            /* swallowed — warm is best-effort */
          }),
        ),
      );
    } finally {
      clearTimeout(warmTimeout);
    }
  }

  return {
    url: deploy.url,
    pagesUrl,
    friendlyUrl,
    // customDomain in the result type carries the REAL custom domain
    // (when active) — same shape the API consumers expect. If only
    // the *.2dni.sk subdomain is mapped, this is null.
    customDomain: customDomainActive && site.domain ? site.domain : null,
    subdomain: subdomainPersisted,
    deploymentId: deploy.deploymentId,
    pageCount: rendered.pages.length,
    versionId: version?.id ?? null,
    substitutions: Object.fromEntries(urlSubstitutions),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sanitizeProjectName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 58); // CF limit is 58 chars
}

/**
 * Walk a rendered page's HTML and return every content `<img>` as a
 * sitemap entry. Used by the image-sitemap pass to feed Google Image
 * Search with absolute URLs + alt-text captions.
 *
 * Filters applied (mirrors what a human would consider "page content
 * worth indexing in Image Search"):
 *
 *   - Brand logos (`[data-field="nav_logo"]`, `[data-field="footer_logo"]`)
 *     are skipped. Branding marks aren't content photos; Google Image
 *     Search shouldn't surface them as standalone results, and they'd
 *     repeat across every page making the sitemap noisy.
 *
 *   - Empty `src`, data: URIs, and placehold.co URLs are skipped.
 *     Placeholders are template-default scaffolding the client hasn't
 *     swapped yet — surfacing them in Google would be embarrassing
 *     for the agency. Data URIs (the brand-mark auto-generated SVG)
 *     also can't be Google-indexed as standalone images.
 *
 *   - Per-page deduplication. Same image used in two sections on one
 *     page → one entry only. Google's docs explicitly recommend this:
 *     "We recommend listing each image at most once per page."
 *
 * URL resolution: `/_uploads/...` paths get prefixed with the
 * canonical site URL (custom domain or 2dni.sk subdomain or pages.dev
 * fallback — whatever was decided in Phase 2). Absolute http(s) URLs
 * pass through unchanged.
 *
 * Cheerio is already a dependency (parser.ts uses it heavily); using
 * it here keeps publish.ts free of regex-on-HTML traps.
 */
function extractSitemapImagesFromHtml(
  html: string,
  siteUrl: string,
): SitemapImage[] {
  const base = siteUrl.replace(/\/$/, "");
  const $ = loadCheerio(html, { xmlMode: false });
  const out: SitemapImage[] = [];
  const seen = new Set<string>();

  $("img").each((_i, raw) => {
    const $img = $(raw);
    const dataField = $img.attr("data-field") || "";

    // Brand logos — skip. nav_logo + footer_logo are the only
    // conventional brand-mark slots in the catalog.
    if (dataField === "nav_logo" || dataField === "footer_logo") return;

    const rawSrc = ($img.attr("src") || "").trim();
    if (!rawSrc) return;
    if (rawSrc.startsWith("data:")) return;
    // placehold.co covers the entire placeholder URL family in the
    // template defaults (e.g. https://placehold.co/640x480/...). Any
    // other CDN that legitimately starts with "placehold" is unlikely
    // — accept the false-positive risk in favor of a simpler match.
    if (rawSrc.includes("placehold.co")) return;

    // Resolve to absolute URL.
    let loc: string;
    if (/^https?:\/\//i.test(rawSrc)) {
      loc = rawSrc;
    } else if (rawSrc.startsWith("/")) {
      loc = `${base}${rawSrc}`;
    } else {
      // Relative path without leading slash — rare in the catalog but
      // possible. Treat as relative to the site root.
      loc = `${base}/${rawSrc}`;
    }

    if (seen.has(loc)) return;
    seen.add(loc);

    const altRaw = $img.attr("alt");
    const caption = typeof altRaw === "string" ? altRaw.trim() : "";

    out.push(caption ? { loc, caption } : { loc });
  });

  return out;
}

/** Mirror of validateSubdomainFormat in subdomain.ts: lowercase a-z0-9 +
 *  hyphens, 3-50 chars, no leading/trailing hyphens. Used for the auto-
 *  derive case (sales hasn't picked one yet) so we don't depend on a
 *  separately-maintained validator inside this module. */
function sanitizeSubdomain(s: string): string {
  const cleaned = s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  // Minimum 3 chars — pad with the literal "site" so we never produce an
  // invalid subdomain. Edge case for very short slugs.
  return cleaned.length >= 3 ? cleaned : `site-${cleaned}`.slice(0, 50);
}

// ── Image optimization ─────────────────────────────────────────────────────
//
// Run every newly-uploaded image through sharp at publish time, but
// preserve native dimensions — Peter prioritized quality over deploy
// size. Pipeline:
//   1. NO dimension cap (changed 2026-05-13). Originally we resized
//      anything over 2000px on the longest side; users found the
//      downsample visible on detailed photos shown at hero/full-bleed
//      sizes. Now every image ships at its native resolution. Bigger
//      payloads, but zero loss from resampling.
//   2. Re-encode to WebP at quality 95. We previously used 82, which
//      the WebP literature calls "no perceptible loss" — but users
//      consistently reported visible softness on detailed photos and
//      text-bearing graphics. Bumped to 95 (near-lossless: artifacts
//      invisible to the eye in side-by-side comparison) on 2026-05-12.
//
// Trade-off accepted: a single 4000×3000 phone photo at WebP 95 with
// no resize lands ~1.5-2.5 MB. Compare to the same image resampled
// down to 2000px (~400-600 KB). Page load is slower; quality is
// pixel-perfect. If page weight becomes a real complaint, the right
// next move is per-section dimension hints (hero ⇒ wider, gallery
// item ⇒ smaller) rather than a global cap.
//
// Skip cases:
//   - SVG: vectors, sharp doesn't help (rasterising would HURT). Ship as-is.
//   - GIF: might be animated. Sharp's WebP conversion drops animation.
//     Ship as-is.
//   - Already-deployed /_uploads paths: keep extension stable so the URL
//     substitution map stays consistent across re-publishes (caller
//     passes `skipOptimize: true` for these).
//   - Optimization makes file BIGGER: rare (already-optimized PNG, tiny
//     icons), but if it happens we use the original to avoid waste.
//
// (No-op pipeline as of 2026-05-13 — see comment inside optimizeImage.)
interface OptimizedImage {
  bytes: Buffer;
  mimeType: string;
  ext: string;
}

async function optimizeImage(
  buf: Buffer,
  mimeType: string,
  sourceHint?: string,
): Promise<OptimizedImage> {
  // SVGs and animated GIFs bypass — see comment above.
  if (mimeType === "image/svg+xml") {
    return { bytes: buf, mimeType, ext: "svg" };
  }
  if (mimeType === "image/gif") {
    return { bytes: buf, mimeType, ext: "gif" };
  }
  // ── Per Peter 2026-05-13 (third request): publish ships the user's
  //    uploaded bytes UNTOUCHED. ──
  // We previously ran every image through sharp.webp({ quality: 95 })
  // to halve file sizes with imperceptible quality loss. Users
  // consistently reported the result looked softer than the source
  // file they could see in Finder/Explorer, even though A/B testing
  // showed no visible loss. Trust the user's perception — they're
  // looking at zoomed-in detail of their own work, we're not. From
  // now on:
  //   · JPEG stays JPEG, PNG stays PNG, WebP stays WebP, etc.
  //   · No re-encode, no quality knob, no format conversion.
  //   · Identical bytes ship to Cloudflare = identical quality.
  // The trade-off accepted: page payload is larger. A 5MB phone
  // photo lands as 5MB instead of ~800KB. If page weight becomes
  // a real complaint, the right next move is per-image dimension
  // hints (hero ⇒ wider, gallery thumb ⇒ smaller) rather than a
  // global quality knob.
  return {
    bytes: buf,
    mimeType,
    ext: pickExtension(mimeType, sourceHint),
  };
}

function isPendingMarker(s: string): boolean {
  return s.startsWith("pending:");
}

/** Relative path to an asset bundled by a previous publish. Matches things
 *  like "/_uploads/abcdef.png" so we can re-fetch and re-bundle them into
 *  the new deployment (each CF Pages deploy is independent). */
function isExistingUploadPath(s: string): boolean {
  return s.startsWith("/_uploads/");
}

function isSupabaseUrl(s: string): boolean {
  // Match any *.supabase.co host EXCEPT the composer-video bucket.
  // Videos have their own migration path (see isSupabaseVideoUrl) that
  // skips image-only steps like sharp/WebP re-encoding.
  if (/\/storage\/v1\/object\/public\/composer-video\//.test(s)) return false;
  return /https?:\/\/[a-zA-Z0-9-]+\.supabase\.co\//.test(s);
}

/** True for composer-video bucket public URLs. Used by publish to route
 *  video assets through their own migration branch — fetch original
 *  bytes, skip image optimization, and bundle into Cloudflare Pages
 *  when the file fits under the per-file size cap. */
function isSupabaseVideoUrl(s: string): boolean {
  return /\/storage\/v1\/object\/public\/composer-video\//.test(s);
}

/** Cloudflare Pages enforces a per-file cap of 25 MiB. Anything over is
 *  silently dropped from the deployment, which would deliver a broken
 *  <video> on the live site. We check the fetched byte length against
 *  this threshold and fall back to leaving the original Supabase URL
 *  in place for oversize videos. */
const CF_PAGES_MAX_FILE_BYTES = 26_214_400; // 25 MiB

/** Walk a composition value and collect every string that matches `predicate`. */
function collectMatching(
  comp: unknown,
  predicate: (s: string) => boolean,
): string[] {
  const out = new Set<string>();
  walk(comp);
  return [...out];

  function walk(n: unknown) {
    if (typeof n === "string") {
      if (predicate(n)) out.add(n);
      return;
    }
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const item of n) walk(item);
      return;
    }
    for (const v of Object.values(n)) walk(v);
  }
}

/** Deep copy + replace any string that's a key in `subs`. */
function substituteUrls(
  comp: SiteComposition,
  subs: Map<string, string>,
): SiteComposition {
  return walk(comp) as SiteComposition;

  function walk(n: unknown): unknown {
    if (typeof n === "string") return subs.get(n) ?? n;
    if (!n || typeof n !== "object") return n;
    if (Array.isArray(n)) return n.map(walk);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n)) out[k] = walk(v);
    return out;
  }
}

function sha256Short(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, 32);
}

/**
 * Decide the file extension for a deployment asset. Prefers MIME type,
 * falls back to inferring from the filename / URL extension.
 */
function pickExtension(mimeType: string, hint?: string): string {
  const fromMime: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "image/x-icon": "ico",
    "image/vnd.microsoft.icon": "ico",
    "image/avif": "avif",
  };
  const m = mimeType.toLowerCase().split(";")[0]?.trim();
  if (m && fromMime[m]) return fromMime[m];

  if (hint) {
    const dot = hint.lastIndexOf(".");
    if (dot !== -1) {
      const ext = hint
        .slice(dot + 1)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 5);
      if (ext && ext.length <= 5) return ext;
    }
  }
  return "bin";
}

// Composition types re-export for callers
export type { SiteComposition };
