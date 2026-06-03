/**
 * AI image generation — prompt in, public Supabase URL out.
 *
 * Flow:
 *   1. Auth + ownership check (same gate as /api/composer/upload).
 *   2. Generate image via Cloudflare Workers AI (FLUX.2 [klein] default).
 *   3. Upload PNG bytes to the composer-staging bucket.
 *   4. Return the public URL — identical shape to /api/composer/upload's
 *      response, so the frontend can drop it straight into the field
 *      with no special-case handling.
 *
 * Why bucket-route instead of returning base64 to the client: keeps
 * memory bounded (no 1MB strings flying through React state), reuses
 * the existing publish-time staging→Cloudflare cleanup, and the URL
 * survives a page refresh just like a manual upload would.
 *
 * Permissions match /api/composer/upload exactly:
 *   - tech_admin / super_admin can generate for any site.
 *   - sales can generate for sites whose linked proposal they own.
 *   - client can generate for sites they own.
 *   - Everything else → 403.
 *
 * Cost note: each call is one image at ~50-150 neurons depending on
 * model. Free tier is 10k neurons/day, so ~75-200 free generations
 * per day before paid pricing ($0.011/1k neurons) kicks in.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  generateCloudflareImage,
  type CloudflareImageModel,
} from "@/lib/ai/providers/cloudflare";
import { finalizePrompt } from "@/lib/ai/image-prompt-builder";

/**
 * Maximum prompt length. FLUX-1-schnell caps at 2048 chars, FLUX.2
 * accepts more but quality degrades past ~500 — we enforce the lower
 * bound here so users learn to write tight prompts. Friendly error
 * message tells them why.
 */
const MAX_PROMPT_LENGTH = 1000;

const RequestBodySchema = z.object({
  site_id: z.string().uuid("site_id must be a UUID"),
  prompt: z
    .string()
    .min(3, "Prompt is too short")
    .max(MAX_PROMPT_LENGTH, `Prompt must be ${MAX_PROMPT_LENGTH} chars or less`),
  /** Optional model override. Defaults to flux-2-klein-9b. */
  model: z
    .enum(["flux-1-schnell", "flux-2-klein-9b", "flux-2-dev"])
    .optional(),
  /** Optional output dimensions. Ignored by flux-1-schnell. */
  width: z.number().int().min(256).max(2048).optional(),
  height: z.number().int().min(256).max(2048).optional(),
});

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = (user.app_metadata?.role as string | undefined) ?? "unknown";

  // Body parse + validate. Zod's error messages are user-readable so
  // we surface them directly — same pattern the rest of the codebase
  // uses for endpoint input validation.
  const json = await req.json().catch(() => null);
  const parsed = RequestBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const { site_id, prompt, model, width, height } = parsed.data;

  const admin = createAdminClient();

  // Ownership check — same shape as /api/composer/upload. Kept inline
  // (not extracted to a helper) because the rules are slightly nuanced
  // per role and the helper-extraction debate isn't settled yet.
  if (!["tech_admin", "super_admin"].includes(role)) {
    if (role === "sales") {
      const { data: siteRow } = await admin
        .from("sites")
        .select("proposal_id")
        .eq("id", site_id)
        .maybeSingle();
      if (!siteRow?.proposal_id) {
        return NextResponse.json({ error: "Site not found" }, { status: 404 });
      }
      const { data: linkedProposal } = await admin
        .from("proposals")
        .select("sales_person_id")
        .eq("id", siteRow.proposal_id)
        .maybeSingle();
      if (!linkedProposal || linkedProposal.sales_person_id !== user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else if (role === "client") {
      const { data: ownerRow } = await admin
        .from("sites")
        .select("owner_id")
        .eq("id", site_id)
        .maybeSingle();
      if (!ownerRow) {
        return NextResponse.json({ error: "Site not found" }, { status: 404 });
      }
      if (ownerRow.owner_id !== user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Always append the realism enforcer suffix server-side. Lives here
  // (not in the client) so a user editing the textarea can't disable
  // it — every generation through this endpoint is photoreal, no text,
  // no watermarks. See finalizePrompt() for the exact suffix.
  const finalPrompt = finalizePrompt(prompt);

  // Generate. Errors here include 401 (token scope), 429 (quota), 5xx
  // (Cloudflare side). All are surfaced verbatim to the UI so the
  // user knows what to do — adapter already prepends helpful hints.
  let result;
  try {
    result = await generateCloudflareImage({
      prompt: finalPrompt,
      model: model as CloudflareImageModel | undefined,
      width,
      height,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 502 because the upstream service (Cloudflare) failed. The
    // composer UI doesn't differentiate but ops dashboards do.
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Upload to staging bucket — same path scheme + same bucket as
  // manual uploads, so publish-time cleanup picks them up uniformly.
  const uuid =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const objectPath = `${site_id}/ai-${uuid}.png`;

  const { error: uploadErr } = await admin.storage
    .from("composer-staging")
    .upload(objectPath, result.bytes, {
      contentType: result.contentType,
      upsert: false,
      cacheControl: "3600",
    });
  if (uploadErr) {
    return NextResponse.json(
      { error: `Upload failed: ${uploadErr.message}` },
      { status: 500 },
    );
  }

  const { data: publicData } = admin.storage
    .from("composer-staging")
    .getPublicUrl(objectPath);

  return NextResponse.json({
    url: publicData.publicUrl,
    path: objectPath,
    durationMs: result.durationMs,
    model: model ?? "flux-1-schnell",
  });
}
