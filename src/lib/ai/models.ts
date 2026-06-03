/**
 * Static registry of "models we know are good for this product."
 *
 * Keeps the AI settings UI typo-proof , Peter (or any super_admin)
 * picks a provider from a dropdown, and the model dropdown filters to
 * only that provider's known-good options. No more memorising
 * "gpt-4o-mini" vs "gpt-4o" vs "gpt-4-turbo" by heart.
 *
 * Adding a new model = one entry here. The factory + adapters don't
 * need to change , the model string is forwarded as-is to the
 * provider API.
 *
 * Cost figures are PER WHOLE-SITE FILL (~5K input + ~3K output) and
 * approximate , real cost depends on prompt length. They exist to
 * give Peter a one-glance sense of "cheap vs premium" in the UI, not
 * to be billed against.
 */

import type { ProviderId } from "./types";

export interface ModelOption {
  /** Exact model string the provider API expects. */
  value: string;
  /** Human-friendly name for the dropdown. */
  label: string;
  /** Cost-per-site rule of thumb, shown in the UI. */
  cost: string;
  /** One-line quality / use-case hint. */
  hint: string;
  /** Marks the option that's the right default for most users. */
  recommended?: boolean;
}

export const MODELS_BY_PROVIDER: Record<ProviderId, ModelOption[]> = {
  openai: [
    {
      value: "gpt-4o-mini",
      label: "GPT-4o mini",
      cost: "~$0.003/site",
      hint: "Cheap and fast. Good quality. The right starting point.",
      recommended: true,
    },
    {
      value: "gpt-4o",
      label: "GPT-4o",
      cost: "~$0.03/site",
      hint: "10x more expensive but sharper headlines, better nuance.",
    },
    {
      value: "gpt-5-mini",
      label: "GPT-5 mini",
      cost: "~$0.005/site",
      hint: "Newer generation. Slightly better than 4o-mini at similar cost.",
    },
    {
      value: "gpt-5",
      label: "GPT-5",
      cost: "~$0.05/site",
      hint: "Premium tier. Use only when 4o-mini quality isn't enough.",
    },
  ],
  groq: [
    {
      value: "llama-3.3-70b-versatile",
      label: "Llama 3.3 70B",
      cost: "Free",
      hint: "Decent quality. Solid free fallback for development.",
      recommended: true,
    },
    {
      value: "llama-3.1-8b-instant",
      label: "Llama 3.1 8B",
      cost: "Free",
      hint: "Faster, weaker quality. Use only for quick smoke tests.",
    },
  ],
  gemini: [
    {
      value: "gemini-2.0-flash",
      label: "Gemini 2.0 Flash",
      cost: "Free / paid",
      hint: "Free tier blocked in some regions , set up billing first.",
      recommended: true,
    },
    {
      value: "gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
      cost: "~$0.005/site",
      hint: "Newer, better quality than 2.0 Flash.",
    },
    {
      value: "gemini-2.5-pro",
      label: "Gemini 2.5 Pro",
      cost: "~$0.05/site",
      hint: "Premium Gemini. Roughly comparable to GPT-5.",
    },
  ],
  claude: [
    {
      value: "claude-haiku-4-5",
      label: "Claude Haiku 4.5",
      cost: "~$0.01/site",
      hint: "Best style-guide adherence. Stub , not yet wired.",
    },
    {
      value: "claude-sonnet-4-6",
      label: "Claude Sonnet 4.6",
      cost: "~$0.05/site",
      hint: "Top-tier nuance. Stub , not yet wired.",
    },
  ],
  cloudflare: [
    {
      value: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      label: "Llama 3.3 70B (Cloudflare)",
      cost: "Free up to 10k neurons/day",
      hint: "Same weights as Groq's Llama, hosted on Cloudflare. ~3s response, no per-minute rate cap, decent quality. Recommended free default.",
      recommended: true,
    },
    {
      value: "@cf/openai/gpt-oss-120b",
      label: "GPT-OSS 120B (Cloudflare)",
      cost: "Free up to 10k neurons/day",
      hint: "OpenAI's open-weight model. Larger than Llama 3.3 70B, slightly stronger quality. Slower, higher neuron cost.",
    },
  ],
};

/**
 * Marketing-y label + status hint for the provider dropdown. Lives
 * here (not inline in the UI) so we have one source of truth for
 * "which providers are ready to use" , adding a new one means
 * updating this map and the factory, nothing else.
 */
export const PROVIDERS: Array<{
  id: ProviderId;
  label: string;
  status: "ready" | "needs_key" | "stub";
  note: string;
  /**
   * Where to send the user when they click "Check exact balance" in
   * the settings page. Each vendor's billing/usage live on different
   * pages , this URL is the deep link to the most useful one for
   * "how much credit do I have left + what have I spent." Browser
   * session cookie (i.e. logged into the vendor) does the rest.
   */
  dashboardUrl: string;
}> = [
  {
    id: "openai",
    label: "OpenAI (ChatGPT)",
    status: "needs_key",
    note: "Recommended. Set OPENAI_API_KEY in env to activate.",
    dashboardUrl: "https://platform.openai.com/usage",
  },
  {
    id: "groq",
    label: "Groq",
    status: "ready",
    note: "Free tier, no billing needed. Decent quality, good for dev.",
    dashboardUrl: "https://console.groq.com/dashboard/usage",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    status: "ready",
    note: "Free tier blocked in some regions.",
    dashboardUrl: "https://aistudio.google.com/app/apikey",
  },
  {
    id: "claude",
    label: "Anthropic Claude",
    status: "stub",
    note: "Not yet wired in code. Coming when needed.",
    dashboardUrl: "https://console.anthropic.com/settings/billing",
  },
  {
    id: "cloudflare",
    label: "Cloudflare Workers AI",
    status: "ready",
    note: "Same token as Pages deploy. Add 'Workers AI: Read' scope on the existing token. 10k neurons/day free, no EU restriction, no per-minute rate wall (unlike Groq). Generates text + images.",
    dashboardUrl: "https://dash.cloudflare.com/?to=/:account/workers-ai",
  },
];

/**
 * Look up the recommended default model for a provider. Used by the
 * settings UI when the user switches provider , model auto-snaps to
 * the right default instead of staying stale on the previous
 * provider's string.
 */
export function getDefaultModel(provider: ProviderId): string {
  const list = MODELS_BY_PROVIDER[provider] ?? [];
  return list.find((m) => m.recommended)?.value ?? list[0]?.value ?? "";
}

/**
 * Find the metadata for a specific (provider, model) pair. Returns
 * null if the model isn't in the registry , the UI uses this to fall
 * back gracefully when the DB row references a model we don't know
 * about (e.g. set manually via SQL, or a model we removed).
 */
export function findModelOption(
  provider: ProviderId,
  modelValue: string,
): ModelOption | null {
  const list = MODELS_BY_PROVIDER[provider] ?? [];
  return list.find((m) => m.value === modelValue) ?? null;
}
