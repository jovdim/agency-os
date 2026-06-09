/**
 * Composer image upload — multipart file in, public Supabase URL out.
 *
 * Replaces the old IndexedDB-only "pending image" flow. Now every
 * composer upload (logo, hero image, gallery item, etc.) lands in the
 * `composer-staging` bucket immediately, so:
 *   - Cross-device edits work (laptop upload visible on phone)
 *   - Cross-role previews work (client can see what IT just uploaded
 *     before publish)
 *   - Publish from any device works (no longer tied to the uploader's
 *     IndexedDB)
 *
 * Files are deleted from staging at publish time (publish.ts copies
 * them to Cloudflare and then nukes the staging copy), so steady-state
 * storage usage tracks "in-progress edits", not "all uploads ever".
 *
 * Auth + ownership:
 *   - Authenticated users only (RLS on the bucket also enforces this).
 *   - tech_admin / super_admin can upload to any site.
 *   - sales can upload to a site IFF they own the linked proposal —
 *     added 2026-05-10 so the shared composer at
 *     /sales/proposals/[id]/composer can stage images same as /tech.
 *   - client can only upload to sites they own (matches the same rule
 *     used by PUT /api/sites/[id]).
 *   - Other roles → 403.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isR2PublicUrl, deleteR2Object, r2ObjectPathFromUrl } from "@/lib/platform/r2";
import { canAccessSiteMedia } from "@/lib/platform/upload-auth";

/** Mirror the bucket-level cap so we fail fast with a friendly message
 *  before the storage layer rejects with a generic 413. Bumped from
 *  8 MB to 25 MB on 2026-05-09 so unedited camera shots can land in
 *  staging. publish.ts still optimizes everything down before
 *  shipping to Cloudflare. */
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

/** Path-safe extension lookup. We trust the MIME type more than the
 *  filename's extension because the file picker can hand us any string,
 *  but Storage's allowed_mime_types is the real gate. */
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = (user.app_metadata?.role as string | undefined) ?? "unknown";

  // Multipart parse — Next.js gives us FormData natively.
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const file = form.get("file");
  const siteId = form.get("site_id");
  if (!(file instanceof File) || typeof siteId !== "string" || !siteId) {
    return NextResponse.json(
      { error: "Missing file or site_id" },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: `Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 25 MB.`,
      },
      { status: 413 },
    );
  }

  const ext = MIME_TO_EXT[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: `Unsupported image type: ${file.type || "unknown"}` },
      { status: 415 },
    );
  }

  const admin = createAdminClient();

  // Ownership check.
  //
  //   tech_admin / super_admin → any site.
  //   sales → site whose linked proposal they own.
  //   client → only sites they own (site.owner_id === user.id).
  //   anything else → 403.
  if (!["tech_admin", "super_admin"].includes(role)) {
    if (role === "sales") {
      const { data: siteRow } = await admin
        .from("sites")
        .select("proposal_id")
        .eq("id", siteId)
        .maybeSingle();
      if (!siteRow?.proposal_id) {
        return NextResponse.json({ error: "Site not found" }, { status: 404 });
      }
      const { data: linkedProposal } = await admin
        .from("proposals")
        .select("sales_person_id")
        .eq("id", siteRow.proposal_id)
        .maybeSingle();
      if (!linkedProposal || linkedProposal.sales_person_id !== user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else if (role === "client") {
      const { data: ownerRow, error: ownerErr } = await admin
        .from("sites")
        .select("owner_id")
        .eq("id", siteId)
        .maybeSingle();
      if (ownerErr || !ownerRow) {
        return NextResponse.json(
          { error: "Site not found" },
          { status: 404 },
        );
      }
      if (ownerRow.owner_id !== user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Path: {site_id}/{uuid}.{ext}. Per-site prefix lets the publish
  // cleanup + future orphan cleanup query by prefix instead of walking
  // the whole bucket.
  const uuid =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const objectPath = `${siteId}/${uuid}.${ext}`;

  // Hand the File to Supabase Storage. We pass the underlying bytes
  // (ArrayBuffer) rather than the File object directly because the
  // server-side supabase-js client serializes File instances oddly in
  // some Node versions — ArrayBuffer is rock solid.
  const bytes = await file.arrayBuffer();
  const { error: uploadErr } = await admin.storage
    .from("composer-staging")
    .upload(objectPath, bytes, {
      contentType: file.type,
      // No upsert: each upload gets a fresh UUID, collisions are 1-in-2^122.
      upsert: false,
      cacheControl: "3600",
    });

  if (uploadErr) {
    return NextResponse.json(
      { error: `Upload failed: ${uploadErr.message}` },
      { status: 500 },
    );
  }

  // Public URL — bucket is `public: true` so this resolves without
  // signed-URL machinery. Same URL the iframe will use to render the
  // image and the same URL the publish flow will fetch from.
  const { data } = admin.storage
    .from("composer-staging")
    .getPublicUrl(objectPath);

  return NextResponse.json({
    url: data.publicUrl,
    path: objectPath, // returned so the cleanup-on-replace path can delete the old object
  });
}

/**
 * DELETE /api/composer/upload?url=<encoded supabase URL>
 *
 * Removes a single staged image. Used by the composer when:
 *   - A user replaces an image (delete the previous file).
 *   - An upload completes but is then immediately superseded by a
 *     newer pick (abort race: A landed at Supabase right before the
 *     user picked B).
 *   - A user resets a custom logo back to auto.
 *
 * Best-effort: if the file isn't there or already gone, returns 200
 * anyway. Caller is expected to fire-and-forget — a failed delete just
 * leaves an orphan in staging that the future cleanup task will sweep.
 *
 * Path safety: we extract the relative path from the public URL and
 * verify it's under the composer-staging bucket before issuing the
 * delete. Without this guard, a malicious caller could pass a URL
 * pointing at any other bucket and we'd happily delete it.
 */
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // NOTE: a missing Supabase session is NOT an automatic 401 here — per-site
  // CMS admins (theirdomain.com/admin) have no Supabase user and must be able
  // to clean up their own replaced media. Authorization happens below, per
  // site, via canAccessSiteMedia (which handles both auth models).

  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  // Resolve which backend + object the URL points at, and the site_id embedded
  // in the key, so we can authorize on that site_id BEFORE deleting anything.
  // Keys: R2 = images|videos/{siteId}/{uuid}.ext ; Supabase = {siteId}/{uuid}.ext.
  let backend: "r2" | "supabase" | null = null;
  let bucket: "composer-staging" | "composer-video" | null = null;
  let objectPath: string | null = null;
  let siteId = "";

  if (isR2PublicUrl(url)) {
    backend = "r2";
    const key = r2ObjectPathFromUrl(url) ?? "";
    siteId = key.split("/")[1] ?? ""; // images|videos / <siteId> / <uuid>.ext
  } else {
    const stagingMatch = url.match(
      /\/storage\/v1\/object\/public\/composer-staging\/(.+)$/,
    );
    const videoMatch = url.match(
      /\/storage\/v1\/object\/public\/composer-video\/(.+)$/,
    );
    if (stagingMatch?.[1]) {
      backend = "supabase";
      bucket = "composer-staging";
      objectPath = stagingMatch[1];
    } else if (videoMatch?.[1]) {
      backend = "supabase";
      bucket = "composer-video";
      objectPath = videoMatch[1];
    }
    siteId = objectPath?.split("/")[0] ?? ""; // <siteId> / <uuid>.ext
  }

  // Unrecognized URL (not one of our buckets / not an R2 public asset) — reject
  // rather than letting this become a generic file-delete primitive.
  if (!backend || !siteId) {
    return NextResponse.json(
      { error: "URL is not a recognized composer media file" },
      { status: 400 },
    );
  }

  // Per-site ownership gate — the caller must own / administer THIS site. Without
  // it, any authenticated user could delete another tenant's live media just by
  // passing its (publicly visible) URL.
  if (!(await canAccessSiteMedia(siteId, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Best-effort delete — an already-gone object is the same post-condition the
  // caller wants, so we don't surface remove errors.
  if (backend === "r2") {
    const ok = await deleteR2Object(url);
    return NextResponse.json({ ok });
  }
  const admin = createAdminClient();
  await admin.storage.from(bucket!).remove([objectPath!]);
  return NextResponse.json({ ok: true });
}
