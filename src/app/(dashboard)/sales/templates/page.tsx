import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { TemplatesClient } from "./templates-client";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const { profile } = await requireRole("sales");
  const supabase = await createClient();

  const { data: templates } = await supabase
    .from("email_templates")
    .select("id, name, subject, body_html, category, is_default, created_at, updated_at")
    .eq("owner_id", profile.id)
    .order("updated_at", { ascending: false });

  return <TemplatesClient templates={templates ?? []} />;
}
