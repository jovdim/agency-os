import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { Tray as Inbox, ClockCounterClockwise as History, ArrowRight, Hammer, CheckCircle as CheckCircle2 } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ProposalTagChips } from "@/components/proposal-tags/proposal-tag-chips";
import type { ProposalTag } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function TechDashboard() {
  const { profile } = await requireRole("tech_admin");
  const admin = createAdminClient();

  const firstName = profile.full_name?.trim().split(/\s+/)[0] || "there";

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
    <div className="dash-root max-w-5xl space-y-8">
      {/* Hero band — the page's single gradient surface. Greeting on the left,
          the focal "New Proposals" build-queue metric in a frosted inset on the
          right. New proposals are operational work, so the hero chip stays
          violet (pink is reserved for "good news" metrics). */}
      <section className="dash-hero relative flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Build queue
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Hello, {firstName}</h1>
          <p className="text-sm text-muted-foreground">
            Here&apos;s what&apos;s waiting to be built.
          </p>
        </div>

        <Link href="/tech/proposals" className="group w-full shrink-0 sm:w-auto">
          <div className="dash-hero-metric flex items-center gap-4 px-5 py-4">
            <span className="dash-chip inline-flex h-12 w-12 items-center justify-center rounded-xl">
              <Hammer className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                New Proposals
              </p>
              <p className="text-3xl font-bold leading-tight tabular-nums">
                {totalNewProposals}
              </p>
              <p className="text-xs text-muted-foreground">waiting to build</p>
            </div>
            <ArrowRight className="dash-accent ml-2 hidden h-4 w-4 shrink-0 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100 sm:block" />
          </div>
        </Link>
      </section>

      {/* New Proposals — the active work feed. A dash-panel list with a header
          row, a subhead, and a dash-row per proposal (icon chip + name/tags +
          age). Empty state shows a centered chip + message. */}
      <section className="dash-panel flex flex-col overflow-hidden">
        <div className="dash-hairline flex items-center justify-between gap-2 border-b px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Inbox className="dash-accent h-4 w-4" />
            <h2 className="text-xs font-semibold uppercase tracking-wider">
              New Proposals
            </h2>
          </div>
          {totalNewProposals > 0 && (
            <span className="dash-chip inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums">
              {totalNewProposals}
            </span>
          )}
        </div>

        {newProposals.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
            <span className="dash-chip mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <p className="text-sm font-medium">All caught up</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              No new proposals waiting to build.
            </p>
          </div>
        ) : (
          <>
            <ul className="dash-hairline divide-y">
              {newProposals.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/tech/proposals/${p.id}`}
                    className="dash-row group flex items-center gap-3 px-5 py-3.5"
                  >
                    <span className="dash-chip inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                      <Inbox className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{name(p)}</p>
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
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100 group-hover:text-(--dash-accent)" />
                  </Link>
                </li>
              ))}
            </ul>
            {/* Bottom "View all" — only when the list overflows the cap, so
                if you scrolled past the top-right count you still have a
                jump-out call-to-action. */}
            {isProposalsListTruncated && (
              <Link
                href="/tech/proposals"
                className="dash-row dash-hairline group flex items-center justify-center gap-1.5 border-t px-5 py-3 text-xs font-semibold"
              >
                <span className="dash-accent">View all {totalNewProposals} proposals</span>
                <ArrowRight className="dash-accent h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
            )}
          </>
        )}
      </section>

      {/* Legacy: client change requests ──
          Only legacy sites still submit change requests — modern composer
          clients publish their own edits. This block is intentionally muted
          and pushed to the bottom; it's not part of the active workflow. */}
      <Link href="/tech/queue" className="group block">
        <div className="dash-card flex items-center justify-between gap-3 border-dashed bg-muted/20 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <History className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Legacy · Client edit requests
              </p>
              <p className="mt-0.5 text-sm">
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
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
        </div>
      </Link>
    </div>
  );
}
