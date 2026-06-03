import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { ProductionClient } from "./production-client";

export const dynamic = "force-dynamic";

export default async function ProductionPage() {
  const { profile } = await requireRole("sales");
  const admin = createAdminClient();

  // Get all paid proposals for this salesperson
  const { data: proposals } = await admin
    .from("proposals")
    .select(
      "id, slug, company_name, industry, town, status, price, discount_price, base_price, paid_at, sent_at, created_at, updated_at, contacts(company_name, contact_person, email, phone)"
    )
    .eq("sales_person_id", profile.id)
    .eq("status", "paid")
    .order("paid_at", { ascending: false });

  // Get deployments for these proposals
  const proposalIds = (proposals ?? []).map((p) => p.id);
  const { data: deployments } = proposalIds.length
    ? await admin
        .from("deployments")
        .select("id, proposal_id, subdomain, deploy_status, deployed_at")
        .in("proposal_id", proposalIds)
        .eq("deploy_status", "live")
    : { data: [] };

  // Map deployments by proposal_id
  const deploymentMap = new Map(
    (deployments ?? []).map((d) => [d.proposal_id, d])
  );

  const normalized = (proposals ?? []).map((p) => ({
    ...p,
    contacts: Array.isArray(p.contacts) ? p.contacts[0] ?? null : p.contacts,
    deployment: deploymentMap.get(p.id) ?? null,
  }));

  return (
    <ProductionClient
      proposals={normalized as any}
    />
  );
}
