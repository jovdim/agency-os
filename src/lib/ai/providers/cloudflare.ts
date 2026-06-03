/**
 * Cloudflare Workers AI provider — text generation half.
 *
 * Why this provider exists: Groq's free tier is TPM-capped at 6,000
 * tokens/minute on Llama 3.3 70B, which throttles the whole-site fill
 * (10 sections × ~5K tokens each pegs the cap and queues). Cloudflare
 * Workers AI has a 10,000-neuron daily budget shared across calls and
 * no per-minute wall, so batched fills don't stall mid-generation.
 *
 * It also runs on the same vendor as the deploy pipeline (Pages +
 * DNS) — same `CLOUDFLARE_API_TOKEN`, same `CLOUDFLARE_ACCOUNT_ID`,
 * same dashboard. One less account to babysit.
 *
 * The token MUST have the `Workers AI: Read` permission added to it.
 * Existing Pages/DNS tokens don't include it by default — adding takes
 * 30 seconds at https://dash.cloudflare.com/profile/api-tokens but the
 * adapter will throw a 401 with a hint if the scope is missing.
 *
 * Why the OpenAI-compatible endpoint (/ai/v1/chat/completions) instead
 * of /ai/run/{model}: response shape is identical to Groq + OpenAI, so
 * we get to reuse the same Zod validator and parsing logic. Net code
 * delta vs cloning groq.ts is ~30 lines.
 *
 * Output quality on Llama 3.3 70B (apples-to-apples vs Groq, both same
 * weights, both at temperature 0.7): comparable headlines/subheadlines,
 * slightly better CTAs (concrete verbs vs generic calques like
 * "Contact us" / "Read more"). Sample size is two — eyeball
 * confirmation only, not statistical.
 *
 * Reasoning models on Cloudflare (Kimi K2.6, Qwen3, GLM-4.7-Flash) are
 * NOT exposed in the dropdown for the interactive generate path. They
 * spend their token budget on internal `reasoning_content` and need
 * 1500-2000 tokens just to reach the JSON output, taking 20-30s per
 * generation. That UX is unacceptable for a per-section "Generate"
 * button. If we add a future "premium batch" option for whole-site
 * fills where the user can wait, this is the place to plumb it.
 */

import { z } from "zod";
import type { AIProvider, GenerateRequest, GenerateResponse } from "../types";

/**
 * Defensive validator for the OpenAI-compatible response envelope —
 * same shape as Groq/OpenAI return. We pluck the single completion +
 * usage counts; everything else is ignored.
 */
const CloudflareResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string() }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
    })
    .optional(),
});

export class CloudflareProvider implements AIProvider {
  readonly id = "cloudflare" as const;
  /** Llama 3.3 70B Instruct (FP8 fast variant). Non-reasoning model,
   *  ~3s typical response on Cloudflare's GPU pool, decent quality. */
  readonly defaultModel = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

  async generate(
    req: GenerateRequest,
    modelOverride?: string,
  ): Promise<GenerateResponse> {
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!apiToken || !accountId) {
      throw new Error(
        "CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not set. Both come from the same dashboard you used for Pages: https://dash.cloudflare.com",
      );
    }
    const model = modelOverride || this.defaultModel;

    const first = await this.callOnce(req, model, apiToken, accountId, "");
    const firstParsed = tryParseAndValidate(first.text, req.expectedSchema);
    if (firstParsed.ok) {
      return {
        parsedJson: firstParsed.value,
        inputTokens: first.inputTokens,
        outputTokens: first.outputTokens,
        rawResponse: first.text,
        retried: false,
      };
    }

    // One corrective retry — same pattern as Groq/OpenAI adapters.
    const retry = await this.callOnce(
      req,
      model,
      apiToken,
      accountId,
      `\n\nIMPORTANT: Your previous output could not be parsed. Reason: ${firstParsed.error}. Return ONLY valid JSON matching the requested schema. No markdown, no prose, no code fences.`,
    );
    const retryParsed = tryParseAndValidate(retry.text, req.expectedSchema);
    if (retryParsed.ok) {
      return {
        parsedJson: retryParsed.value,
        inputTokens:
          (first.inputTokens ?? 0) + (retry.inputTokens ?? 0) || null,
        outputTokens:
          (first.outputTokens ?? 0) + (retry.outputTokens ?? 0) || null,
        rawResponse: retry.text,
        retried: true,
      };
    }

    throw new Error(
      `Cloudflare Workers AI returned invalid JSON twice. Last error: ${retryParsed.error}. Last raw response: ${retry.text.slice(0, 500)}`,
    );
  }

  private async callOnce(
    req: GenerateRequest,
    model: string,
    apiToken: string,
    accountId: string,
    retryAppendix: string,
  ): Promise<{
    text: string;
    inputTokens: number | null;
    outputTokens: number | null;
  }> {
    // Cloudflare's OpenAI-compatible endpoint accepts the same body
    // shape as OpenAI/Groq. response_format is honored by Llama 3.3
    // (forces strict JSON output) — the tryParseAndValidate fallback
    // catches stragglers where the model wraps in code fences anyway.
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;
    const body = {
      model,
      messages: [
        { role: "system", content: req.systemPrompt },
        { role: "user", content: req.userPrompt + retryAppendix },
      ],
      temperature: 0.7,
      max_tokens: 4096,
      response_format: { type: "json_object" as const },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      // Surface the most common failure modes plainly — the UI shows
      // these directly so non-technical users can act on them.
      const hint =
        res.status === 401
          ? " (Token missing or wrong scope — Workers AI: Read must be enabled at https://dash.cloudflare.com/profile/api-tokens)"
          : res.status === 403
            ? " (Token lacks Workers AI permission — add it on the token edit page)"
            : res.status === 429
              ? " (Daily neuron quota exhausted — resets at midnight UTC, or upgrade Workers plan)"
              : res.status === 400
                ? " (Model slug might be wrong — verify in /tech/settings/ai)"
                : "";
      throw new Error(
        `Cloudflare ${res.status} ${res.statusText}${hint}: ${errText.slice(0, 500)}`,
      );
    }

    const json = (await res.json()) as unknown;
    const parsed = CloudflareResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `Cloudflare response shape unexpected: ${parsed.error.message}`,
      );
    }
    const choice = parsed.data.choices[0];
    return {
      text: choice.message.content,
      inputTokens: parsed.data.usage?.prompt_tokens ?? null,
      outputTokens: parsed.data.usage?.completion_tokens ?? null,
    };
  }
}

/**
 * Parse-and-validate, with markdown-fence stripping in case the model
 * ignores `response_format` and wraps the JSON anyway.
 */
function tryParseAndValidate(
  text: string,
  schema: z.ZodTypeAny,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const stripped = stripCodeFences(text).trim();
  let raw: unknown;
  try {
    raw = JSON.parse(stripped);
  } catch (err) {
    return {
      ok: false,
      error: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const validated = schema.safeParse(raw);
  if (!validated.success) {
    return {
      ok: false,
      error: `Schema validation failed: ${validated.error.message}`,
    };
  }
  return { ok: true, value: validated.data };
}

function stripCodeFences(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
  return fenced ? fenced[1] : text;
}

/* ─────────────────────────────────────────────────────────────────────
   Image generation — FLUX on Cloudflare Workers AI
   ─────────────────────────────────────────────────────────────────── */

/**
 * Image-gen models we trust enough to expose. Adding a new one means
 * appending a row here AND extending CloudflareImageModel below.
 *
 * Real measured neuron cost per image (from Cloudflare dashboard
 * 2026-05-10, after 12 actual UI-driven generations):
 *
 *   - flux-1-schnell:    ~173 neurons/image  (~57 free images/day)
 *   - flux-2-klein-9b:   ~1,500 neurons/image (~6 free images/day)
 *   - flux-2-dev:        not yet measured, expected ~2,000+
 *
 * The free tier is 10k neurons/day. Defaulting to flux-2-klein-9b
 * burned the entire daily budget in 6-7 generations and was the wrong
 * call — switched the default to flux-1-schnell on 2026-05-10 so the
 * free tier is actually usable for proposal building. flux-2-klein-9b
 * stays available for the future "Quality" toggle in the UI.
 */
export const CLOUDFLARE_IMAGE_MODELS = {
  "flux-1-schnell": "@cf/black-forest-labs/flux-1-schnell",
  "flux-2-klein-9b": "@cf/black-forest-labs/flux-2-klein-9b",
  "flux-2-dev": "@cf/black-forest-labs/flux-2-dev",
} as const;

export type CloudflareImageModel = keyof typeof CLOUDFLARE_IMAGE_MODELS;

export interface ImageGenerateOptions {
  prompt: string;
  /** Which model to use. Default: flux-1-schnell — ~9× cheaper than
   *  flux-2-klein-9b in real measured neurons (173 vs 1,500), still
   *  produces usable photoreal output for proposal sites. flux-2 is
   *  available as an opt-in for hero/marquee shots that warrant the
   *  extra cost. */
  model?: CloudflareImageModel;
  /** Output width in pixels. Ignored by flux-1-schnell. Default 1024. */
  width?: number;
  /** Output height in pixels. Ignored by flux-1-schnell. Default 1024. */
  height?: number;
  /** Diffusion steps. flux-1-schnell: max 8. flux-2: ~25 default. */
  steps?: number;
}

export interface ImageGenerateResult {
  /** PNG bytes ready to upload / save / return as a Response body. */
  bytes: Buffer;
  /** MIME type — currently always "image/png" but kept here so future
   *  models that emit JPEG/WebP don't break callers. */
  contentType: string;
  /** Wall-clock time the generation took, for logging + cost tracking. */
  durationMs: number;
}

/**
 * Generate one image via Cloudflare Workers AI.
 *
 * Returns a Buffer that callers can:
 *   - Upload to Supabase composer-staging via the existing upload route
 *   - Stream as a Response body with Content-Type: image/png
 *   - Save to disk for testing
 *
 * The two FLUX variants have different request shapes (JSON vs multipart);
 * this wrapper hides that detail. The response shape is also slightly
 * different per model (some return JSON-with-base64, others raw binary)
 * — we sniff the content-type and decode either way.
 *
 * Throws on:
 *   - Missing CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID env vars
 *   - 401/403 (token missing Workers AI: Read scope)
 *   - 429 (daily 10k-neuron quota exhausted)
 *   - 5xx (Cloudflare-side problem; the caller can retry once)
 *   - Empty / malformed response body
 */
export async function generateCloudflareImage(
  opts: ImageGenerateOptions,
): Promise<ImageGenerateResult> {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!apiToken || !accountId) {
    throw new Error(
      "CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not set. Same env vars used by the deploy pipeline.",
    );
  }

  const modelKey = opts.model ?? "flux-1-schnell";
  const slug = CLOUDFLARE_IMAGE_MODELS[modelKey];
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${slug}`;
  const t0 = Date.now();

  let res: Response;
  if (modelKey === "flux-1-schnell") {
    // JSON body. width/height not honored by this model; image is
    // always around 1024x1024. steps clamped to 1-8.
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: opts.prompt,
        steps: Math.min(Math.max(opts.steps ?? 4, 1), 8),
      }),
    });
  } else {
    // FLUX.2 family — multipart/form-data with width/height/steps.
    const fd = new FormData();
    fd.append("prompt", opts.prompt);
    fd.append("width", String(opts.width ?? 1024));
    fd.append("height", String(opts.height ?? 1024));
    fd.append("steps", String(opts.steps ?? 25));
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}` },
      body: fd,
    });
  }

  const durationMs = Date.now() - t0;

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    const hint =
      res.status === 401
        ? " (Workers AI: Read scope missing on token)"
        : res.status === 403
          ? " (Token lacks Workers AI permission)"
          : res.status === 429
            ? " (Daily neuron quota exhausted — resets at midnight UTC)"
            : "";
    throw new Error(
      `Cloudflare image-gen ${res.status} ${res.statusText}${hint}: ${errText.slice(0, 500)}`,
    );
  }

  // Response shape varies — flux-1-schnell returns JSON with
  // result.image base64; flux-2 returns JSON with .image base64.
  // Some accounts get raw binary back. Sniff the content-type.
  const ct = res.headers.get("content-type") || "";
  let bytes: Buffer;
  if (ct.includes("application/json")) {
    const data = (await res.json()) as { image?: string; result?: { image?: string } };
    const b64 = data?.image ?? data?.result?.image;
    if (!b64 || typeof b64 !== "string") {
      throw new Error(
        `Cloudflare image-gen returned JSON without an image field: ${JSON.stringify(data).slice(0, 300)}`,
      );
    }
    bytes = Buffer.from(b64, "base64");
  } else {
    bytes = Buffer.from(await res.arrayBuffer());
  }

  if (bytes.length === 0) {
    throw new Error("Cloudflare image-gen returned an empty body");
  }

  return { bytes, contentType: "image/png", durationMs };
}
