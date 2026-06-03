/**
 * Provider-agnostic types for AI content generation.
 *
 * The composer's AI feature is wired through these types so we can
 * swap Gemini for Claude/OpenAI/anything else by editing one file
 * (providers/<name>.ts) and one DB row (composer_ai_settings.provider).
 * The endpoint, the prompt builder, the schema validator, the UI ,
 * none of them care which model actually produced the bytes.
 */

import type { z } from "zod";

/**
 * What the endpoint asks the provider to generate. Built by the
 * prompt-builder from the composition + the inputs the tech reviewed
 * in the modal.
 *
 * `systemPrompt` is the cacheable half , Peter's copywriting guide +
 * the global output rules. Same string across every generation in a
 * 5-minute window, which lets providers' prompt-cache features charge
 * a fraction of normal input cost on cache hits.
 *
 * `userPrompt` is the dynamic half , company name + industry + town +
 * services + the JSON shape the model needs to return. Different per
 * generation, so it bypasses the cache.
 */
export interface GenerateRequest {
  /** Cacheable system prompt , copywriting guide + output rules. */
  systemPrompt: string;
  /** Dynamic user prompt , company info + JSON schema to fill. */
  userPrompt: string;
  /** Zod schema the response must validate against. */
  expectedSchema: z.ZodTypeAny;
}

/**
 * What the provider returns. `parsedJson` is the validated object
 * (already through Zod). Tokens are reported best-effort , providers
 * that don't expose them get nulls and we estimate cost from the
 * char count instead.
 */
export interface GenerateResponse {
  parsedJson: unknown;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Raw response string before parsing , kept for the audit log on failures. */
  rawResponse: string;
  /** Whether the validator had to retry once on a malformed first response. */
  retried: boolean;
}

/**
 * One adapter per vendor. Each implementation knows its own SDK,
 * its own auth, and its own JSON-mode invocation. Everything outside
 * `src/lib/ai/providers/` only sees this interface.
 */
export interface AIProvider {
  /** Provider id, mirrors the value stored in composer_ai_settings.provider. */
  readonly id: "gemini" | "groq" | "claude" | "openai" | "cloudflare";

  /** Default model name when no override is set on the settings row. */
  readonly defaultModel: string;

  /**
   * Run one generation. Implementations:
   *   - inject systemPrompt as the cacheable system message,
   *   - send userPrompt as the user turn,
   *   - request strict JSON output (provider-specific knob),
   *   - parse + validate against `expectedSchema`,
   *   - on first parse/validation failure: retry once with a "your
   *     previous output failed validation" reminder appended.
   *
   * Should THROW on hard failures (auth, rate-limit, network, retry
   * also fails). The endpoint catches and writes a `failed` row to
   * ai_generations.
   */
  generate(req: GenerateRequest, modelOverride?: string): Promise<GenerateResponse>;
}

/**
 * Supported provider ids , used to type the settings row + the
 * factory in provider.ts.
 */
export type ProviderId = AIProvider["id"];
