import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import { ContactDetailClient } from "./contact-detail-client";

export const dynamic = "force-dynamic";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { profile } = await requireRole("sales");
  const supabase = await createClient();
  const { id } = await params;

  // Contact lookup (RLS-scoped, sales-only) + proposals lookup in parallel.
  // Page is already protected by requireRole("sales"); we use admin for
  // proposals to avoid a second RLS round-trip. Neither query needs the
  // other's result — running them concurrently saves a round-trip on
  // every contact-detail visit.
  const admin = createAdminClient();
  const [{ data: contact }, { data: proposals }] = await Promise.all([
    supabase.from("contacts").select("*").eq("id", id).single(),
    admin
      .from("proposals")
      .select("id, status, sent_at, created_at, company_name, services, price, discount_price, base_price, requirements, industry, town, client_temp_password")
      .eq("contact_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (!contact) {
    notFound();
  }

  // Get deployment info for proposals
  const proposalIds = (proposals || []).map((p: { id: string }) => p.id);
  let deployments: Record<string, { id: string; subdomain: string; url: string }> = {};
  if (proposalIds.length > 0) {
    const { data: deps } = await admin
      .from("deployments")
      .select("id, proposal_id, subdomain")
      .in("proposal_id", proposalIds)
      .eq("deploy_status", "live");
    if (deps) {
      deployments = Object.fromEntries(
        deps.map((d: { id: string; proposal_id: string; subdomain: string }) => [
          d.proposal_id,
          { id: d.id, subdomain: d.subdomain, url: `https://${d.subdomain}.pages.dev` },
        ])
      );
    }
  }

  return (
    <ContactDetailClient
      contact={contact}
      proposals={proposals ?? []}
      deployments={deployments}
      currentUserId={profile.id}
    />
  );
}
