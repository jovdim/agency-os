#!/usr/bin/env node
/**
 * Empirical test: does Gemini's image-generation API actually work
 * from this account, calling it from a Slovak network?
 *
 * Background: Google's policy says EEA users must use the paid tier.
 * But the policy is enforced at account-creation, not per-call.
 * So if Peter has a working GEMINI_API_KEY (however he obtained it),
 * the question is whether the image API responds normally or returns
 * a 403/billing-required.
 *
 * We test TWO image surfaces because Gemini has split its image gen:
 *   1. Imagen 3 / Imagen 4 — dedicated image-only models, paid only
 *   2. Gemini 2.5 Flash Image (Nano Banana) — free-tier eligible
 *
 * Run: node scripts/test-gemini-image.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const envPath = join(process.cwd(), ".env.local");
const env = {};
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

const KEY = env.GEMINI_API_KEY;
if (!KEY) {
  console.error("GEMINI_API_KEY missing");
  process.exit(1);
}

const PROMPT =
  "Documentary photo of a real Slovak roofer working on a tile roof in Žilina, candid moment, natural daylight, real worn working clothes, NOT a stock photo, NOT posed, photorealistic, sharp focus";

// ── Test 1: Gemini 2.5 Flash Image (Nano Banana) ──────────────────────
//
// REST shape per the docs at
// https://ai.google.dev/gemini-api/docs/image-generation
// The `:generateContent` endpoint with `responseModalities: ["IMAGE"]`
// returns inline base64 PNGs in the response candidates.
async function runNanoBanana() {
  const model = "gemini-2.5-flash-image";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`;
  const body = {
    contents: [{ parts: [{ text: PROMPT }] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
    },
  };
  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const elapsed = Date.now() - t0;
  if (!res.ok) {
    return {
      ok: false,
      label: "Gemini · Nano Banana",
      status: res.status,
      error: (await res.text()).slice(0, 500),
      elapsed,
    };
  }
  const data = await res.json();
  // Walk the candidates → content → parts → inlineData.data structure.
  let b64;
  for (const cand of data?.candidates ?? []) {
    for (const part of cand?.content?.parts ?? []) {
      if (part?.inlineData?.data) {
        b64 = part.inlineData.data;
        break;
      }
    }
    if (b64) break;
  }
  if (!b64) {
    return {
      ok: false,
      label: "Gemini · Nano Banana",
      error: `No inline image in response: ${JSON.stringify(data).slice(0, 500)}`,
      elapsed,
    };
  }
  const buf = Buffer.from(b64, "base64");
  const out = join(process.cwd(), "scripts/test-output-gemini-nano-banana.png");
  writeFileSync(out, buf);
  return {
    ok: true,
    label: "Gemini · Nano Banana (gemini-2.5-flash-image)",
    elapsed,
    bytes: buf.length,
    path: out,
  };
}

// ── Test 2: Imagen 3 (paid only — should fail informatively) ──────────
async function runImagen3() {
  const model = "imagen-3.0-generate-002";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${KEY}`;
  const body = {
    instances: [{ prompt: PROMPT }],
    parameters: { sampleCount: 1, aspectRatio: "1:1" },
  };
  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const elapsed = Date.now() - t0;
  if (!res.ok) {
    return {
      ok: false,
      label: "Gemini · Imagen 3",
      status: res.status,
      error: (await res.text()).slice(0, 500),
      elapsed,
    };
  }
  const data = await res.json();
  const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) {
    return {
      ok: false,
      label: "Gemini · Imagen 3",
      error: `No image: ${JSON.stringify(data).slice(0, 500)}`,
      elapsed,
    };
  }
  const buf = Buffer.from(b64, "base64");
  const out = join(process.cwd(), "scripts/test-output-gemini-imagen3.png");
  writeFileSync(out, buf);
  return {
    ok: true,
    label: "Gemini · Imagen 3",
    elapsed,
    bytes: buf.length,
    path: out,
  };
}

console.log(`Prompt: "${PROMPT.slice(0, 70)}..."\n`);
console.log("Testing Gemini image-gen surfaces…\n");

const results = await Promise.all([runNanoBanana(), runImagen3()]);

for (const r of results) {
  console.log("─".repeat(72));
  console.log(`▌ ${r.label}`);
  console.log(`▌ time:  ${r.elapsed} ms`);
  if (r.ok) {
    console.log(`▌ bytes: ${(r.bytes / 1024).toFixed(1)} KB`);
    console.log(`▌ saved: ${r.path}`);
  } else {
    console.log(`▌ status: ${r.status ?? "n/a"}`);
    console.log(`ERROR: ${r.error}`);
  }
  console.log();
}
