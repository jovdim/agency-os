import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { ArchiveClient } from "./archive-client";

export const dynamic = "force-dynamic";

export default async function ArchivePage() {
  const { profile } = await requireRole("sales");
  const supabase = await createClient();

  // Get all archived contacts for this salesperson
  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, company_name, contact_person, phone, email, industry, town, website_url, status, updated_at, created_at")
    .eq("assigned_to", profile.id)
    .eq("status", "archived")
    .order("updated_at", { ascending: false });

  return <ArchiveClient contacts={contacts ?? []} />;
}
