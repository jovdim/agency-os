/**
 * OpenAI provider , the production default once billing is set up.
 * Wire-compatible with the Groq adapter (both speak OpenAI's chat
 * completions schema), so this file is largely a clone with the URL,
 * env var, and default model swapped.
 *
 * Why this is the recommended primary:
 *   - gpt-4o-mini: ~$0.003 per whole-site fill (cheapest competent model)
 *   - Native JSON mode (`response_format: { type: "json_object" }`),
 *     same as Groq , the dynamic Zod schema downstream catches anything
 *     the model still gets wrong about field names.
 *   - Automatic prompt caching (50% discount on repeated prefix), kicks
 *     in for the system-prompt copywriting guide once it stabilises.
 *   - No region restrictions (unlike Gemini's free tier in EU).
 *
 * Dormant until OPENAI_API_KEY is set in the environment. Without the
 * key the adapter throws a clear error pointing at the dashboard URL ,
 * the endpoint catches it and surfaces the message to the UI, so the
 * agency knows exactly what to do.
 *
 * Cost reference (per 1M tokens, gpt-4o-mini, as of 2026-05):
 *   - Input:  $0.15
 *   - Cached input: $0.075 (auto-applied)
 *   - Output: $0.60
 * Updating the model name in composer_ai_settings is enough to swap
 * to gpt-4o or gpt-5-mini , no code change needed.
 */

import { z } from "zod";
import type { AIProvider, GenerateRequest, GenerateResponse } from "../types";

const API_URL = "https://api.openai.com/v1/chat/completions";

/**
 * Defensive validator for the chat-completions response envelope.
 * We pluck the single completion + usage counts; everything else
 * (model name, fingerprints, finish_reason) is ignored.
 */
const OpenAIResponseSchema = z.object({
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

export class OpenAIProvider implements AIProvider {
  readonly id = "openai" as const;
  readonly defaultModel = "gpt-4o-mini";

  async generate(
    req: GenerateRequest,
    modelOverride?: string,
  ): Promise<GenerateResponse> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY is not set. Get a key at https://platform.openai.com/api-keys, load credit at https://platform.openai.com/settings/organization/billing, then add OPENAI_API_KEY=sk-... to .env.local (and to Vercel env vars for production).",
      );
    }
    const model = modelOverride || this.defaultModel;

    const first = await this.callOnce(req, model, apiKey, "");
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

    // One corrective retry. Same pattern as the Gemini/Groq adapters ,
    // most parse failures clear up after a single nudge.
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

    throw new Error(
      `OpenAI returned invalid JSON twice. Last error: ${retryParsed.error}. Last raw response: ${retry.text.slice(0, 500)}`,
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
    // OpenAI-native chat completions body. response_format with
    // type: "json_object" forces the model to emit a single valid JSON
    // object , equivalent to Groq's strict-JSON mode.
    const body = {
      model,
      messages: [
        { role: "system", content: req.systemPrompt },
        { role: "user", content: req.userPrompt + retryAppendix },
      ],
      temperature: 0.7,
      max_completion_tokens: 8192,
      response_format: { type: "json_object" as const },
    };

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      // Surface the most common failure modes plainly , the UI shows
      // these directly so non-technical users can act on them.
      const hint =
        res.status === 401
          ? " (Bad API key , check OPENAI_API_KEY)"
          : res.status === 429
            ? " (Rate limited or out of credit , top up at https://platform.openai.com/settings/organization/billing)"
            : res.status === 400
              ? " (Model name might be wrong , verify the model field in /tech/settings/ai)"
              : "";
      throw new Error(
        `OpenAI ${res.status} ${res.statusText}${hint}: ${errText.slice(0, 500)}`,
      );
    }

    const json = (await res.json()) as unknown;
    const parsed = OpenAIResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `OpenAI response shape unexpected: ${parsed.error.message}`,
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
 * Parse-and-validate, with markdown-fence stripping defense in case
 * the model ignores `response_format` and wraps the JSON.
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
