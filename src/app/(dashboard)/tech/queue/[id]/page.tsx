import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { ChangeRequestReviewClient } from "./review-client";

export const dynamic = "force-dynamic";

export default async function ChangeRequestReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { profile } = await requireRole("tech_admin");
  const { id } = await params;
  const supabase = await createClient();

  const { data: request } = await supabase
    .from("change_requests")
    .select("*")
    .eq("id", id)
    .single();

  if (!request) notFound();

  // Fetch the site with URL
  const { data: site } = await supabase
    .from("sites")
    .select("id, name, slug, site_url, template_id")
    .eq("id", request.site_id)
    .single();

  // Fetch current sections for legacy change context
  const { data: sections } = await supabase
    .from("sections")
    .select("id, type, label, order, page, fields")
    .eq("site_id", request.site_id)
    .order("order", { ascending: true });

  return (
    <ChangeRequestReviewClient
      request={request as Record<string, unknown>}
      site={site as Record<string, unknown> | null}
      sections={(sections || []) as Record<string, unknown>[]}
      reviewerId={profile.id}
    />
  );
}
