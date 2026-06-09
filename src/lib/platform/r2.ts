import crypto from "node:crypto";

/**
 * Cloudflare R2 object storage — image/media uploads for client sites.
 *
 * Why R2 (vs the Supabase `composer-staging` bucket): R2 has **zero egress
 * fees** and sits behind Cloudflare's CDN, so a published site's images are
 * served to every visitor for free, cached at the edge — the origin (R2) is
 * touched once per image, then never again. That's the property that makes
 * image-heavy public sites cheap and DDoS-resilient at 1000+ sites.
 *
 * R2 speaks the S3 API, so we presign upload/delete URLs with AWS SigV4. We
 * hand-roll SigV4 with Node's built-in crypto (same dependency-free approach as
 * site-session.ts) rather than pulling in the AWS SDK — one focused module, no
 * new packages, and portable to any Node/Edge host.
 *
 * EVERYTHING here is env-gated by `r2Configured()`. When R2 env vars are absent
 * the whole platform falls back to Supabase Storage unchanged, so this can ship
 * dark and light up the moment the bucket + keys exist.
 *
 * Node-only (uses node:crypto + presigned S3 requests). Call from route
 * handlers / server components, never the Edge middleware.
 */

const REGION = "auto"; // R2 ignores region but SigV4 requires one; "auto" is canonical for R2.
const SERVICE = "s3";

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Public base URL the objects are served from (a custom domain on the
   *  bucket, routed through Cloudflare's CDN). No trailing slash. */
  publicBase: string;
}

function cfg(): R2Config {
  return {
    // R2_ACCOUNT_ID falls back to the existing CLOUDFLARE_ACCOUNT_ID — same value.
    accountId: process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    bucket: process.env.R2_BUCKET || "",
    publicBase: (process.env.R2_PUBLIC_URL || "").replace(/\/+$/, ""),
  };
}

/** True only when every piece needed to presign + serve is present. Gates the
 *  entire R2 path — false means "use Supabase Storage exactly as before". */
export function r2Configured(): boolean {
  const c = cfg();
  return Boolean(
    c.accountId && c.accessKeyId && c.secretAccessKey && c.bucket && c.publicBase,
  );
}

/** The public, CDN-served URL an uploaded object resolves to. */
export function r2PublicUrl(objectPath: string): string {
  return `${cfg().publicBase}/${objectPath.replace(/^\/+/, "")}`;
}

/** True iff `url` is one of our R2 public URLs (so delete-on-replace knows the
 *  asset is ours to remove, and never tries to delete a foreign URL). */
export function isR2PublicUrl(url: string | null | undefined): boolean {
  if (typeof url !== "string") return false;
  const base = cfg().publicBase;
  return Boolean(base) && url.startsWith(`${base}/`);
}

/** Map an R2 public URL back to its bucket-relative object key, or null if the
 *  URL isn't under our public base. Used by the delete path. */
export function r2ObjectPathFromUrl(url: string): string | null {
  const base = cfg().publicBase;
  if (!base || !url.startsWith(`${base}/`)) return null;
  return url.slice(base.length + 1);
}

// ── SigV4 presigning ─────────────────────────────────────────────────────────

function sha256Hex(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}
function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}
function signingKey(secret: string, dateStamp: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}

/** RFC-3986 encoding (encodeURIComponent leaves !'()* unescaped — S3 wants them
 *  escaped in the canonical request). */
function uriEncode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
/** Encode an object key for the canonical URI, preserving `/` separators. */
function encodeKeyPath(key: string): string {
  return key.split("/").map(uriEncode).join("/");
}

/**
 * Generate a presigned S3 URL for R2. The browser (PUT) or server (DELETE) hits
 * this URL directly — no AWS creds leave the server, and the file bytes never
 * pass through our function (so Vercel's 4.5 MB body cap never applies).
 *
 * For uploads, pass `contentLength` and `contentType` so they're bound into the
 * signature: the upload is then hard-capped to the authorized byte count (a
 * presigned PUT can't otherwise constrain size — R2 rejects any other length)
 * and the served MIME must match the authorized type (no text/html or
 * script-bearing content smuggled in under our CDN domain).
 */
export function presignR2Url(opts: {
  method: "PUT" | "GET" | "DELETE";
  objectPath: string;
  expiresSeconds?: number;
  /** Bind the exact Content-Length into the signature. Makes the server-side
   *  size limit actually enforceable on an otherwise-unconstrained PUT. */
  contentLength?: number;
  /** Bind Content-Type so the stored + served MIME must equal what the server
   *  authorized (blocks text/html or script-bearing content confusion). */
  contentType?: string;
}): string {
  const c = cfg();
  const host = `${c.accountId}.r2.cloudflarestorage.com`;
  const key = opts.objectPath.replace(/^\/+/, "");
  const canonicalUri = `/${c.bucket}/${encodeKeyPath(key)}`;

  // SigV4 timestamps. new Date() is fine here — this is a Node route handler.
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8); // YYYYMMDD
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;

  // Query params that participate in the signature (everything except the
  // signature itself), sorted by key for the canonical query string.
  // Headers bound by the signature. `host` is always required; for uploads we
  // also bind content-length (hard size cap) and content-type (served MIME).
  // R2 recomputes the signature from the request's actual headers, so any
  // mismatch (a bigger body, a different MIME) is rejected with 403.
  const signedHeaderMap: Record<string, string> = { host };
  if (typeof opts.contentLength === "number") {
    signedHeaderMap["content-length"] = String(opts.contentLength);
  }
  if (opts.contentType) {
    signedHeaderMap["content-type"] = opts.contentType;
  }
  const signedHeaderNames = Object.keys(signedHeaderMap).sort();
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${signedHeaderMap[name]}\n`)
    .join(""); // each header line carries its own trailing newline

  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${c.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(opts.expiresSeconds ?? 300),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(query[k])}`)
    .join("&");

  const canonicalRequest = [
    opts.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD", // presigned URLs use the literal UNSIGNED-PAYLOAD
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = crypto
    .createHmac("sha256", signingKey(c.secretAccessKey, dateStamp))
    .update(stringToSign, "utf8")
    .digest("hex");

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/**
 * Best-effort delete of an R2 object given its public URL. Mirrors the
 * Supabase staging cleanup — fire-and-forget, a leftover orphan just sits in
 * R2 (cheap) until a future sweep. Returns true if the delete request
 * succeeded (or the object was already gone).
 */
export async function deleteR2Object(publicUrl: string): Promise<boolean> {
  const objectPath = r2ObjectPathFromUrl(publicUrl);
  if (!objectPath) return false;
  try {
    const url = presignR2Url({ method: "DELETE", objectPath, expiresSeconds: 120 });
    const res = await fetch(url, { method: "DELETE" });
    // 204 = deleted, 404 = already gone — both are the post-condition we want.
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}
