#!/usr/bin/env node
/**
 * Cloudflare Workers AI image-generation smoke test.
 *
 * Run: node scripts/test-cloudflare-image.mjs
 *
 * Hits FLUX.1 [schnell] (JSON body, fast, lower quality) and FLUX.2
 * [klein] 9B (multipart, slower, higher quality) with the same Slovak-
 * proposal-style prompt. Saves both PNGs to disk so we can eyeball
 * which model produces output worth wiring into the composer.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const envPath = join(process.cwd(), ".env.local");
const env = {};
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

const CF_TOKEN = env.CLOUDFLARE_API_TOKEN;
const CF_ACCOUNT = env.CLOUDFLARE_ACCOUNT_ID;

if (!CF_TOKEN || !CF_ACCOUNT) {
  console.error("Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID");
  process.exit(1);
}

const PROMPT =
  "Professional photo of a Slovak roofer working on a tile roof, golden hour, sharp focus, photorealistic, no text, no watermark";

// ── FLUX.1 [schnell] — JSON body ──────────────────────────────────────
async function runFlux1Schnell() {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CF_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt: PROMPT, steps: 8 }),
  });
  const elapsed = Date.now() - t0;
  if (!res.ok) {
    return {
      ok: false,
      label: "FLUX.1 schnell",
      error: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`,
      elapsed,
    };
  }
  const data = await res.json();
  const b64 = data?.result?.image;
  if (!b64) {
    return {
      ok: false,
      label: "FLUX.1 schnell",
      error: `No image in response: ${JSON.stringify(data).slice(0, 300)}`,
      elapsed,
    };
  }
  const buf = Buffer.from(b64, "base64");
  const path = join(process.cwd(), "scripts/test-output-flux1-schnell.png");
  writeFileSync(path, buf);
  return { ok: true, label: "FLUX.1 schnell", elapsed, bytes: buf.length, path };
}

// ── FLUX.2 [klein] 9B — multipart/form-data ───────────────────────────
async function runFlux2Klein9b() {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/run/@cf/black-forest-labs/flux-2-klein-9b`;
  const fd = new FormData();
  fd.append("prompt", PROMPT);
  fd.append("width", "1024");
  fd.append("height", "1024");
  fd.append("steps", "25");

  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${CF_TOKEN}` },
    body: fd,
  });
  const elapsed = Date.now() - t0;
  if (!res.ok) {
    return {
      ok: false,
      label: "FLUX.2 klein 9B",
      error: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`,
      elapsed,
    };
  }
  // FLUX.2 docs say JSON-with-base64; some Cloudflare endpoints return
  // raw binary instead. Detect from content-type.
  const ct = res.headers.get("content-type") || "";
  let buf;
  if (ct.includes("application/json")) {
    const data = await res.json();
    const b64 = data?.image ?? data?.result?.image;
    if (!b64) {
      return {
        ok: false,
        label: "FLUX.2 klein 9B",
        error: `No image in JSON: ${JSON.stringify(data).slice(0, 300)}`,
        elapsed,
      };
    }
    buf = Buffer.from(b64, "base64");
  } else {
    buf = Buffer.from(await res.arrayBuffer());
  }
  const path = join(process.cwd(), "scripts/test-output-flux2-klein.png");
  writeFileSync(path, buf);
  return {
    ok: true,
    label: "FLUX.2 klein 9B",
    elapsed,
    bytes: buf.length,
    path,
    contentType: ct,
  };
}

console.log(`Prompt: "${PROMPT}"\n`);
console.log("Generating images on FLUX.1 schnell + FLUX.2 klein 9B…\n");

const results = await Promise.all([runFlux1Schnell(), runFlux2Klein9b()]);

for (const r of results) {
  console.log("─".repeat(72));
  console.log(`▌ ${r.label}`);
  console.log(`▌ time:  ${r.elapsed} ms`);
  if (r.ok) {
    console.log(`▌ bytes: ${(r.bytes / 1024).toFixed(1)} KB`);
    if (r.contentType) console.log(`▌ ctype: ${r.contentType}`);
    console.log(`▌ saved: ${r.path}`);
  } else {
    console.log(`ERROR: ${r.error}`);
  }
  console.log();
}
