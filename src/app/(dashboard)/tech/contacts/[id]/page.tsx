import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import { TechContactDetail } from "./contact-detail";

export const dynamic = "force-dynamic";

export default async function TechContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("tech_admin");
  const { id } = await params;
  const admin = createAdminClient();

  const { data: contact, error } = await admin
    .from("contacts")
    .select(
      "id, company_name, contact_person, email, phone, industry, town, website_url, location, social_links, notes, quoted_price, client_status"
    )
    .eq("id", id)
    .single();

  if (error || !contact) {
    notFound();
  }

  // Find the latest proposal for this contact (if any)
  const { data: proposal } = await admin
    .from("proposals")
    .select("id, status, company_name")
    .eq("contact_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Find deployment info
  let deployment: { subdomain: string; github_url: string | null } | null = null;
  if (proposal) {
    const { data: dep } = await admin
      .from("deployments")
      .select("subdomain, github_url")
      .eq("proposal_id", proposal.id)
      .eq("deploy_status", "live")
      .limit(1)
      .maybeSingle();
    deployment = dep;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <TechContactDetail
        contact={contact}
        proposal={proposal}
        deployment={deployment}
      />
    </div>
  );
}
