/**
 * Three-state "attention" signal for a proposal as seen by the assigned
 * salesperson. Shared between /sales/active rows, the sidebar unread
 * count, and any future "did this change?" UI affordance.
 *
 *   - "new"     → first publish, salesperson has never opened it
 *   - "updated" → was already seen, but IT re-published since
 *   - null      → not published, or already caught up
 *
 * The distinction matters for visual treatment: NEW = brand new lead,
 * prominent badge. UPDATED = quick re-check, minimal chip. Otherwise they
 * blur together and salespeople can't triage at a glance.
 *
 *   ┌──────────────────────────────────────┬─────────────────────────┐
 *   │  last_published_at  │  sales_seen_at │  state                  │
 *   ├──────────────────────────────────────┼─────────────────────────┤
 *   │  null               │  anything      │  null    (not published)│
 *   │  set                │  null          │  "new"   (never opened) │
 *   │  set                │  > published   │  null    (caught up)    │
 *   │  set                │  < published   │  "updated" (re-publish) │
 *   └──────────────────────────────────────┴─────────────────────────┘
 *
 * Tech-only edits that DON'T re-publish don't trigger anything. IT
 * pushing Publish is the signal sales cares about.
 */
export type ProposalUpdateState = "new" | "updated" | null;

export function getProposalUpdateState(
  lastPublishedAt: string | null | undefined,
  salesSeenAt: string | null | undefined,
): ProposalUpdateState {
  if (!lastPublishedAt) return null;
  if (!salesSeenAt) return "new";
  return new Date(salesSeenAt).getTime() < new Date(lastPublishedAt).getTime()
    ? "updated"
    : null;
}

/**
 * Convenience: "does this proposal need attention?" Either NEW or UPDATED
 * counts as yes. Used by the sidebar count so the badge represents total
 * unread work, not just brand-new leads.
 */
export function isProposalNew(
  lastPublishedAt: string | null | undefined,
  salesSeenAt: string | null | undefined,
): boolean {
  return getProposalUpdateState(lastPublishedAt, salesSeenAt) !== null;
}

/**
 * Count of NEW (published-but-unseen) proposals for one salesperson.
 *
 * Used by the dashboard layout to feed the sidebar "Active" badge. We do
 * the cross-table comparison in JS because PostgREST can't express
 * "sites.last_published_at > proposals.sales_seen_at" cleanly — two
 * focused queries + isProposalNew() is simpler than crafting an RPC.
 *
 * Scope: excludes paid/archived proposals (they belong on /sales/live-clients,
 * not the active queue). Returns 0 on any failure so a transient DB
 * hiccup never breaks the sidebar render.
 */
import { createAdminClient } from "@/lib/supabase/admin";

export async function countNewProposalsForSalesperson(
  salesPersonId: string,
): Promise<number> {
  try {
    const admin = createAdminClient();

    // 1. Open proposals owned by this salesperson + their sales_seen_at.
    const { data: openProposals } = await admin
      .from("proposals")
      .select("id, sales_seen_at")
      .eq("sales_person_id", salesPersonId)
      .not("status", "in", "(paid,archived)");
    if (!openProposals || openProposals.length === 0) return 0;

    const seenById = new Map<string, string | null>();
    for (const p of openProposals) {
      seenById.set(p.id as string, (p as { sales_seen_at: string | null }).sales_seen_at ?? null);
    }

    // 2. Sites with publish timestamps for those proposals.
    const proposalIds = Array.from(seenById.keys());
    const { data: sites } = await admin
      .from("sites")
      .select("proposal_id, last_published_at")
      .in("proposal_id", proposalIds);
    if (!sites) return 0;

    // 3. Pick the latest publish per proposal_id (defensive against
    // accidental dupes) and count NEWness via the shared helper.
    const publishedByProposal = new Map<string, string | null>();
    for (const s of sites) {
      const pid = s.proposal_id as string | null;
      if (!pid) continue;
      const current = publishedByProposal.get(pid);
      const lpa = s.last_published_at as string | null;
      if (current === undefined) {
        publishedByProposal.set(pid, lpa);
        continue;
      }
      if (lpa && (!current || new Date(lpa) > new Date(current))) {
        publishedByProposal.set(pid, lpa);
      }
    }

    let n = 0;
    for (const [pid, seenAt] of seenById) {
      if (isProposalNew(publishedByProposal.get(pid) ?? null, seenAt)) n++;
    }
    return n;
  } catch {
    return 0;
  }
}
