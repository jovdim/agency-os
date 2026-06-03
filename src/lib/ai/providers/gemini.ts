/**
 * Google Gemini provider. Uses Gemini 2.0 Flash by default (best
 * quality / latency / cost trade-off in the free tier , 1500
 * requests/day at validation stage).
 *
 * Direct REST calls to `generativelanguage.googleapis.com` , no SDK
 * dep needed, keeps the bundle small and avoids Node-vs-Edge
 * compatibility surprises. The endpoint is one HTTPS POST per
 * generation; `responseMimeType: "application/json"` forces strict
 * JSON output without us having to parse markdown fences.
 *
 * Auth: API key from env var GEMINI_API_KEY. The composer endpoint
 * checks for it once on startup and returns a clean 503 if missing,
 * so the user never sees a stack trace from a bad fetch.
 */

import { z } from "zod";
import type { AIProvider, GenerateRequest, GenerateResponse } from "../types";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Gemini's response shape (we use a tiny subset , most fields like
 * safetyRatings, citationMetadata, etc. are ignored). Schema-validated
 * defensively so a future API change can't silently corrupt our output.
 */
const GeminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({
          parts: z.array(z.object({ text: z.string() })),
        }),
      }),
    )
    .min(1),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
    })
    .optional(),
});

export class GeminiProvider implements AIProvider {
  readonly id = "gemini" as const;
  readonly defaultModel = "gemini-2.0-flash";

  async generate(
    req: GenerateRequest,
    modelOverride?: string,
  ): Promise<GenerateResponse> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY is not set. Add it to .env.local , get a free key at https://aistudio.google.com/apikey",
      );
    }
    const model = modelOverride || this.defaultModel;

    // First attempt , system + user, with strict JSON output.
    const first = await this.callOnce(req, model, apiKey, /* retryAppendix */ "");
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

    // Retry once with a corrective nudge appended. We DON'T re-send
    // the original user prompt twice , we just hint at the failure.
    // Most Gemini parse errors are stray markdown fences or a missing
    // closing brace; one retry usually clears them.
    const retry = await this.callOnce(
      req,
      model,
      apiKey,
      `\n\nIMPORTANT: Your previous output could not be parsed. Reason: ${firstParsed.error}. Return ONLY valid JSON matching the requested schema. No markdown, no prose, no code fences.`,
    );
    const retryParsed = tryParseAndValidate(retry.text, req.expectedSchema);
    if (retryParsed.ok) {
      return {
        parsedJson: retryParsed.value,
        inputTokens: (first.inputTokens ?? 0) + (retry.inputTokens ?? 0) || null,
        outputTokens:
          (first.outputTokens ?? 0) + (retry.outputTokens ?? 0) || null,
        rawResponse: retry.text,
        retried: true,
      };
    }

    // Both attempts failed validation , bubble up so the endpoint
    // can log a `failed` row in ai_generations and return a clean
    // 502 to the UI.
    throw new Error(
      `Gemini returned invalid JSON twice. Last error: ${retryParsed.error}. Last raw response: ${retry.text.slice(0, 500)}`,
    );
  }

  private async callOnce(
    req: GenerateRequest,
    model: string,
    apiKey: string,
    retryAppendix: string,
  ): Promise<{
    text: string;
    inputTokens: number | null;
    outputTokens: number | null;
  }> {
    const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    // Gemini's REST API uses `system_instruction` for the cacheable
    // system message and `contents` for the user turn. JSON-mode
    // is enforced via `responseMimeType` , the model is forbidden
    // from emitting markdown fences or prose around the JSON.
    const body = {
      system_instruction: {
        parts: [{ text: req.systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: req.userPrompt + retryAppendix }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.7,
        // Cap output to a sane ceiling , full-site generation tops
        // out around 4-5K tokens; 8K is plenty of headroom and stops
        // a runaway from exhausting the free-tier quota.
        maxOutputTokens: 8192,
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `Gemini ${res.status} ${res.statusText}: ${errText.slice(0, 500)}`,
      );
    }

    const json = (await res.json()) as unknown;
    const parsed = GeminiResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `Gemini response shape unexpected: ${parsed.error.message}`,
      );
    }
    const candidate = parsed.data.candidates[0];
    const text = candidate.content.parts.map((p) => p.text).join("");
    return {
      text,
      inputTokens: parsed.data.usageMetadata?.promptTokenCount ?? null,
      outputTokens: parsed.data.usageMetadata?.candidatesTokenCount ?? null,
    };
  }
}

/**
 * Parse-and-validate helper. Returns a discriminated union so the
 * caller can branch on `ok` without `try/catch`. Strips any stray
 * markdown fences before parsing , Gemini is normally well-behaved
 * with `responseMimeType` set, but the cleanup is cheap insurance.
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
    return { ok: false, error: `Schema validation failed: ${validated.error.message}` };
  }
  return { ok: true, value: validated.data };
}

/**
 * Belt-and-suspenders: even with `responseMimeType: "application/json"`
 * Gemini occasionally wraps output in a ```json fence. Strip them.
 */
function stripCodeFences(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
  return fenced ? fenced[1] : text;
}
