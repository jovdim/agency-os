/**
 * Factory: maps a provider id (from composer_ai_settings.provider) to
 * the concrete adapter that talks to that vendor's SDK. The endpoint
 * just calls `getProvider(settings.provider)` and uses the returned
 * `AIProvider` , no other file in the app knows which vendor is in
 * play.
 *
 * Adding a new provider = drop a file in `providers/`, register it
 * here. Nothing else changes.
 */

import type { AIProvider, ProviderId } from "./types";
import { GeminiProvider } from "./providers/gemini";
import { GroqProvider } from "./providers/groq";
import { OpenAIProvider } from "./providers/openai";
import { CloudflareProvider } from "./providers/cloudflare";

/**
 * Singleton instances , providers are stateless wrappers around
 * fetch/SDK calls, so we lazy-init once and reuse. Avoids paying
 * SDK constructor cost on every generation.
 */
const cache = new Map<ProviderId, AIProvider>();

export function getProvider(id: ProviderId): AIProvider {
  const cached = cache.get(id);
  if (cached) return cached;

  let provider: AIProvider;
  switch (id) {
    case "gemini":
      provider = new GeminiProvider();
      break;
    case "groq":
      provider = new GroqProvider();
      break;
    case "openai":
      // Wired and ready. Throws a clear setup-instruction error if the
      // OPENAI_API_KEY env var is missing , the endpoint surfaces that
      // message verbatim so the agency knows what to do.
      provider = new OpenAIProvider();
      break;
    case "cloudflare":
      // Workers AI text generation. Same `CLOUDFLARE_API_TOKEN` and
      // `CLOUDFLARE_ACCOUNT_ID` used by the Pages deploy pipeline; the
      // token must additionally have `Workers AI: Read` scope. Default
      // model is Llama 3.3 70B FP8-fast (non-reasoning, ~3s response,
      // decent quality). Reasoning models like Kimi K2.6 / Qwen3 are
      // intentionally NOT exposed yet — they need 1500+ tokens just to
      // finish the JSON output, which makes interactive UX unviable.
      provider = new CloudflareProvider();
      break;
    case "claude":
      // Still a stub. Once we want Claude in production, mirror the
      // OpenAI adapter pattern in providers/claude.ts and replace this.
      throw new Error(
        `AI provider "claude" not implemented yet. Set composer_ai_settings.provider to 'openai', 'gemini', or 'groq'.`,
      );
    default: {
      // Exhaustiveness guard , TS yells if we add a new ProviderId
      // and forget to handle it here.
      const _exhaustive: never = id;
      throw new Error(`Unknown AI provider: ${String(_exhaustive)}`);
    }
  }

  cache.set(id, provider);
  return provider;
}
