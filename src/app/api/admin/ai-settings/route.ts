import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/admin/ai-settings
 *
 * Returns the single composer_ai_settings row (the copywriting guide,
 * provider, model). Any authenticated user with super_admin role can
 * read , the settings UI lives at /super/settings/ai. The composer's
 * generation endpoint reads via the admin client and bypasses this
 * route entirely.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = user.app_metadata?.role as string | undefined;
  if (role !== "super_admin" && role !== "tech_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("composer_ai_settings")
    .select("id, copywriting_guide, provider, model, is_active, updated_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: "No AI settings row found. Apply migration 00053." },
      { status: 404 },
    );
  }

  return NextResponse.json({ settings: data });
}

/**
 * PUT /api/admin/ai-settings
 *
 * Updates the single row. Body accepts:
 *   { copywriting_guide?, provider?, model?, is_active? }
 * , all optional, only present fields are written. super_admin only.
 */
export async function PUT(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = user.app_metadata?.role as string | undefined;
  if (role !== "super_admin" && role !== "tech_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const updates: Record<string, unknown> = {};
  if (typeof body.copywriting_guide === "string") {
    const trimmed = body.copywriting_guide.trim();
    if (trimmed.length === 0) {
      return NextResponse.json(
        { error: "Copywriting guide cannot be empty." },
        { status: 400 },
      );
    }
    updates.copywriting_guide = body.copywriting_guide;
  }
  if (typeof body.provider === "string") {
    if (
      !["gemini", "groq", "claude", "openai", "cloudflare"].includes(
        body.provider,
      )
    ) {
      return NextResponse.json(
        { error: `Unsupported provider: ${body.provider}` },
        { status: 400 },
      );
    }
    updates.provider = body.provider;
  }
  if (typeof body.model === "string") {
    updates.model = body.model;
  }
  if (typeof body.is_active === "boolean") {
    updates.is_active = body.is_active;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  updates.updated_at = new Date().toISOString();
  updates.updated_by = user.id;

  // Find the existing row and patch it. We never insert here , the
  // migration seeds exactly one row and the UI doesn't expose row
  // creation; if there's no row, that's a migration problem, not a
  // user problem.
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("composer_ai_settings")
    .select("id")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json(
      { error: "No AI settings row to update. Apply migration 00053." },
      { status: 404 },
    );
  }

  const { data, error } = await admin
    .from("composer_ai_settings")
    .update(updates)
    .eq("id", existing.id)
    .select("id, copywriting_guide, provider, model, is_active, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ settings: data });
}
