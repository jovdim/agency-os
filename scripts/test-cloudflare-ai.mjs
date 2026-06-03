#!/usr/bin/env node
/**
 * Cloudflare Workers AI vs Groq — Slovak quality smoke test.
 *
 * Run: node scripts/test-cloudflare-ai.mjs
 *
 * What it does: sends the same condensed Slovak copywriting prompt to:
 *   - Cloudflare Workers AI / Llama 3.3 70B Instruct (apples-to-apples vs Groq)
 *   - Cloudflare Workers AI / GLM-4.7-Flash (large context, multilingual)
 *   - Cloudflare Workers AI / Qwen3-30B-A3B Instruct (mixture-of-experts)
 *   - Groq / Llama 3.3 70B Versatile (current default for comparison)
 *
 * Prints each model's output side by side so a human can judge Slovak
 * quality before we commit to switching defaults. Tokens, latency, and
 * any errors per model are reported for cost/perf context.
 *
 * Required env vars (already in .env.local):
 *   CLOUDFLARE_API_TOKEN  (must have Workers AI: Read permission)
 *   CLOUDFLARE_ACCOUNT_ID
 *   GROQ_API_KEY
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Load .env.local manually (no dotenv dep, no Next.js wrapper) ──────
const envPath = join(process.cwd(), ".env.local");
const env = {};
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

const CF_TOKEN = env.CLOUDFLARE_API_TOKEN;
const CF_ACCOUNT = env.CLOUDFLARE_ACCOUNT_ID;
const GROQ_KEY = env.GROQ_API_KEY;

if (!CF_TOKEN || !CF_ACCOUNT) {
  console.error("Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID");
  process.exit(1);
}
if (!GROQ_KEY) {
  console.error("Missing GROQ_API_KEY (needed for the side-by-side baseline)");
  process.exit(1);
}

// ── The prompt (condensed copywriting guide + a real-ish task) ────────
const SYSTEM_PROMPT = `Si profesionálny slovenský copywriter pre malé firmy.
Píš výhradne v slovenčine, prirodzene a zrozumiteľne, bez prehnaných marketingových klišé.

Pravidlá:
- Žiadne anglicizmy ("solution", "premium", "expert"). Používaj slovenské ekvivalenty.
- Žiadne emoji.
- Žiadne pomlčky em-dash (—). Ak potrebuješ pauzu, použi čiarku alebo bodku.
- Konkrétnosť pred superlatívmi. Namiesto "najlepší servis" napíš "servis s 15-ročnou skúsenosťou".
- Krátke vety. Maximum 18 slov.
- Druhá osoba množného čísla ("vy", "vám"), nie tykanie ani pasívna konštrukcia.
- Headlines bez interpunkcie na konci.

Výstup: vráť LEN platný JSON podľa schémy. Žiadny text okolo, žiadne markdown bloky.`;

const USER_PROMPT = `Firma: Klempiarstvo Novák
Mesto: Žilina
Odvetvie: klampiarstvo (strechy, žľaby, oplechovanie)
Služby: oprava striech, výmena žľabov, oplechovanie komínov, izolácia striech

Vygeneruj obsah pre HERO sekciu webu tejto firmy.

Vráť presne tento JSON tvar:
{
  "headline": "string, max 8 slov",
  "subheadline": "string, max 22 slov, vysvetli čo robí firma a pre koho",
  "cta_primary": "string, 2-3 slová, akčný príkaz",
  "cta_secondary": "string, 2-3 slová, mäkký príkaz"
}`;

// ── Worker for one model on Cloudflare ────────────────────────────────
async function runCloudflare(model, label) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/run/${model}`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: USER_PROMPT },
        ],
        max_tokens: 512,
        temperature: 0.7,
      }),
    });
    const elapsed = Date.now() - t0;
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return {
        label,
        model,
        ok: false,
        error: `HTTP ${res.status}: ${errBody.slice(0, 300)}`,
        elapsed,
      };
    }
    const data = await res.json();
    // Workers AI envelope varies by model. Try the known shapes in order:
    //   1. result.response                       (text-generation classic)
    //   2. result.choices[0].message.content      (OpenAI-compatible models)
    //   3. result.output[0].content[0].text       (newer responses-API style)
    // Fall back to the raw JSON if none match — useful for debugging.
    const r = data?.result ?? {};
    let text;
    if (typeof r.response === "string") {
      text = r.response;
    } else if (typeof r.choices?.[0]?.message?.content === "string") {
      text = r.choices[0].message.content;
    } else if (typeof r.output?.[0]?.content?.[0]?.text === "string") {
      text = r.output[0].content[0].text;
    } else {
      text = JSON.stringify(r, null, 2);
    }
    return { label, model, ok: true, text, elapsed, raw: data };
  } catch (err) {
    return {
      label,
      model,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      elapsed: Date.now() - t0,
    };
  }
}

// ── Worker for Groq (existing default) ────────────────────────────────
async function runGroq() {
  const t0 = Date.now();
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: USER_PROMPT },
        ],
        max_completion_tokens: 512,
        temperature: 0.7,
        response_format: { type: "json_object" },
      }),
    });
    const elapsed = Date.now() - t0;
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return {
        label: "Groq · Llama 3.3 70B (current default)",
        model: "llama-3.3-70b-versatile",
        ok: false,
        error: `HTTP ${res.status}: ${errBody.slice(0, 300)}`,
        elapsed,
      };
    }
    const data = await res.json();
    return {
      label: "Groq · Llama 3.3 70B (current default)",
      model: "llama-3.3-70b-versatile",
      ok: true,
      text: data?.choices?.[0]?.message?.content ?? "",
      elapsed,
      tokensIn: data?.usage?.prompt_tokens,
      tokensOut: data?.usage?.completion_tokens,
    };
  } catch (err) {
    return {
      label: "Groq · Llama 3.3 70B (current default)",
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      elapsed: Date.now() - t0,
    };
  }
}

// ── Try to pretty-parse the output as JSON; fall back to raw if not ──
function formatOutput(text) {
  if (text === null || text === undefined || text === "") return "(empty)";
  // Coerce non-strings (some Cloudflare envelopes return arrays/objects)
  if (typeof text !== "string") {
    text = JSON.stringify(text, null, 2);
  }
  // Strip code fences if present
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
  const cleaned = fenced ? fenced[1].trim() : text.trim();
  try {
    const parsed = JSON.parse(cleaned);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return cleaned;
  }
}

// ── Run all in parallel and print results ─────────────────────────────
console.log("Sending the same Slovak prompt to 4 models in parallel…\n");

const results = await Promise.all([
  runCloudflare("@cf/meta/llama-3.3-70b-instruct-fp8-fast", "Cloudflare · Llama 3.3 70B"),
  runCloudflare("@cf/moonshotai/kimi-k2.6", "Cloudflare · Kimi K2.6 (262k ctx)"),
  runCloudflare("@cf/qwen/qwen3-30b-a3b-fp8", "Cloudflare · Qwen3 30B MoE"),
  runGroq(),
]);

for (const r of results) {
  console.log("═".repeat(72));
  console.log(`▌ ${r.label}`);
  console.log(`▌ model:  ${r.model}`);
  console.log(`▌ time:   ${r.elapsed} ms`);
  if (r.tokensIn || r.tokensOut)
    console.log(`▌ tokens: ${r.tokensIn} in / ${r.tokensOut} out`);
  console.log("═".repeat(72));
  if (r.ok) {
    console.log(formatOutput(r.text));
  } else {
    console.log(`ERROR: ${r.error}`);
  }
  console.log();
}
