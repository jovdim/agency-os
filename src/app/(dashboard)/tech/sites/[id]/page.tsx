import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { SiteEditorClient } from "./site-editor-client";

export const dynamic = "force-dynamic";

export default async function SiteEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("tech_admin");
  const { id } = await params;
  const supabase = await createClient();

  const { data: site } = await supabase
    .from("sites")
    .select("*")
    .eq("id", id)
    .single();

  if (!site) notFound();

  const { data: sections } = await supabase
    .from("sections")
    .select("*")
    .eq("site_id", id)
    .order("order", { ascending: true });

  return (
    <SiteEditorClient
      site={site as Record<string, unknown>}
      initialSections={(sections || []) as Record<string, unknown>[]}
    />
  );
}
