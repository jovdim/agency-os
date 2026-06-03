/**
 * Upload a static asset to Supabase Storage's public assets bucket
 * and print the public URL. Used to host shared template assets
 * (e.g. the Google review logo on every reviews template) outside
 * the Vercel deployment, so they don't depend on a dashboard deploy.
 *
 * Run: npx tsx scripts/upload-asset.ts <local-path>
 *   e.g. npx tsx scripts/upload-asset.ts public/google-reviews-1-.png
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const localPath = process.argv[2];
  if (!localPath) {
    console.error("Usage: npx tsx scripts/upload-asset.ts <local-path>");
    process.exit(1);
  }
  const env: Record<string, string> = {};
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  const admin = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const bytes = readFileSync(localPath);
  const name = basename(localPath);
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const contentType =
    ext === "png" ? "image/png"
    : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
    : ext === "svg" ? "image/svg+xml"
    : ext === "webp" ? "image/webp"
    : "application/octet-stream";

  // Public bucket; create on first use if missing
  const bucket = "shared-assets";
  const { data: buckets } = await admin.storage.listBuckets();
  if (!buckets?.find((b) => b.name === bucket)) {
    const { error } = await admin.storage.createBucket(bucket, { public: true });
    if (error) {
      console.error("Bucket create failed:", error.message);
      process.exit(1);
    }
    console.log(`Created public bucket: ${bucket}`);
  }

  const { error } = await admin.storage
    .from(bucket)
    .upload(name, bytes, {
      contentType,
      upsert: true,
      cacheControl: "31536000",
    });
  if (error) {
    console.error("Upload failed:", error.message);
    process.exit(1);
  }

  const { data: pub } = admin.storage.from(bucket).getPublicUrl(name);
  console.log(`✓ Uploaded ${name} (${bytes.length} bytes)`);
  console.log(`Public URL: ${pub.publicUrl}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
