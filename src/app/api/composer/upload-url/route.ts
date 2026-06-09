/**
 * Composer direct-upload URL issuer.
 *
 * Why this exists:
 *   The legacy `/api/composer/upload` route accepts the file body and
 *   proxies it to Supabase Storage. That makes every byte travel
 *   through a Vercel serverless function — and Vercel caps the request
 *   body at 4.5 MB on Hobby and ~10 MB on Pro before our code ever
 *   runs. Anything bigger silently 413s at the edge, breaking uploads
 *   of raw camera photos and making video uploads impossible on any
 *   tier we'd realistically pay for.
 *
 * The fix is the standard pattern: the browser asks this route for a
 * short-lived signed upload URL, then PUTs the bytes straight to
 * Supabase. The function only ever ships small JSON — no body cap, no
 * per-invocation compute cost scaling with file size.
 *
 * Flow:
 *   1. Browser → POST /api/composer/upload-url with { site_id, mime_type, size, filename? }
 *   2. Server validates auth + ownership + mime, then asks Supabase
 *      Storage for a one-shot signed upload URL bound to a specific
 *      bucket path.
 *   3. Server returns { signed_url, token, path, public_url }.
 *   4. Browser uploads bytes directly to Supabase via the SDK's
 *      `uploadToSignedUrl(path, token, file)` (see image-store.ts).
 *   5. Browser uses `public_url` as the canonical reference in
 *      composition state. Same shape the publish flow already knows
 *      how to migrate to Cloudflare.
 *
 * The legacy POST handler at `/api/composer/upload` still exists for
 * older callers / fallback — its DELETE handler is the canonical
 * staging-file remover and is unchanged.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteAdminForSite } from "@/lib/platform/site-admin-guard";

/** Per-kind size + bucket + mime configuration. Image cap (25 MB)
 *  mirrors the bucket from migration 00055; video cap (200 MB) mirrors
 *  migration 00062. Keep these three numbers (client MAX_*_BYTES, this
 *  route, the storage bucket) in lockstep. */
interface UploadKindConfig {
  bucket: string;
  maxBytes: number;
  mimeToExt: Record<string, string>;
  label: string;
}

const KIND_CONFIG: Record<"image" | "video", UploadKindConfig> = {
  image: {
    bucket: "composer-staging",
    maxBytes: 25 * 1024 * 1024,
    label: "Image",
    mimeToExt: {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/svg+xml": "svg",
      "image/avif": "avif",
    },
  },
  video: {
    bucket: "composer-video",
    maxBytes: 200 * 1024 * 1024,
    label: "Video",
    mimeToExt: {
      "video/mp4": "mp4",
      "video/webm": "webm",
      "video/quicktime": "mov",
      "video/x-matroska": "mkv",
    },
  },
};

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let body: {
    site_id?: unknown;
    mime_type?: unknown;
    size?: unknown;
    filename?: unknown;
    /** "image" (default) or "video". Routes the signed URL to the
     *  correct bucket with the correct size + mime gate. */
    kind?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const siteId = typeof body.site_id === "string" ? body.site_id : "";
  const mimeType = typeof body.mime_type === "string" ? body.mime_type : "";
  const size = typeof body.size === "number" ? body.size : NaN;
  const kind = body.kind === "video" ? "video" : "image";
  const config = KIND_CONFIG[kind];

  if (!siteId || !mimeType || !Number.isFinite(size)) {
    return NextResponse.json(
      { error: "Missing site_id, mime_type, or size" },
      { status: 400 },
    );
  }
  if (size > config.maxBytes) {
    return NextResponse.json(
      {
        error: `${config.label} too large (${(size / 1024 / 1024).toFixed(1)} MB). Max ${config.maxBytes / 1024 / 1024} MB.`,
      },
      { status: 413 },
    );
  }

  const ext = config.mimeToExt[mimeType];
  if (!ext) {
    return NextResponse.json(
      { error: `Unsupported ${config.label.toLowerCase()} type: ${mimeType || "unknown"}` },
      { status: 415 },
    );
  }

  const admin = createAdminClient();

  // Auth + ownership. Per-site CMS admins (theirdomain.com/admin) have no
  // Supabase session — authorize them for THEIR OWN site only (the guard binds
  // the session to siteId). Everyone else goes through the same role matrix as
  // the legacy upload route — keep these two routes in sync.
  if (!user) {
    const sa = await getSiteAdminForSite(siteId);
    if (!sa) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else {
    const role = (user.app_metadata?.role as string | undefined) ?? "unknown";
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
          return NextResponse.json({ error: "Site not found" }, { status: 404 });
        }
        if (ownerRow.owner_id !== user.id) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
      } else {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
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

  const { data: signed, error: signedErr } = await admin.storage
    .from(config.bucket)
    .createSignedUploadUrl(objectPath);

  if (signedErr || !signed) {
    return NextResponse.json(
      { error: `Could not issue upload URL: ${signedErr?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  // Pre-compute the public URL the file will live at after upload so
  // the client can plug it straight into composition without a round-
  // trip back to get it.
  const { data: publicData } = admin.storage
    .from(config.bucket)
    .getPublicUrl(objectPath);

  return NextResponse.json({
    signed_url: signed.signedUrl,
    token: signed.token,
    path: signed.path,
    public_url: publicData.publicUrl,
    bucket: config.bucket,
  });
}
