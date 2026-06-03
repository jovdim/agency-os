/**
 * Groq provider , drop-in alternative when Gemini's free tier isn't
 * available in the user's region (EU coverage was uneven for Gemini
 * 2.0 Flash as of 2026-05). Groq's free tier requires no billing
 * and works globally:
 *   - 14 requests/minute, 14,400 requests/day on free tier
 *   - Llama 3.3 70B Versatile is the strongest multilingual model
 *     they host; output quality is decent (not as good as Gemini,
 *     but workable for first-pass content)
 *   - Sub-second inference
 *
 * Wire-compatible with OpenAI's chat completions API, so the call
 * shape mirrors what an OpenAI provider would look like , easy to
 * swap models or even providers down the line.
 */

import { z } from "zod";
import type { AIProvider, GenerateRequest, GenerateResponse } from "../types";

const API_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Defensive validator for Groq's response envelope. We pluck the
 * single completion + usage counts; everything else (model name,
 * fingerprints, finish_reason) is ignored.
 */
const GroqResponseSchema = z.object({
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

export class GroqProvider implements AIProvider {
  readonly id = "groq" as const;
  readonly defaultModel = "llama-3.3-70b-versatile";

  async generate(
    req: GenerateRequest,
    modelOverride?: string,
  ): Promise<GenerateResponse> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GROQ_API_KEY is not set. Add it to .env.local , get a free key at https://console.groq.com/keys",
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

    // One corrective retry. Same pattern as the Gemini adapter , most
    // parse failures clear up after a single nudge.
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
      `Groq returned invalid JSON twice. Last error: ${retryParsed.error}. Last raw response: ${retry.text.slice(0, 500)}`,
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
    // OpenAI-compatible body. response_format: { type: "json_object" }
    // is Groq's strict-JSON mode , model is forbidden from emitting
    // anything outside a single valid JSON object.
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
      throw new Error(
        `Groq ${res.status} ${res.statusText}: ${errText.slice(0, 500)}`,
      );
    }

    const json = (await res.json()) as unknown;
    const parsed = GroqResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`Groq response shape unexpected: ${parsed.error.message}`);
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
    return { ok: false, error: `Schema validation failed: ${validated.error.message}` };
  }
  return { ok: true, value: validated.data };
}

function stripCodeFences(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
  return fenced ? fenced[1] : text;
}
