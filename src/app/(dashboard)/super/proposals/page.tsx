import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ArrowRight,
  FolderKanban,
  Globe,
  MessageSquare,
  User,
  Wrench,
  Inbox,
  Hammer,
  Eye,
  RotateCcw,
  Send,
  ScanEye,
  CreditCard,
} from "lucide-react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ProposalTagChips } from "@/components/proposal-tags";
import { TagFilterBar } from "./tag-filter-bar";
import type { ProposalTag } from "@/types/database";

const STATUS_ORDER = [
  "submitted",
  "building",
  "review",
  "revision",
  "sent",
  "viewed",
  "paid",
];

const ACTIVE_STATUSES = [
  "submitted",
  "building",
  "review",
  "revision",
  "sent",
  "viewed",
];

// Calm, two-tone status map. Icons inherit their tint from the surrounding
// chip (dash-chip = violet for operational, dash-chip-pink = pink for the one
// positive "paid" stage) — no per-status rainbow. The pipeline badge stays
// neutral/muted for every operational stage; only "paid" carries the pink
// accent, matching the approved /super reference.
const NEUTRAL_BADGE = "bg-muted text-muted-foreground border-border";
const PAID_BADGE =
  "bg-(--dash-chip-bg-2) text-(--dash-accent-2) border-(--dash-accent-2)/30";

const STATUS_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; badgeClass: string }
> = {
  submitted: {
    label: "Waiting to Build",
    icon: <Inbox className="h-4 w-4" />,
    badgeClass: NEUTRAL_BADGE,
  },
  building: {
    label: "In Progress",
    icon: <Hammer className="h-4 w-4" />,
    badgeClass: NEUTRAL_BADGE,
  },
  review: {
    label: "Under Review",
    icon: <Eye className="h-4 w-4" />,
    badgeClass: NEUTRAL_BADGE,
  },
  revision: {
    label: "Needs Revision",
    icon: <RotateCcw className="h-4 w-4" />,
    badgeClass: NEUTRAL_BADGE,
  },
  sent: {
    label: "Sent to Client",
    icon: <Send className="h-4 w-4" />,
    badgeClass: NEUTRAL_BADGE,
  },
  viewed: {
    label: "Client Viewed",
    icon: <ScanEye className="h-4 w-4" />,
    badgeClass: NEUTRAL_BADGE,
  },
  paid: {
    label: "Paid",
    icon: <CreditCard className="h-4 w-4" />,
    badgeClass: PAID_BADGE,
  },
};

export const dynamic = "force-dynamic";

export default async function SuperProposalsPage({
  searchParams,
}: {
  // Multi-value tag filter — `?tag=urgent&tag=premium` means "show
  // proposals with the urgent OR premium tag". Empty = show everything.
  searchParams: Promise<{ tag?: string | string[] }>;
}) {
  await requireRole("super_admin");
  const supabase = createAdminClient();

  const sp = await searchParams;
  const rawTagParam = sp.tag;
  const selectedSlugs = new Set(
    Array.isArray(rawTagParam)
      ? rawTagParam.filter(Boolean)
      : rawTagParam
        ? [rawTagParam]
        : [],
  );

  const [{ data: proposals }, { data: messageCounts }, { data: tagLibrary }, { data: assignmentRows }] =
    await Promise.all([
      supabase
        .from("proposals")
        .select(
          `id, company_name, industry, town, status, created_at, updated_at, slug,
          contacts(contact_person, phone),
          sales_person:profiles!proposals_sales_person_id_fkey(full_name),
          tech_admin:profiles!proposals_built_by_fkey(full_name),
          deployments(subdomain, deploy_status)`
        )
        .order("updated_at", { ascending: false })
        .range(0, 199),
      supabase
        .from("proposal_messages")
        .select("proposal_id"),
      supabase
        .from("proposal_tags")
        .select("id, name, slug, color, created_by, created_at")
        .order("created_at", { ascending: true }),
      supabase
        .from("proposal_tag_assignments")
        .select("proposal_id, tag_id"),
    ]);

  // Stitch tags onto each proposal client-side (cheap — small set).
  const tagsById = new Map<string, ProposalTag>(
    (tagLibrary ?? []).map((t) => [t.id, t as ProposalTag]),
  );
  const tagsByProposal = new Map<string, ProposalTag[]>();
  for (const row of (assignmentRows ?? []) as { proposal_id: string; tag_id: string }[]) {
    const tag = tagsById.get(row.tag_id);
    if (!tag) continue;
    const list = tagsByProposal.get(row.proposal_id) ?? [];
    list.push(tag);
    tagsByProposal.set(row.proposal_id, list);
  }

  // Per-tag count across the FULL (unfiltered) proposal set — so the
  // filter pills always reflect "if you toggled this tag in isolation".
  const tagCounts: Record<string, number> = {};
  for (const p of proposals ?? []) {
    const tags = tagsByProposal.get(p.id) ?? [];
    for (const t of tags) {
      tagCounts[t.slug] = (tagCounts[t.slug] || 0) + 1;
    }
  }

  // Apply the tag filter (OR semantics) BEFORE grouping.
  const proposalsToShow = (proposals ?? []).filter((p) => {
    if (selectedSlugs.size === 0) return true;
    const tags = tagsByProposal.get(p.id) ?? [];
    return tags.some((t) => selectedSlugs.has(t.slug));
  });

  const messageCountMap: Record<string, number> = {};
  if (messageCounts) {
    for (const msg of messageCounts) {
      messageCountMap[msg.proposal_id] =
        (messageCountMap[msg.proposal_id] || 0) + 1;
    }
  }

  const grouped: Record<string, typeof proposalsToShow> = {};
  for (const status of STATUS_ORDER) {
    grouped[status] = proposalsToShow.filter((p) => p.status === status);
  }

  const activePipeline = proposalsToShow.filter((p) =>
    ACTIVE_STATUSES.includes(p.status)
  );

  const totalCount = proposalsToShow.length;
  const isFiltered = selectedSlugs.size > 0;
  const grandTotal = (proposals ?? []).length;

  return (
    <div className="dash-root max-w-6xl space-y-8">
      {/* Clean page header — title, one-line status subtitle, Back action on
          the left. No gradient: this is a working list, not a hero surface. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Pipeline
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Proposals</h1>
          <p className="text-sm text-muted-foreground">
            {isFiltered ? (
              <>
                Showing{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {totalCount}
                </span>{" "}
                of {grandTotal} proposals ·{" "}
                <span className="tabular-nums">{activePipeline.length}</span> active
              </>
            ) : (
              <>
                All proposals across all salespersons —{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {totalCount}
                </span>{" "}
                total,{" "}
                <span className="tabular-nums">{activePipeline.length}</span> active
              </>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" asChild className="self-start">
          <Link href="/super">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to dashboard
          </Link>
        </Button>
      </div>

      {/* Tag filter — URL-driven so super admin can bookmark / share a
          filtered view ("show me everything tagged Urgent right now"). */}
      <TagFilterBar
        tags={(tagLibrary as ProposalTag[]) || []}
        selectedSlugs={selectedSlugs}
        tagCounts={tagCounts}
      />

      {/* Stat tiles — one per status, with a tinted icon chip. Paid is the
          only positive "good news" metric, so it gets the pink chip; every
          operational stage stays violet. */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-8">
        {STATUS_ORDER.map((status) => {
          const config = STATUS_CONFIG[status];
          const count = (grouped[status] || []).length;
          const isPaid = status === "paid";
          return (
            <div key={status} className="dash-card p-4">
              <span
                className={`${isPaid ? "dash-chip-pink" : "dash-chip"} inline-flex h-8 w-8 items-center justify-center rounded-lg`}
              >
                {config.icon}
              </span>
              <p className="mt-3 text-2xl font-bold tabular-nums leading-none">
                {count}
              </p>
              <p className="mt-1.5 text-[11px] leading-tight text-muted-foreground">
                {config.label}
              </p>
            </div>
          );
        })}
      </div>

      {/* Pipeline flow indicator — the active stages read left-to-right so
          you can scan where work is piling up. */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {ACTIVE_STATUSES.map((status, i) => {
          const config = STATUS_CONFIG[status];
          return (
            <div key={status} className="flex items-center gap-1.5">
              <Badge variant="outline" className={config.badgeClass}>
                {config.label}
                <span className="ml-1 tabular-nums opacity-70">
                  {(grouped[status] || []).length}
                </span>
              </Badge>
              {i < ACTIVE_STATUSES.length - 1 && (
                <ArrowRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />
              )}
            </div>
          );
        })}
      </div>

      {/* Proposals grouped by status */}
      {STATUS_ORDER.filter(
        (s) => (grouped[s] || []).length > 0
      ).map((status) => {
        const config = STATUS_CONFIG[status];
        const isPaid = status === "paid";
        return (
          <div key={status} className="dash-panel overflow-hidden">
            <div className="dash-subhead dash-hairline flex items-center gap-2.5 border-b px-5 py-3">
              <span
                className={`${isPaid ? "dash-chip-pink" : "dash-chip"} inline-flex h-7 w-7 items-center justify-center rounded-lg`}
              >
                {config.icon}
              </span>
              <span className="text-sm font-semibold">{config.label}</span>
              <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
                {(grouped[status] || []).length}
              </span>
            </div>
            <div className="dash-hairline divide-y">
              {(grouped[status] || []).map((proposal) => {
                const salesPerson = proposal.sales_person as unknown as {
                  full_name: string;
                } | null;
                const techAdminData = proposal.tech_admin as unknown as {
                  full_name: string;
                } | null;
                const contact = proposal.contacts as unknown as {
                  contact_person: string;
                  phone: string;
                } | null;
                const deployment = Array.isArray(proposal.deployments)
                  ? (proposal.deployments[0] as {
                      subdomain: string;
                      deploy_status: string;
                    } | undefined)
                  : (proposal.deployments as {
                      subdomain: string;
                      deploy_status: string;
                    } | null);
                const msgCount = messageCountMap[proposal.id] || 0;
                const deployUrl = deployment?.subdomain
                  ? `https://${deployment.subdomain}.2dni.sk`
                  : null;

                const proposalTags = tagsByProposal.get(proposal.id) ?? [];
                return (
                  <Link
                    key={proposal.id}
                    href={`/tech/proposals/${proposal.id}`}
                    className="dash-row group flex items-center justify-between gap-4 px-5 py-3.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold truncate">
                          {proposal.company_name}
                        </p>
                        {msgCount > 0 && (
                          <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                            <MessageSquare className="h-3 w-3" />
                            {msgCount}
                          </span>
                        )}
                        <ProposalTagChips tags={proposalTags} />
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                        <span className="text-xs text-muted-foreground">
                          {proposal.industry || "General"} • {proposal.town || "—"}
                        </span>
                        {contact?.contact_person && (
                          <span className="text-xs text-muted-foreground">
                            Contact: {contact.contact_person}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <User className="h-3 w-3" />
                          {salesPerson?.full_name || "—"}
                        </span>
                        {techAdminData?.full_name && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Wrench className="h-3 w-3" />
                            {techAdminData.full_name}
                          </span>
                        )}
                        {deployUrl && (
                          <span className="dash-accent flex items-center gap-1 text-xs">
                            <Globe className="h-3 w-3" />
                            {deployment?.subdomain}.2dni.sk
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-right">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatDistanceToNow(new Date(proposal.updated_at), {
                          addSuffix: true,
                        })}
                      </span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground/50 transition-all group-hover:translate-x-0.5 group-hover:text-(--dash-accent)" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Empty state */}
      {totalCount === 0 && (
        <div className="dash-panel flex flex-col items-center px-6 py-16 text-center">
          <span className="dash-chip mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full">
            <FolderKanban className="h-6 w-6" />
          </span>
          <p className="text-sm font-medium">
            {isFiltered ? "No proposals match this filter" : "No proposals yet"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isFiltered
              ? "Try clearing or changing the tag filter above."
              : "New proposals will show up here as they move through the pipeline."}
          </p>
        </div>
      )}
    </div>
  );
}
