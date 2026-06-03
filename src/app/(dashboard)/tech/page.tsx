import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { Inbox, History, ArrowRight } from "lucide-react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ProposalTagChips } from "@/components/proposal-tags/proposal-tag-chips";
import type { ProposalTag } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function TechDashboard() {
  await requireRole("tech_admin");
  const admin = createAdminClient();

  // Dashboard surfaces the active work (proposals waiting to build) prominently
  // and the legacy change-request queue as a deprioritized strip — modern
  // composer clients publish their own edits, so the change-request queue only
  // matters for legacy sites still on that workflow.
  //
  // Rule (Peter 2026-05-11, "publish is the pivot"): "new" = NOT yet published.
  // Status enum is ignored — a proposal stays on this stat card until its
  // linked site is actually live, regardless of submitted/building/revision/
  // sent/viewed/paid value.
  //
  // "Live" comes from TWO independent signals (must mirror /tech/production
  // exactly, or proposals leak between the two surfaces):
  //   - Modern (composer publish): sites.last_published_at IS NOT NULL
  //   - Legacy (deployWebsite):    deployments row with deploy_status='live'
  //     The legacy pipeline never touches last_published_at — checking only
  //     sites would leave deployed legacy proposals stuck in the queue.
  const NEW_PROPOSALS_DASHBOARD_LIMIT = 20;
  const [{ data: publishedSiteRows }, { data: liveDeployRows }] =
    await Promise.all([
      admin
        .from("sites")
        .select("proposal_id")
        .not("proposal_id", "is", null)
        .not("last_published_at", "is", null),
      admin
        .from("deployments")
        .select("proposal_id")
        .eq("deploy_status", "live")
        .not("proposal_id", "is", null),
    ]);
  const publishedProposalIds = new Set<string>();
  for (const r of publishedSiteRows ?? []) {
    if (r.proposal_id) publishedProposalIds.add(r.proposal_id as string);
  }
  for (const r of liveDeployRows ?? []) {
    if (r.proposal_id) publishedProposalIds.add(r.proposal_id as string);
  }

  const [{ data: allProposalsData }, { data: pendingCRs }] = await Promise.all([
    admin
      .from("proposals")
      .select("id, company_name, updated_at, contacts(contact_person)")
      .order("updated_at", { ascending: false }),
    admin
      .from("change_requests")
      .select("site_id")
      .eq("status", "pending"),
  ]);

  const allProposals = (allProposalsData || []) as unknown as {
    id: string;
    company_name: string;
    updated_at: string;
    contacts: { contact_person: string | null } | null;
  }[];

  const unpublished = allProposals.filter(
    (p) => !publishedProposalIds.has(p.id),
  );
  const totalNewProposals = unpublished.length;
  const newProposals = unpublished.slice(0, NEW_PROPOSALS_DASHBOARD_LIMIT);
  const isProposalsListTruncated = totalNewProposals > newProposals.length;

  // Headline number for client edits = unique clients with pending requests,
  // not raw request rows. A single client can submit many change_request rows
  // over time; what matters operationally is "how many clients am I behind on."
  const totalPendingCRs = pendingCRs?.length ?? 0;
  const clientsWithPendingCRs = new Set(
    (pendingCRs ?? []).map((r) => r.site_id),
  ).size;

  function name(p: typeof newProposals[number]) {
    return p.company_name || p.contacts?.contact_person || "Unnamed";
  }

  // Priority/custom tags for the new-proposals list — IT triages by these
  // (Urgent / Priority / Premium / Basic chips render under each company name).
  const tagsByProposal: Record<string, ProposalTag[]> = {};
  if (newProposals.length > 0) {
    const { data: assignments } = await admin
      .from("proposal_tag_assignments")
      .select("proposal_id, proposal_tags(id, name, slug, color, created_by, created_at)")
      .in("proposal_id", newProposals.map((p) => p.id));
    for (const row of assignments ?? []) {
      const tag = Array.isArray(row.proposal_tags) ? row.proposal_tags[0] : row.proposal_tags;
      if (!tag) continue;
      const list = tagsByProposal[row.proposal_id as string] ?? [];
      list.push(tag as ProposalTag);
      tagsByProposal[row.proposal_id as string] = list;
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* ── Header ── */}
      <div>
        <h1 className="text-xl font-semibold">Tech Dashboard</h1>
        <p className="text-sm text-muted-foreground">Your build queue at a glance</p>
      </div>

      {/* ── Primary stat: new proposals to build ── */}
      <div className="sm:max-w-md">
        <Link href="/tech/proposals">
          <div className="tile-interactive rounded-lg border bg-card p-4 hover:shadow-md hover:border-foreground/15">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide truncate">
                  New Proposals
                </p>
                <p
                  className={`text-3xl font-bold mt-1 ${
                    totalNewProposals > 0 ? "text-purple-600 dark:text-purple-400" : ""
                  }`}
                >
                  {totalNewProposals}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Waiting to build</p>
              </div>
              <div className="rounded-md p-2 shrink-0 bg-purple-100 dark:bg-purple-900/30">
                <Inbox className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              </div>
            </div>
          </div>
        </Link>
      </div>

      {/* ── New Proposals list ── */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <Inbox className="h-4 w-4 text-purple-500" />
          <span className="text-sm font-semibold">New Proposals</span>
          <Link href="/tech/proposals" className="ml-auto text-xs text-primary hover:underline">
            View all
          </Link>
        </div>
        {newProposals.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            No new proposals
          </div>
        ) : (
          <>
            <div className="divide-y">
              {newProposals.map((p) => (
                <Link
                  key={p.id}
                  href={`/tech/proposals/${p.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{name(p)}</p>
                    {tagsByProposal[p.id]?.length > 0 && (
                      <ProposalTagChips
                        tags={tagsByProposal[p.id]}
                        size="minimal"
                        className="mt-0.5"
                      />
                    )}
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(p.updated_at), { addSuffix: true })}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
            {/* Bottom "View all" — only when the list overflows the cap, so
                if you scrolled past the top-right link you still have a
                jump-out call-to-action. */}
            {isProposalsListTruncated && (
              <Link
                href="/tech/proposals"
                className="flex items-center justify-center gap-1 px-4 py-3 border-t bg-muted/20 text-xs text-primary hover:bg-muted/40 hover:underline transition-colors"
              >
                View all {totalNewProposals} proposals
                <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </>
        )}
      </div>

      {/* ── Legacy: client change requests ──
          Only legacy sites still submit change requests — modern composer
          clients publish their own edits. This block is intentionally muted
          and pushed to the bottom; it's not part of the active workflow. */}
      <Link href="/tech/queue" className="block group">
        <div className="rounded-md border border-dashed bg-muted/20 px-4 py-3 hover:bg-muted/40 transition-colors">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <History className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  <span className="uppercase tracking-wide font-medium">Legacy</span>
                  <span className="mx-1.5 opacity-50">·</span>
                  Client edit requests
                </p>
                <p className="text-sm mt-0.5">
                  <span className="font-semibold tabular-nums">
                    {clientsWithPendingCRs}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    {clientsWithPendingCRs === 1 ? "client waiting" : "clients waiting"}
                    {totalPendingCRs > 0 && (
                      <>
                        <span className="mx-1.5 opacity-50">·</span>
                        <span className="tabular-nums">{totalPendingCRs}</span>{" "}
                        pending {totalPendingCRs === 1 ? "request" : "requests"}
                      </>
                    )}
                  </span>
                </p>
              </div>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 group-hover:text-foreground transition-colors" />
          </div>
        </div>
      </Link>
    </div>
  );
}
