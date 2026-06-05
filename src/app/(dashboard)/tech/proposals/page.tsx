import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { ArrowLeft, Hammer } from "@phosphor-icons/react/ssr";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { TechProposalsClient } from "./proposals-client";
import type { ProposalTag } from "@/types/database";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

/**
 * /tech/proposals — build queue for the tech admin.
 *
 * This page only lists proposals that still need work (submitted /
 * building / review / revision). Paid clients have their own dedicated
 * roster at /tech/live-clients — keeping the two lanes split keeps
 * each surface focused on the operator's actual job:
 *   - This page = "what do I need to build today?"
 *   - /tech/live-clients = "manage paying customers"
 *
 * Per-proposal detail (build steps, mark-paid, paid-client management
 * cards) all live on /tech/proposals/[id].
 */
export default async function TechProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireRole("tech_admin");
  const admin = createAdminClient();
  const params = await searchParams;

  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Build queue comes from an RPC (see migration 00069). Combines the
  // window function ranking with the proposals table fields so we don't
  // need a separate JOIN here.
  const [{ data: queueRows }, { data: totalCountRaw }] = await Promise.all([
    admin.rpc("proposals_build_queue", {
      p_limit: PAGE_SIZE,
      p_offset: offset,
    }),
    admin.rpc("proposals_build_queue_count"),
  ]);

  type QueueRow = {
    id: string;
    company_name: string;
    updated_at: string;
    created_at: string;
    contact_phone: string | null;
  };

  const buildQueue = ((queueRows ?? []) as QueueRow[]).map((r) => ({
    id: r.id,
    company_name: r.company_name,
    updated_at: r.updated_at,
    created_at: r.created_at,
    contacts: { phone: r.contact_phone },
  }));
  const buildQueueTotal = Number(totalCountRaw ?? 0);
  const proposalIds = buildQueue.map((p) => p.id);

  // Tags for the current page only. At PAGE_SIZE=100 this is a non-issue
  // in practice (queue is typically tens deep).
  const tagsByProposal: Record<string, ProposalTag[]> = {};
  if (proposalIds.length > 0) {
    const { data: assignments } = await admin
      .from("proposal_tag_assignments")
      .select(
        "proposal_id, proposal_tags(id, name, slug, color, created_by, created_at)",
      )
      .in("proposal_id", proposalIds);
    for (const row of assignments ?? []) {
      const tag = Array.isArray(row.proposal_tags)
        ? row.proposal_tags[0]
        : row.proposal_tags;
      if (!tag) continue;
      const list = tagsByProposal[row.proposal_id as string] ?? [];
      list.push(tag as ProposalTag);
      tagsByProposal[row.proposal_id as string] = list;
    }
  }

  return (
    <div className="dash-root max-w-6xl space-y-6">
      {/* Quiet back link — sits above the header as a breadcrumb-style action
          so the page title can stand on its own line. */}
      <Button
        variant="ghost"
        size="sm"
        asChild
        className="-ml-2 h-8 text-muted-foreground hover:text-foreground"
      >
        <Link href="/tech">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Link>
      </Button>

      {/* Page header — clean title row: violet icon chip + eyebrow label +
          title + one-line subtitle, with the live queue count on the right.
          No gradient here; a calm header is enough for a list surface. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="dash-chip inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
            <Hammer className="h-5 w-5" />
          </span>
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Tech
            </p>
            <h1 className="text-2xl font-bold tracking-tight">Build Queue</h1>
            <p className="text-sm text-muted-foreground">
              Proposals waiting on build. Paying customers live in{" "}
              <Link
                href="/tech/live-clients"
                className="dash-accent font-medium hover:underline"
              >
                Live Clients
              </Link>
              .
            </p>
          </div>
        </div>

        {buildQueueTotal > 0 && (
          <div className="dash-card flex shrink-0 items-center gap-3 px-4 py-3">
            <span className="text-3xl font-bold tabular-nums leading-none">
              {buildQueueTotal}
            </span>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              In
              <br />
              queue
            </span>
          </div>
        )}
      </div>

      <TechProposalsClient
        proposals={buildQueue}
        tagsByProposal={tagsByProposal}
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={buildQueueTotal}
      />
    </div>
  );
}
