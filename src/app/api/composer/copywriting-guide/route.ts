import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/composer/copywriting-guide
 *
 * Returns the active copywriting guide so the JSON round-trip modal
 * can bake it into the instructions the user pastes into ChatGPT.
 * Same source the in-app AI Fill uses — keeping both paths on one
 * canonical guide means the JSON workflow produces output that
 * follows the same Slovak voice rules.
 *
 * Tech/super only — matches the JSON round-trip feature's role gate.
 *
 * Returns `{ guide: string | null }`. Null means "no settings row
 * configured yet"; the modal degrades gracefully to a shorter
 * instruction block in that case.
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
  if (role !== "tech_admin" && role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("composer_ai_settings")
    .select("copywriting_guide")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    guide: settings?.copywriting_guide ?? null,
  });
}
