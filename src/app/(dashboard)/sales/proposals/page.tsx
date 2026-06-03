import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { ProposalsListClient } from "./proposals-list-client";
import type { ProposalTag } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function SalesProposalsPage({
  searchParams,
}: {
  // Optional pre-applied tag filter (`?tag=urgent`). Drives initial
  // checked state on the filter bar — used by the dashboard's
  // "X urgent proposals" banner so clicking lands on a pre-filtered list.
  searchParams: Promise<{ tag?: string | string[] }>;
}) {
  const { profile } = await requireRole("sales");
  const supabase = createAdminClient();
  const sp = await searchParams;
  const initialTagSlugs = Array.isArray(sp.tag)
    ? sp.tag.filter(Boolean)
    : sp.tag
      ? [sp.tag]
      : [];

  // Fan-out three queries in parallel:
  //   - the proposals themselves (scoped to this salesperson)
  //   - the full tag library (small, shared, ~10 rows)
  //   - tag assignments for the proposals on this page (one query, then
  //     stitched in memory — avoids N+1 round-trips)
  const { data: proposals } = await supabase
    .from("proposals")
    .select(
      `id, company_name, industry, town, status, created_at, updated_at, slug,
      discount_price, base_price, sent_at, paid_at,
      contacts(contact_person, phone, email),
      deployments(subdomain, deploy_status)`
    )
    .eq("sales_person_id", profile.id)
    .order("updated_at", { ascending: false })
    .range(0, 199);

  const proposalIds = (proposals ?? []).map((p) => p.id);

  const [{ data: tags }, { data: assignments }] = await Promise.all([
    supabase
      .from("proposal_tags")
      .select("id, name, slug, color, created_by, created_at")
      .order("created_at", { ascending: true }),
    proposalIds.length === 0
      ? Promise.resolve({ data: [] })
      : supabase
          .from("proposal_tag_assignments")
          .select("proposal_id, tag_id")
          .in("proposal_id", proposalIds),
  ]);

  // Build proposal_id → ProposalTag[] map up front so the client component
  // doesn't need to do a join scan per row on every render.
  const tagsById = new Map<string, ProposalTag>(
    (tags ?? []).map((t) => [t.id, t as ProposalTag]),
  );
  const tagsByProposal = new Map<string, ProposalTag[]>();
  for (const row of (assignments ?? []) as { proposal_id: string; tag_id: string }[]) {
    const tag = tagsById.get(row.tag_id);
    if (!tag) continue;
    const list = tagsByProposal.get(row.proposal_id) ?? [];
    list.push(tag);
    tagsByProposal.set(row.proposal_id, list);
  }

  // Plain-object map for serialization (Maps don't survive the server
  // → client component boundary).
  const proposalTags: Record<string, ProposalTag[]> = {};
  for (const [pid, list] of tagsByProposal) {
    proposalTags[pid] = list;
  }

  // Resolve incoming slugs to tag IDs so the client component can seed
  // its (id-based) filter set without a second round-trip.
  const slugSet = new Set(initialTagSlugs);
  const initialTagIds = ((tags ?? []) as ProposalTag[])
    .filter((t) => slugSet.has(t.slug))
    .map((t) => t.id);

  return (
    <ProposalsListClient
      proposals={proposals || []}
      proposalTags={proposalTags}
      allTags={(tags as ProposalTag[]) || []}
      initialTagIds={initialTagIds}
    />
  );
}
