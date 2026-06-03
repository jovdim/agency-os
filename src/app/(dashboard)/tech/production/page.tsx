import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { TechProductionClient } from "./production-client";

type SiteRow = {
  id: string;
  proposal_id: string | null;
  name: string | null;
  subdomain: string | null;
  site_url: string | null;
  // Custom domain state — domain is the host (e.g. "nexedge.sk"),
  // domain_setup_status reflects the actual Cloudflare verification
  // ('active' / 'pending' / 'failed'), domain_status is the older
  // business-workflow flag (super admin approval). Visit URL logic in
  // the client component prefers the custom domain when verified-active.
  domain: string | null;
  domain_status: string | null;
  domain_setup_status: string | null;
  last_published_at: string | null;
  is_legacy: boolean | null;
  is_paid: boolean | null;
  proposals: {
    id: string;
    company_name: string;
    paid_at: string | null;
    contacts: { phone: string | null } | null;
  } | null;
};

export const dynamic = "force-dynamic";

export default async function TechProductionPage() {
  await requireRole("tech_admin");
  const admin = createAdminClient();

  // "Live" = published on Cloudflare. Two signals depending on which
  // pipeline ran:
  //   - Modern (composer publish): sets sites.last_published_at
  //   - Legacy (deployWebsite): writes a row to deployments and may NOT
  //     touch sites.last_published_at
  // Combine both so neither pipeline gets dropped from the page.
  const [{ data: allSites }, { data: liveDeployments }] = await Promise.all([
    admin
      .from("sites")
      .select(
        "id, proposal_id, name, subdomain, site_url, domain, domain_status, domain_setup_status, last_published_at, is_legacy, is_paid, proposals(id, company_name, paid_at, contacts(phone))",
      )
      .order("last_published_at", { ascending: false, nullsFirst: false }),
    admin
      .from("deployments")
      .select("proposal_id")
      .eq("deploy_status", "live"),
  ]);

  const liveProposalIds = new Set(
    (liveDeployments ?? [])
      .map((d) => d.proposal_id)
      .filter((id): id is string => !!id),
  );

  // Keep sites that are either composer-published OR have a live legacy
  // deployment. Sites that exist but have neither signal are pre-publish
  // placeholders and don't belong on this page.
  const liveSites = ((allSites ?? []) as unknown as SiteRow[]).filter(
    (s) =>
      s.last_published_at !== null ||
      (s.proposal_id !== null && liveProposalIds.has(s.proposal_id)),
  );

  // Dedupe by proposal_id, keeping the most recent site per proposal.
  // The query already orders by last_published_at DESC NULLS LAST, so the
  // first occurrence of any proposal_id is the latest. Business rule per
  // memory: one site per client. Multiple site rows per proposal_id is
  // bad data (test artifacts / race conditions) — drop the older ones
  // here, surface a DB cleanup task separately.
  //
  // Orphan sites (proposal_id = null) are kept as-is — they're rare and
  // we don't want to silently hide them.
  const seenProposals = new Set<string>();
  const deduped = liveSites.filter((s) => {
    if (!s.proposal_id) return true;
    if (seenProposals.has(s.proposal_id)) return false;
    seenProposals.add(s.proposal_id);
    return true;
  });

  return <TechProductionClient sites={deduped} />;
}
