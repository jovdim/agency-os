import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildPrompt, type AiInputs, type TemplateMeta } from "@/lib/ai/prompt-builder";
import { buildResponseSchema } from "@/lib/ai/schema";
import { getProvider } from "@/lib/ai/provider";
import { scrubAiResponse } from "@/lib/ai/post-process";
import type { ProviderId } from "@/lib/ai/types";
import type { SiteComposition } from "@/lib/templates/render";
import type { FieldSchema, FieldValue } from "@/components/composer/placeholder-field";

/**
 * POST /api/composer/ai-generate
 *
 * The single entrypoint for AI text generation. Both the global "✨
 * Generate content" button and the per-section ✨ regenerate button
 * call this , the body's `mode` field switches behaviour:
 *
 *   mode="all"     → fill every empty placeholder across the site,
 *                    skip any field already edited.
 *   mode="section" → overwrite all fields in one section, optionally
 *                    biased by `custom_prompt`.
 *
 * Returns a flat overrides map ready for the composer to apply via
 * its existing updateSectionContent path:
 *
 *   {
 *     "sec_001": { "hero_headline": "...", "hero_subheadline": "..." },
 *     "sec_002": { "services_items": [{...}, {...}] },
 *     ...
 *   }
 *
 * Auto-fills contact fields (phone/email/address) from proposal data
 * directly , those NEVER go to the AI so we can't hallucinate fake
 * numbers.
 */

interface GenerateBody {
  site_id: string;
  mode: "all" | "section";
  section_id?: string;
  inputs: AiInputs;
  custom_prompt?: string;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();

  // ── Auth ──
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = user.app_metadata?.role as string | undefined;

  // Tech/super always; sales on sites whose linked proposal they own
  // (added 2026-05-10 — shared composer parity); client only on sites
  // they own. Same gate shape as the composer's PUT/publish endpoints.
  const admin = createAdminClient();
  const body = (await req.json().catch(() => null)) as GenerateBody | null;
  if (!body || typeof body.site_id !== "string") {
    return NextResponse.json({ error: "site_id required" }, { status: 400 });
  }

  let isAllowed = role === "tech_admin" || role === "super_admin";
  if (!isAllowed && role === "sales") {
    const { data: siteRow } = await admin
      .from("sites")
      .select("proposal_id")
      .eq("id", body.site_id)
      .maybeSingle();
    if (siteRow?.proposal_id) {
      const { data: linkedProposal } = await admin
        .from("proposals")
        .select("sales_person_id")
        .eq("id", siteRow.proposal_id)
        .maybeSingle();
      isAllowed =
        !!linkedProposal && linkedProposal.sales_person_id === user.id;
    }
  }
  if (!isAllowed && role === "client") {
    const { data: ownerRow } = await admin
      .from("sites")
      .select("owner_id")
      .eq("id", body.site_id)
      .maybeSingle();
    isAllowed = !!ownerRow && ownerRow.owner_id === user.id;
  }
  if (!isAllowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (body.mode !== "all" && body.mode !== "section") {
    return NextResponse.json(
      { error: "mode must be 'all' or 'section'" },
      { status: 400 },
    );
  }
  if (body.mode === "section" && !body.section_id) {
    return NextResponse.json(
      { error: "section_id required when mode=section" },
      { status: 400 },
    );
  }
  if (!body.inputs || typeof body.inputs !== "object") {
    return NextResponse.json({ error: "inputs required" }, { status: 400 });
  }

  // ── Load AI settings (single row) ──
  const { data: settings } = await admin
    .from("composer_ai_settings")
    .select("copywriting_guide, provider, model, is_active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!settings) {
    return NextResponse.json(
      { error: "AI settings not configured. Apply migration 00053." },
      { status: 503 },
    );
  }
  if (!settings.is_active) {
    return NextResponse.json(
      { error: "AI generation is disabled in settings." },
      { status: 503 },
    );
  }

  // ── Load site composition ──
  const { data: site } = await admin
    .from("sites")
    .select("id, composition, proposal_id")
    .eq("id", body.site_id)
    .maybeSingle();
  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }
  const composition = site.composition as SiteComposition | null;
  if (!composition?.pages?.[0]) {
    return NextResponse.json(
      { error: "Site has no composition to fill" },
      { status: 400 },
    );
  }

  // ── Load templates the composition references ──
  const sections = composition.pages[0].sections ?? [];
  const templateIds = Array.from(new Set(sections.map((s) => s.template_id)));
  const { data: templateRows } = await admin
    .from("section_templates")
    .select("id, category, placeholder_schema")
    .in("id", templateIds);

  const templates = new Map<string, TemplateMeta>();
  for (const row of templateRows ?? []) {
    templates.set(row.id, {
      id: row.id,
      category: row.category,
      schema: (row.placeholder_schema ?? {}) as Record<string, FieldSchema>,
    });
  }

  // ── Build prompt + Zod schema ──
  let prompt;
  try {
    prompt = buildPrompt({
      copywritingGuide: settings.copywriting_guide,
      composition,
      templates,
      inputs: body.inputs,
      mode: body.mode,
      sectionId: body.section_id,
      customPrompt: body.custom_prompt,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Prompt build failed" },
      { status: 400 },
    );
  }

  if (prompt.specs.length === 0) {
    // mode=all and every section is already filled. Not a hard error
    // , UI shows a friendly toast.
    return NextResponse.json({
      overrides: {},
      message: "Every text field is already filled. Nothing to generate.",
    });
  }

  const responseSchema = buildResponseSchema(prompt.specs);

  // ── Call provider ──
  const providerId = settings.provider as ProviderId;
  let aiResult;
  try {
    const provider = getProvider(providerId);
    aiResult = await provider.generate(
      {
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        expectedSchema: responseSchema,
      },
      settings.model,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Best-effort log on hard failure , wrap in catch so logging
    // failure doesn't shadow the original error.
    await admin
      .from("ai_generations")
      .insert({
        site_id: body.site_id,
        user_id: user.id,
        mode: body.mode,
        section_id: body.section_id ?? null,
        custom_prompt: body.custom_prompt ?? null,
        provider: providerId,
        model: settings.model,
        duration_ms: Date.now() - startedAt,
        status: "failed",
        error: errMsg.slice(0, 1000),
      })
      .then(() => undefined, () => undefined);
    return NextResponse.json({ error: errMsg }, { status: 502 });
  }

  // ── Scrub AI output (em-dashes, bullets, double-commas) ──
  // Provider-agnostic , every model goes through this. OpenAI/GPT
  // is the most prolific em-dash offender; this guarantees they
  // never reach a client site even if the model ignores the guide.
  // Result counts are dropped for now , add a `scrub_flags jsonb`
  // column to ai_generations if/when we want a quality dashboard.
  const { cleaned: scrubbedAi } = scrubAiResponse(aiResult.parsedJson);

  // ── Auto-fill contact fields from proposal data ──
  const contactOverrides = await loadContactOverrides({
    admin,
    proposalId: site.proposal_id,
    composition,
    templates,
  });

  // ── Merge AI output + contact fills into final overrides map ──
  const overrides: Record<string, Record<string, FieldValue>> = {};
  const aiObj = scrubbedAi as Record<string, Record<string, FieldValue>>;
  for (const [sectionId, sectionFields] of Object.entries(aiObj)) {
    overrides[sectionId] = { ...sectionFields };
  }
  for (const [sectionId, sectionFields] of Object.entries(contactOverrides)) {
    overrides[sectionId] = {
      ...(overrides[sectionId] ?? {}),
      ...sectionFields,
    };
  }

  // ── Log success ──
  const inputTokens = aiResult.inputTokens ?? null;
  const outputTokens = aiResult.outputTokens ?? null;
  await admin
    .from("ai_generations")
    .insert({
      site_id: body.site_id,
      user_id: user.id,
      mode: body.mode,
      section_id: body.section_id ?? null,
      custom_prompt: body.custom_prompt ?? null,
      provider: providerId,
      model: settings.model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_estimate_usd: estimateCostUsd(providerId, inputTokens, outputTokens),
      duration_ms: Date.now() - startedAt,
      status: aiResult.retried ? "parse_retry" : "success",
    })
    .then(() => undefined, () => undefined);

  return NextResponse.json({ overrides });
}

/* ─────────────────────────────────────────────────────────────
   Contact field auto-fill , phone, email, address
   ───────────────────────────────────────────────────────────── */

/**
 * For every section that has a contact-shaped field key (phone, email,
 * address, …) AND the proposal has a value for it, return the value
 * keyed by section id + field key. The endpoint merges this on top
 * of AI output so the live data wins.
 */
async function loadContactOverrides(args: {
  admin: ReturnType<typeof createAdminClient>;
  proposalId: string | null | undefined;
  composition: SiteComposition;
  templates: Map<string, TemplateMeta>;
}): Promise<Record<string, Record<string, FieldValue>>> {
  if (!args.proposalId) return {};

  const { data: proposal } = await args.admin
    .from("proposals")
    .select(
      "id, company_name, town, contacts(contact_person, phone, email, business_email, location, location_raw)",
    )
    .eq("id", args.proposalId)
    .maybeSingle();
  if (!proposal) return {};

  type ContactRow = {
    contact_person: string | null;
    phone: string | null;
    email: string | null;
    business_email: string | null;
    location: string | null;
    location_raw: string | null;
  };
  const contactRaw = (proposal as { contacts?: ContactRow | ContactRow[] })
    .contacts;
  const contact: ContactRow | null = Array.isArray(contactRaw)
    ? contactRaw[0] ?? null
    : contactRaw ?? null;
  if (!contact) return {};

  const phone = contact.phone ?? "";
  // Prefer the business email when present (info@…), fall back to the
  // contact's personal email otherwise. Real client sites show the
  // company address, not the salesperson's gmail.
  const email = contact.business_email ?? contact.email ?? "";
  const address = contact.location_raw ?? contact.location ?? "";

  const out: Record<string, Record<string, FieldValue>> = {};
  for (const sec of args.composition.pages[0]?.sections ?? []) {
    const tpl = args.templates.get(sec.template_id);
    if (!tpl) continue;
    for (const [key] of Object.entries(tpl.schema)) {
      const lower = key.toLowerCase();
      let value: string | null = null;
      if (lower.includes("phone") && phone) value = phone;
      else if (lower.includes("email") && email) value = email;
      else if (
        (lower.includes("address") ||
          lower.includes("street") ||
          lower.includes("city")) &&
        address
      ) {
        value = address;
      }
      if (value !== null) {
        out[sec.id] = { ...(out[sec.id] ?? {}), [key]: value };
      }
    }
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────
   Cost estimation (tracking on free tier, accurate when paid)
   ───────────────────────────────────────────────────────────── */

function estimateCostUsd(
  provider: ProviderId,
  inputTokens: number | null,
  outputTokens: number | null,
): number {
  if (inputTokens == null || outputTokens == null) return 0;
  // Per-1M token rates. Update when new models / providers added.
  const RATES: Record<ProviderId, { in: number; out: number }> = {
    gemini: { in: 0.075, out: 0.3 }, // Gemini 2.0 Flash paid (free during dev)
    groq: { in: 0, out: 0 }, // Groq free tier , paid tier ~$0.59/$0.79 per 1M
    claude: { in: 1.0, out: 5.0 }, // Claude Haiku 4.5
    openai: { in: 0.15, out: 0.6 }, // GPT-4o-mini
    // Cloudflare Workers AI: free up to 10k neurons/day, then
    // $0.011/1k neurons. Llama 3.3 70B is ~0.16 neurons/1k input
    // tokens, ~3.5 neurons/1k output tokens — translates to roughly
    // $0.0017 input / $0.038 output per 1M tokens. Free during dev.
    cloudflare: { in: 0.0017, out: 0.038 },
  };
  const rate = RATES[provider];
  return (inputTokens * rate.in + outputTokens * rate.out) / 1_000_000;
}
