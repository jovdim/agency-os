/**
 * R2 credentials + SigV4 smoke test. Proves the presigned PUT/GET/DELETE
 * round-trip works against the real bucket — independent of the browser CORS
 * policy and the public URL (those only matter for browser upload + serving).
 *
 *   npx tsx scripts/test-r2.ts
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

// Relative import (not the @/ alias) so it resolves under tsx without path config.
import { presignR2Url, r2Configured, r2PublicUrl } from "../src/lib/platform/r2";

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name} in .env.local`);
    process.exit(1);
  }
  return v;
}

async function main() {
  // These four are all the PUT/GET/DELETE round-trip needs.
  need("R2_ACCESS_KEY_ID");
  need("R2_SECRET_ACCESS_KEY");
  need("R2_BUCKET");
  if (!process.env.R2_ACCOUNT_ID && !process.env.CLOUDFLARE_ACCOUNT_ID) {
    console.error("Missing R2_ACCOUNT_ID (or CLOUDFLARE_ACCOUNT_ID)");
    process.exit(1);
  }

  const key = `__diagnostics/r2-smoke-${Date.now()}.txt`;
  const body = "r2-ok";
  const bodyBytes = Buffer.byteLength(body);

  // 1) Upload via presigned PUT with size + type bound into the signature.
  const putUrl = presignR2Url({
    method: "PUT",
    objectPath: key,
    expiresSeconds: 120,
    contentLength: bodyBytes,
    contentType: "text/plain",
  });
  const put = await fetch(putUrl, {
    method: "PUT",
    body,
    headers: { "Content-Type": "text/plain" },
  });
  if (!put.ok) {
    console.error(`PUT failed: ${put.status} ${put.statusText}`);
    console.error(await put.text());
    process.exit(1);
  }
  console.log(`PUT   ok  (${put.status})  -> ${key}  (size+type bound)`);

  // 1b) SECURITY: a body larger than the signed content-length MUST be rejected
  // (this is the fix for the bypassable size cap — proves R2 enforces it).
  const oversizeUrl = presignR2Url({
    method: "PUT",
    objectPath: `${key}.oversize`,
    expiresSeconds: 120,
    contentLength: 5, // sign 5 bytes...
    contentType: "text/plain",
  });
  const oversize = await fetch(oversizeUrl, {
    method: "PUT",
    body: "this body is much longer than five bytes", // ...send many more
    headers: { "Content-Type": "text/plain" },
  });
  if (oversize.ok) {
    console.error(`SECURITY FAIL: oversized PUT was accepted (${oversize.status}) — size cap not enforced`);
    process.exit(1);
  }
  console.log(`PUT   ok  (rejected ${oversize.status})  oversized upload blocked`);

  // 1c) SECURITY: a Content-Type different from the signed one MUST be rejected
  // (proves the served MIME can't be swapped to text/html / script).
  const wrongTypeUrl = presignR2Url({
    method: "PUT",
    objectPath: `${key}.wrongtype`,
    expiresSeconds: 120,
    contentLength: bodyBytes,
    contentType: "text/plain", // signed text/plain...
  });
  const wrongType = await fetch(wrongTypeUrl, {
    method: "PUT",
    body,
    headers: { "Content-Type": "text/html" }, // ...send text/html
  });
  if (wrongType.ok) {
    console.error(`SECURITY FAIL: mismatched Content-Type accepted (${wrongType.status}) — MIME not bound`);
    process.exit(1);
  }
  console.log(`PUT   ok  (rejected ${wrongType.status})  MIME swap blocked`);

  // 2) Read it back via presigned GET and verify the bytes.
  const getUrl = presignR2Url({ method: "GET", objectPath: key, expiresSeconds: 120 });
  const get = await fetch(getUrl);
  if (!get.ok) {
    console.error(`GET failed: ${get.status} ${get.statusText}`);
    process.exit(1);
  }
  const got = await get.text();
  if (got !== body) {
    console.error(`GET content mismatch: expected "${body}", got "${got}"`);
    process.exit(1);
  }
  console.log(`GET   ok  (${get.status})  content verified`);

  // 3) Delete it via presigned DELETE.
  const delUrl = presignR2Url({ method: "DELETE", objectPath: key, expiresSeconds: 120 });
  const del = await fetch(delUrl, { method: "DELETE" });
  if (!del.ok && del.status !== 404) {
    console.error(`DELETE failed: ${del.status} ${del.statusText}`);
    process.exit(1);
  }
  console.log(`DELETE ok (${del.status})  cleaned up`);

  console.log("\n✅ R2 credentials + signing work end-to-end.");
  if (r2Configured()) {
    console.log(`   Public URLs will resolve at: ${r2PublicUrl("images/<site>/<file>")}`);
  } else {
    console.log("   (R2_PUBLIC_URL still empty — set it to enable public serving.)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
