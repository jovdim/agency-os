import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/public/designs
 * Returns available designs (completed proposals) that clients can choose from.
 * Auth: any authenticated user (clients need this)
 */
export async function GET() {
  await requireAuth();
  const supabase = await createClient();

  // Fetch completed proposals that have been deployed
  const { data: designs, error } = await supabase
    .from("proposals")
    .select("id, company_name, industry, town")
    .in("status", ["sent", "viewed", "accepted", "paid"])
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Also fetch deployments to get preview URLs
  const proposalIds = (designs || []).map((d) => d.id);
  const { data: deployments } = await supabase
    .from("deployments")
    .select("proposal_id, subdomain, deploy_status")
    .in("proposal_id", proposalIds.length > 0 ? proposalIds : ["none"])
    .eq("deploy_status", "live");

  const deploymentMap = new Map(
    (deployments || []).map((d) => [d.proposal_id, d.subdomain]),
  );

  const result = (designs || []).map((d) => ({
    id: d.id,
    company_name: d.company_name,
    industry: d.industry,
    town: d.town,
    preview_url: deploymentMap.has(d.id)
      ? `https://${deploymentMap.get(d.id)}.pages.dev`
      : null,
  }));

  return NextResponse.json({ designs: result });
}
